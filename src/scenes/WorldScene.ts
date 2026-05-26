import Phaser from 'phaser';
import Background from '../entities/Background';
import RailTrack from '../entities/RailTrack';
import { Station } from '../entities/Station';
import TrackManager from '../managers/TrackManager';
import { TrainManager } from '../managers/TrainManager';
import { WorldManager } from '../managers/WorldManager';
import { GameStateManager } from '../managers/GameStateManager';
import { CameraController } from '../systems/CameraController';
import { InputManager } from '../systems/InputManager';
import TrackGenerator from '../systems/TrackGenerator';
import { JunctionCreatorSystem } from '../systems/JunctionCreatorSystem';
import { TrackCompleterSystem } from '../systems/TrackCompleterSystem';
import { EventBus } from '../services/EventBus';
import { AudioManager } from '../managers/AudioManager';
import { CreateModeToolbar } from '../ui/CreateModeToolbar';
import type { CreateTool } from '../ui/CreateModeToolbar';
import { GameConfig } from '../config/GameConfig';
import type { TrackDef, WorldStationDef } from '../config/WorldData';

/**
 * WorldScene – the persistent main scene for the sandbox world.
 *
 * Two modes (controlled via GameStateManager.worldMode):
 *   create – editor; toolbar visible; trains frozen; free camera pan/zoom
 *   play   – trains active; camera follows selected train; toolbar hidden
 */
export default class WorldScene extends Phaser.Scene {
  private trackManager!: TrackManager;
  private trainManager!: TrainManager;
  private cameraController!: CameraController;
  private inputManager!: InputManager;
  private audioManager!: AudioManager;
  private junctionCreator!: JunctionCreatorSystem;
  private trackCompleter!: TrackCompleterSystem;
  private toolbar!: CreateModeToolbar;
  private stations: Station[] = [];
  private selectedTrack: RailTrack | null = null;
  private selectedTrackHighlight!: Phaser.GameObjects.Graphics;
  private minimapGraphics!: Phaser.GameObjects.Graphics;
  private undoStack: ReturnType<typeof WorldManager.snapshot>[] = [];
  private autoSaveTimer: number = 0;
  private activeTool: CreateTool = 'none';

  private readonly modeChangedHandler = ({ mode }: { mode: 'create' | 'play' }) => {
    if (mode === 'create') this.activateCreateMode();
    else if (mode === 'play') this.activatePlayMode();
  };

  private readonly toolChangedHandler = ({ tool }: { tool: CreateTool }) => {
    this.activeTool = tool;
  };

  constructor() {
    super({ key: 'WorldScene' });
  }

  init(data: { worldId?: string; mode?: 'create' | 'play' }): void {
    if (data.worldId) {
      WorldManager.load(data.worldId);
    }
    const startMode = data.mode ?? 'create';
    if (startMode === 'create') {
      GameStateManager.enterCreate(WorldManager.currentWorldId ?? '');
    } else {
      GameStateManager.enterPlay(WorldManager.currentWorldId ?? '');
    }
  }

  create(): void {
    new Background(this, 20, 20).setDepth(-20);

    this.trackManager = new TrackManager(this);
    this.cameraController = new CameraController(this);
    this.trainManager = new TrainManager(this, this.trackManager, this.cameraController);
    this.inputManager = new InputManager(this);
    this.audioManager = new AudioManager(this);
    this.junctionCreator = new JunctionCreatorSystem(this, this.trackManager);
    this.trackCompleter = new TrackCompleterSystem(this, this.trackManager);
    this.toolbar = new CreateModeToolbar(this);

    this.selectedTrackHighlight = this.add.graphics().setDepth(200);
    this.minimapGraphics = this.add.graphics().setDepth(601).setScrollFactor(0);

    // Load world content
    this.loadWorldContent();

    // HUD and debug overlays
    this.scene.launch('HUDScene');
    this.scene.launch('DebugOverlayScene');

    // Subscribe to events
    EventBus.on('mode:changed', this.modeChangedHandler);
    EventBus.on('tool:changed', this.toolChangedHandler);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('mode:changed', this.modeChangedHandler);
      EventBus.off('tool:changed', this.toolChangedHandler);
      this.junctionCreator.destroy();
      this.trackCompleter.destroy();
      this.toolbar.destroy();
    });

    // Input routing
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
      this.handleKeyDown(event);
    });

    // ESC → pause in play mode
    this.input.keyboard.on('keydown-ESC', () => {
      if (GameStateManager.worldMode === 'play' && GameStateManager.state === 'playing') {
        GameStateManager.pause();
        this.scene.launch('PauseScene');
        this.scene.pause();
      }
    });

    // Apply initial mode
    if (GameStateManager.worldMode === 'create') {
      this.activateCreateMode();
    } else {
      this.activatePlayMode();
    }

    this.cameras.main.zoom = 0.5;
    this.cameras.main.scrollX = -400;
    this.cameras.main.scrollY = 600;
  }

  update(time: number, delta: number): void {
    this.cameraController.update(time, delta);
    this.publishDebugState();

    if (GameStateManager.worldMode === 'create') {
      this.trackCompleter.update(delta);
      this.drawMinimap();
      this.autoSaveTimer += delta / 1000;
      if (this.autoSaveTimer >= GameConfig.WORLD.AUTO_SAVE_INTERVAL_SECS) {
        this.autoSaveTimer = 0;
        WorldManager.save();
      }
      GameStateManager.tick(delta / 1000);
    } else if (GameStateManager.worldMode === 'play' && GameStateManager.state === 'playing') {
      this.inputManager.handleTrainMovement(this.trainManager.selectedTrain);
      this.trainManager.update(time, delta);
      this.stations.forEach((s) => s.update(delta));
      GameStateManager.tick(delta / 1000);
      this.publishHUDState();
    }
  }

  // ── World content loading ─────────────────────────────────────────────────

  private loadWorldContent(): void {
    const world = WorldManager.world;
    if (!world || world.tracks.length === 0) {
      // Brand-new world: generate a starter track
      this.generateStarterTrack();
      return;
    }

    // Restore tracks
    for (const def of world.tracks) {
      this.restoreTrack(def);
    }

    // Restore stations (after tracks so track lookups work)
    for (const def of world.stations) {
      this.restoreStation(def);
    }

    // Restore trains
    for (const def of world.trains) {
      const track = this.trackManager.getTrack(def.trackUUID);
      if (!track) continue;
      const train = this.trainManager.createInitialTrain();
      const pt = track.getCurvePath().getPoint(def.trackT);
      train.getMatterBody().setPosition(pt.x, pt.y);
      train.currentTrack = track;
    }
  }

  private restoreTrack(def: TrackDef): void {
    const p0 = new Phaser.Math.Vector2(def.p0.x, def.p0.y);
    const p1 = new Phaser.Math.Vector2(def.p1.x, def.p1.y);
    const p2 = new Phaser.Math.Vector2(def.p2.x, def.p2.y);
    const p3 = new Phaser.Math.Vector2(def.p3.x, def.p3.y);
    const track = new RailTrack(this, p0, p1, p2, p3);
    // Preserve the saved UUID by injecting it (UUID is readonly by design,
    // so we cast for restoration only)
    (track as any).uuid = def.uuid;
    this.trackManager.addTrack(track);
  }

  private restoreStation(def: WorldStationDef): void {
    const track = this.trackManager.getTrack(def.trackUUID);
    if (!track) return;
    const stationDef = {
      id: def.id,
      name: def.name,
      trackSectionIndex: 0,
      trackT: def.trackT,
      passengerSpawnRate: def.passengerSpawnRate,
    };
    this.stations.push(new Station(this, stationDef, track));
  }

  private generateStarterTrack(): void {
    const generator = new TrackGenerator(this, this.trackManager, WorldManager.world?.seed);
    const tracks = generator.generateTracks({
      startPoint: new Phaser.Math.Vector2(0, 500),
      startAngle: Phaser.Math.DegToRad(90),
      sections: GameConfig.GENERATION.MAIN.SECTIONS,
      minLength: GameConfig.GENERATION.MAIN.MIN_LENGTH,
      maxLength: GameConfig.GENERATION.MAIN.MAX_LENGTH,
      curveProbability: GameConfig.GENERATION.MAIN.CURVE_PROB,
      minCurveAngle: GameConfig.GENERATION.MAIN.MIN_ANGLE,
      maxCurveAngle: GameConfig.GENERATION.MAIN.MAX_ANGLE,
      smoothness: GameConfig.GENERATION.MAIN.SMOOTHNESS,
    });

    // Persist to WorldManager
    for (const track of tracks) {
      WorldManager.addTrackDef(this.trackToDef(track));
    }

    // Spawn a train on the first track
    const firstTrack = tracks[0];
    const startPt = firstTrack.getCurvePath().getPoint(0);
    const train = this.trainManager.createInitialTrain();
    train.getMatterBody().setPosition(startPt.x, startPt.y);
    train.currentTrack = firstTrack;
    train.getMatterBody().setAngle(firstTrack.getTrackAngle(train.getMatterBody()));
  }

  // ── Mode switching ────────────────────────────────────────────────────────

  private activateCreateMode(): void {
    this.toolbar.setVisible(true);
    // Freeze all trains
    for (const train of this.trainManager.trains) {
      train.enginePower = 0;
    }
    this.cameraController.stopFollow();
    // Auto-save on entering create mode
    WorldManager.save();
  }

  private activatePlayMode(): void {
    this.toolbar.setVisible(false);
    this.selectedTrackHighlight.clear();
    this.minimapGraphics.clear();
    this.inputManager.setupClickHandling(this.trainManager);
  }

  // ── Input dispatch ─────────────────────────────────────────────────────────

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;

    if (this.activeTool === 'junction') {
      this.junctionCreator.onPointerDown(pointer);
    } else if (this.activeTool === 'completer') {
      this.trackCompleter.onPointerDown(pointer);
    } else if (this.activeTool === 'select') {
      this.handleSelectClick(pointer);
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    if (this.activeTool === 'junction') {
      this.junctionCreator.onPointerMove(pointer);
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    if (this.activeTool === 'junction') {
      this.junctionCreator.onPointerUp(pointer);
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (GameStateManager.worldMode === 'create') {
      if (event.ctrlKey && event.code === 'KeyZ') {
        this.undo();
        return;
      }
      if (this.activeTool === 'completer') {
        this.trackCompleter.onKeyDown(event);
      }
      if (event.code === 'Delete' && this.selectedTrack) {
        this.deleteSelectedTrack();
      }
    }
  }

  // ── Select tool ────────────────────────────────────────────────────────────

  private handleSelectClick(pointer: Phaser.Input.Pointer): void {
    const world = this.pointerToWorld(pointer);
    const track = this.trackManager.getClosestTrack(world, 60);
    this.selectedTrack = track;
    this.selectedTrackHighlight.clear();

    if (track) {
      this.selectedTrackHighlight.lineStyle(4, 0xffffff, 0.8);
      const curve = track.getCurvePath();
      this.selectedTrackHighlight.beginPath();
      for (let i = 0; i <= 20; i++) {
        const pt = curve.getPoint(i / 20);
        if (i === 0) this.selectedTrackHighlight.moveTo(pt.x, pt.y);
        else this.selectedTrackHighlight.lineTo(pt.x, pt.y);
      }
      this.selectedTrackHighlight.strokePath();
    }
  }

  private deleteSelectedTrack(): void {
    if (!this.selectedTrack) return;
    this.pushUndoSnapshot();
    const uuid = this.selectedTrack.getUUID();
    this.trackManager.removeTrack(uuid);
    WorldManager.removeTrackDef(uuid);
    this.selectedTrack = null;
    this.selectedTrackHighlight.clear();
    EventBus.emit('track:removed', { trackUUID: uuid });
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  private pushUndoSnapshot(): void {
    const snap = WorldManager.snapshot();
    if (snap) {
      this.undoStack.push(snap);
      if (this.undoStack.length > GameConfig.WORLD.MAX_UNDO_STEPS) {
        this.undoStack.shift();
      }
    }
  }

  private undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    WorldManager.restore(snap);
    // Reload scene content
    this.scene.restart({ worldId: WorldManager.currentWorldId, mode: 'create' });
  }

  // ── Minimap ───────────────────────────────────────────────────────────────

  private drawMinimap(): void {
    const { width, height } = this.scale;
    const mapW = 180;
    const mapH = 120;
    const mapX = width - mapW - 16;
    const mapY = height - mapH - 16;

    this.minimapGraphics.clear();
    this.minimapGraphics.fillStyle(0x06131f, 0.85);
    this.minimapGraphics.fillRect(mapX, mapY, mapW, mapH);
    this.minimapGraphics.lineStyle(1, 0xffffff, 0.3);
    this.minimapGraphics.strokeRect(mapX, mapY, mapW, mapH);

    const tracks = this.trackManager.tracks;
    if (tracks.length === 0) return;

    // Find world bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of tracks) {
      const mid = t.getCurvePath().getPoint(0.5);
      minX = Math.min(minX, mid.x); maxX = Math.max(maxX, mid.x);
      minY = Math.min(minY, mid.y); maxY = Math.max(maxY, mid.y);
    }
    const worldW = Math.max(maxX - minX, 1);
    const worldH = Math.max(maxY - minY, 1);

    const toMap = (x: number, y: number) => ({
      mx: mapX + ((x - minX) / worldW) * mapW,
      my: mapY + ((y - minY) / worldH) * mapH,
    });

    for (const t of tracks) {
      const isConnected = t.hasNext() || t.hasPrevious();
      this.minimapGraphics.lineStyle(1, isConnected ? 0x00ff88 : 0xff4444, 0.9);
      this.minimapGraphics.beginPath();
      for (let i = 0; i <= 8; i++) {
        const pt = t.getCurvePath().getPoint(i / 8);
        const { mx, my } = toMap(pt.x, pt.y);
        if (i === 0) this.minimapGraphics.moveTo(mx, my);
        else this.minimapGraphics.lineTo(mx, my);
      }
      this.minimapGraphics.strokePath();
    }
  }

  // ── HUD / debug publishing ────────────────────────────────────────────────

  private publishHUDState(): void {
    this.registry.set('hud.objectives', []);
  }

  private publishDebugState(): void {
    const selectedTrain = this.trainManager.selectedTrain ?? this.trainManager.trains[0];
    const cam = this.cameras.main;
    const mouseWorldX = this.input.mousePointer.x / cam.zoom + cam.scrollX;
    const mouseWorldY = this.input.mousePointer.y / cam.zoom + cam.scrollY;
    const trainBody = selectedTrain?.getMatterBody();
    this.registry.set('debug.overlay', {
      cameraX: Math.floor(cam.scrollX),
      cameraY: Math.floor(cam.scrollY),
      zoom: cam.zoom.toFixed(2),
      mouseX: Math.floor(mouseWorldX),
      mouseY: Math.floor(mouseWorldY),
      trainX: Math.floor(trainBody?.x ?? 0),
      trainY: Math.floor(trainBody?.y ?? 0),
      enginePower: selectedTrain?.enginePower.toFixed(2) ?? '0.00',
      trackId: selectedTrain?.currentTrack?.getUUID() ?? 'none',
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private pointerToWorld(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const cam = this.cameras.main;
    return {
      x: pointer.x / cam.zoom + cam.scrollX,
      y: pointer.y / cam.zoom + cam.scrollY,
    };
  }

  private trackToDef(track: RailTrack): TrackDef {
    const curve = track.getCurvePath();
    const p0 = curve.getStartPoint();
    const p3 = curve.getEndPoint();
    const p1 = curve.getPoint(0.33);
    const p2 = curve.getPoint(0.67);
    return {
      uuid: track.getUUID(),
      p0: { x: p0.x, y: p0.y },
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      p3: { x: p3.x, y: p3.y },
    };
  }
}
