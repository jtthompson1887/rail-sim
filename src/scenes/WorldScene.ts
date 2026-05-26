import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import { Station } from '../entities/Station';
import TrackManager from '../managers/TrackManager';
import { TrainManager } from '../managers/TrainManager';
import { WorldManager } from '../managers/WorldManager';
import { GameStateManager } from '../managers/GameStateManager';
import { SceneryManager } from '../managers/SceneryManager';
import { CameraController } from '../systems/CameraController';
import { InputManager } from '../systems/InputManager';
import TrackGenerator from '../systems/TrackGenerator';
import { JunctionCreatorSystem } from '../systems/JunctionCreatorSystem';
import { TrackCompleterSystem } from '../systems/TrackCompleterSystem';
import { TerrainGenerator } from '../systems/TerrainGenerator';
import { TerrainChunkManager } from '../systems/TerrainChunkManager';
import { TerrainValidator } from '../systems/TerrainValidator';
import { SnapSystem } from '../systems/SnapSystem';
import { CommandStack, DeleteTracksCommand, ReshapeTrackCommand } from '../systems/CommandStack';
import { SelectionManager } from '../systems/SelectionManager';
import { EventBus } from '../services/EventBus';
import { AudioManager } from '../managers/AudioManager';
import { EditorToolbar } from '../ui/EditorToolbar';
import { PropertiesPanel } from '../ui/PropertiesPanel';
import { ContextMenu, buildTrackContextItems, buildEmptyContextItems } from '../ui/ContextMenu';
import type { CreateTool } from '../ui/EditorToolbar';
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
  private toolbar!: EditorToolbar;
  private propertiesPanel!: PropertiesPanel;
  private contextMenu!: ContextMenu;
  private terrainGenerator!: TerrainGenerator;
  private terrainChunkManager!: TerrainChunkManager;
  private terrainValidator!: TerrainValidator;
  private sceneryManager!: SceneryManager;
  private snapSystem!: SnapSystem;
  private commandStack!: CommandStack;
  private selectionManager!: SelectionManager;

  /** Semi-transparent terrain overlay drawn when terrain-view tool is active. */
  private terrainOverlay!: Phaser.GameObjects.Graphics;
  private stations: Station[] = [];
  private minimapGraphics!: Phaser.GameObjects.Graphics;
  private autoSaveTimer: number = 0;
  private activeTool: CreateTool = 'none';

  // ── Drag-reshape state ─────────────────────────────────────────────────────
  private reshapingTrackUUID: string | null = null;
  private reshapeBeforeDef: TrackDef | null = null;

  private readonly modeChangedHandler = ({ mode }: { mode: 'create' | 'play' }) => {
    if (mode === 'create') this.activateCreateMode();
    else if (mode === 'play') this.activatePlayMode();
  };

  private readonly toolChangedHandler = ({ tool }: { tool: CreateTool }) => {
    this.activeTool = tool;
    this.updateToolCursor(tool);
    // Block camera pan for all tools except pan/none/terrain-view
    const freePanTools: CreateTool[] = ['none', 'pan', 'terrain-view'];
    this.cameraController.setBlockPan(freePanTools.indexOf(tool) === -1);
  };

  private readonly undoHandler = () => { this.commandStack.undo(); };
  private readonly redoHandler = () => { this.commandStack.redo(); };
  private readonly saveHandler = () => { WorldManager.save(); this.toolbar.setSaveIndicator('saved'); };

  private readonly modeToogleHandler = () => {
    if (GameStateManager.worldMode === 'create') {
      GameStateManager.enterPlay(WorldManager.currentWorldId ?? '');
    } else {
      GameStateManager.returnToCreate();
    }
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
    // ── Terrain system ──────────────────────────────────────────────────────
    const world = WorldManager.world;
    const terrainSeed = world?.terrainSeed ?? (world?.seed ?? 'default');
    const biome = world?.biome ?? 'temperate';

    this.terrainGenerator    = new TerrainGenerator(terrainSeed);
    this.terrainValidator    = new TerrainValidator(this.terrainGenerator);
    this.terrainChunkManager = new TerrainChunkManager(this, this.terrainGenerator, biome);
    this.sceneryManager      = new SceneryManager(this, this.terrainGenerator, biome, terrainSeed);
    this.terrainOverlay      = this.add.graphics().setDepth(-50).setScrollFactor(0);

    this.trackManager    = new TrackManager(this);
    this.cameraController = new CameraController(this);
    this.trainManager    = new TrainManager(this, this.trackManager, this.cameraController);
    this.inputManager    = new InputManager(this);
    this.audioManager    = new AudioManager(this);
    this.junctionCreator = new JunctionCreatorSystem(this, this.trackManager, this.terrainValidator);
    this.trackCompleter  = new TrackCompleterSystem(this, this.trackManager, this.terrainValidator);

    // ── Editor systems ─────────────────────────────────────────────────────
    this.snapSystem     = new SnapSystem(this.trackManager);
    this.commandStack   = new CommandStack(GameConfig.WORLD.MAX_UNDO_STEPS);
    this.commandStack.onChange = (canUndo, canRedo) => {
      this.toolbar.setUndoEnabled(canUndo);
      this.toolbar.setRedoEnabled(canRedo);
      this.toolbar.setSaveIndicator('unsaved');
    };
    this.selectionManager = new SelectionManager(this, this.trackManager, this.snapSystem);

    // ── UI ─────────────────────────────────────────────────────────────────
    this.toolbar = new EditorToolbar(this);
    this.propertiesPanel = new PropertiesPanel(this, this.trackManager, this.selectionManager, (uuids) => {
      this.deleteSelectedTracks(uuids);
    });
    this.contextMenu = new ContextMenu(this);

    this.minimapGraphics = this.add.graphics().setDepth(601).setScrollFactor(0);

    // Load world content
    this.loadWorldContent();

    // HUD and debug overlays
    this.scene.launch('HUDScene');
    this.scene.launch('DebugOverlayScene');

    // Subscribe to events
    EventBus.on('mode:changed',      this.modeChangedHandler);
    EventBus.on('tool:changed',      this.toolChangedHandler);
    EventBus.on('editor:undo',       this.undoHandler);
    EventBus.on('editor:redo',       this.redoHandler);
    EventBus.on('editor:save',       this.saveHandler);
    EventBus.on('editor:mode-toggle', this.modeToogleHandler);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('mode:changed',       this.modeChangedHandler);
      EventBus.off('tool:changed',       this.toolChangedHandler);
      EventBus.off('editor:undo',        this.undoHandler);
      EventBus.off('editor:redo',        this.redoHandler);
      EventBus.off('editor:save',        this.saveHandler);
      EventBus.off('editor:mode-toggle', this.modeToogleHandler);
      this.junctionCreator.destroy();
      this.trackCompleter.destroy();
      this.toolbar.destroy();
      this.propertiesPanel.destroy();
      this.contextMenu.destroy();
      this.selectionManager.destroy();
      this.terrainChunkManager.destroyAll();
      this.sceneryManager.destroyAll();
    });

    // Input routing
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup',   this.handlePointerUp,   this);
    this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
      this.handleKeyDown(event);
    });

    // Drag events for control-point reshape handles
    this.input.on('drag', (_ptr: Phaser.Input.Pointer, go: any, dragX: number, dragY: number) => {
      this.handleHandleDrag(go, dragX, dragY);
    });
    this.input.on('dragend', (_ptr: Phaser.Input.Pointer, go: any) => {
      this.handleHandleDragEnd(go);
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

    // Stream terrain chunks and scenery around the camera
    const cam = this.cameras.main;
    const camCX = cam.scrollX + cam.width / (2 * cam.zoom);
    const camCY = cam.scrollY + cam.height / (2 * cam.zoom);
    this.terrainChunkManager.update(camCX, camCY);
    this.sceneryManager.update(camCX, camCY);

    // Terrain overlay when tool is active
    this.updateTerrainOverlay();

    if (GameStateManager.worldMode === 'create') {
      this.trackCompleter.update(delta);
      this.selectionManager.update(delta);
      this.drawMinimap();
      this.autoSaveTimer += delta / 1000;
      if (this.autoSaveTimer >= GameConfig.WORLD.AUTO_SAVE_INTERVAL_SECS) {
        this.autoSaveTimer = 0;
        WorldManager.save();
        this.toolbar.setSaveIndicator('saved');
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

  /** Draw a semi-transparent terrain-band overlay when the terrain-view tool is active. */
  private updateTerrainOverlay(): void {
    if (this.activeTool !== 'terrain-view') {
      this.terrainOverlay.setVisible(false);
      return;
    }
    this.terrainOverlay.setVisible(true);
    this.terrainOverlay.clear();
    this.terrainOverlay.fillStyle(0x4ad5ff, 0.12);
    this.terrainOverlay.fillRect(0, 0, this.scale.width, this.scale.height);
  }

  // ── World content loading ─────────────────────────────────────────────────

  private loadWorldContent(): void {
    const world = WorldManager.world;
    if (!world || world.tracks.length === 0) {
      this.generateStarterTrack();
      return;
    }

    for (const def of world.tracks)   { this.restoreTrack(def); }
    for (const def of world.stations) { this.restoreStation(def); }

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
    (track as any).uuid = def.uuid;
    if (def.isTunnel)  track.isTunnel  = def.isTunnel;
    if (def.elevation) track.elevation = def.elevation;
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

    for (const track of tracks) {
      WorldManager.addTrackDef(this.trackToDef(track));
    }

    const firstTrack = tracks[0];
    const startPt = firstTrack.getCurvePath().getPoint(0);
    const train = this.trainManager.createInitialTrain();
    train.getMatterBody().setPosition(startPt.x, startPt.y);
    train.currentTrack = firstTrack;
    train.getMatterBody().setAngle(firstTrack.getTrackAngle(train.getMatterBody()));
  }

  // ── Mode switching ────────────────────────────────────────────────────────

  private activateCreateMode(): void {
    for (const train of this.trainManager.trains) {
      train.enginePower = 0;
    }
    this.cameraController.stopFollow();
    WorldManager.save();
  }

  private activatePlayMode(): void {
    this.minimapGraphics.clear();
    this.selectionManager.clearSelection();
    this.inputManager.setupClickHandling(this.trainManager);
  }

  // ── Input dispatch ─────────────────────────────────────────────────────────

  /** Return true if the pointer's screen position overlaps any editor UI panel. */
  private isPointerOverUI(pointer: Phaser.Input.Pointer): boolean {
    const tb = this.toolbar.screenBounds;
    if (pointer.x >= tb.left && pointer.x <= tb.right &&
        pointer.y >= tb.top  && pointer.y <= tb.bottom) {
      return true;
    }
    return false;
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    if (this.isPointerOverUI(pointer)) return;

    // Right-click → context menu
    if (pointer.rightButtonDown()) {
      this.showContextMenu(pointer);
      return;
    }

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

    if (this.activeTool === 'junction') {
      this.junctionCreator.onPointerDown(pointer);
    } else if (this.activeTool === 'completer') {
      this.trackCompleter.onPointerDown(pointer);
    } else if (this.activeTool === 'select') {
      const shift = pointer.event ? (pointer.event as MouseEvent).shiftKey : false;
      this.selectionManager.onPointerDown(world.x, world.y, shift);
    } else if (this.activeTool === 'eraser') {
      this.eraseAtPoint(world.x, world.y);
    } else if (this.activeTool === 'generator') {
      this.runGeneratorAt(world.x, world.y);
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

    if (this.activeTool === 'junction') {
      this.junctionCreator.onPointerMove(pointer);
    } else if (this.activeTool === 'select') {
      this.selectionManager.onPointerMove(world.x, world.y);
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const shift  = pointer.event ? (pointer.event as MouseEvent).shiftKey : false;

    if (this.activeTool === 'junction') {
      this.junctionCreator.onPointerUp(pointer);
    } else if (this.activeTool === 'select') {
      this.selectionManager.onPointerUp(world.x, world.y, shift);
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (GameStateManager.worldMode === 'create') {
      // Ctrl shortcuts
      if (event.ctrlKey) {
        if (event.code === 'KeyZ') { this.commandStack.undo(); return; }
        if (event.code === 'KeyY') { this.commandStack.redo(); return; }
        if (event.code === 'KeyS') {
          WorldManager.save();
          this.toolbar.setSaveIndicator('saved');
          return;
        }
      }

      // Keyboard tool shortcuts (only when no modifier)
      if (!event.ctrlKey && !event.altKey) {
        const shortcuts: Record<string, CreateTool> = {
          KeyV: 'select', KeyH: 'pan', KeyD: 'completer',
          KeyJ: 'junction', KeyG: 'generator', KeyE: 'eraser', KeyT: 'terrain-view',
        };
        const mapped = shortcuts[event.code];
        if (mapped) { this.toolbar.selectTool(mapped); return; }
      }

      if (event.code === 'Escape') {
        this.toolbar.selectTool('none');
        this.selectionManager.clearSelection();
        return;
      }

      if (this.activeTool === 'completer') {
        this.trackCompleter.onKeyDown(event);
      }

      if (event.code === 'Delete') {
        const uuids = this.selectionManager.selectedUUIDs;
        if (uuids.length > 0) this.deleteSelectedTracks(uuids);
      }
    }
  }

  // ── Reshape drag handles ───────────────────────────────────────────────────

  private handleHandleDrag(go: any, dragX: number, dragY: number): void {
    const trackUUID: string | undefined = go._trackUUID;
    const cpType: string | undefined = go._cpType;
    if (!trackUUID || !cpType) return;

    const track = this.trackManager.getTrack(trackUUID);
    if (!track) return;

    // Snapshot before-state on first drag event
    if (this.reshapingTrackUUID !== trackUUID) {
      this.reshapingTrackUUID = trackUUID;
      const def = WorldManager.world?.tracks.find((t) => t.uuid === trackUUID);
      this.reshapeBeforeDef = def ? { ...def } : null;
    }

    const snapped = this.snapSystem.snapPoint(dragX, dragY, [trackUUID]);
    const nx = snapped.x;
    const ny = snapped.y;

    const cps = track.getControlPoints();
    const newCps = { ...cps };
    (newCps as any)[cpType] = new Phaser.Math.Vector2(nx, ny);

    track.updateTrackVectors(newCps.p0, newCps.p1, newCps.p2, newCps.p3);

    // Move the handle game object to follow
    go.setPosition(nx, ny);
  }

  private handleHandleDragEnd(go: any): void {
    const trackUUID: string | undefined = go._trackUUID;
    if (!trackUUID || !this.reshapeBeforeDef) {
      this.reshapingTrackUUID = null;
      this.reshapeBeforeDef = null;
      return;
    }

    const track = this.trackManager.getTrack(trackUUID);
    if (!track) return;

    const curve = track.getCurvePath();
    const afterDef: TrackDef = {
      uuid: trackUUID,
      p0: curve.getStartPoint(),
      p1: curve.getPoint(0.33),
      p2: curve.getPoint(0.67),
      p3: curve.getEndPoint(),
      isTunnel: track.isTunnel,
      elevation: track.elevation,
    };

    const beforeDef = this.reshapeBeforeDef;
    const cmd = new ReshapeTrackCommand(this.trackManager, trackUUID, beforeDef, afterDef);
    // The drag already applied the change — record without re-executing
    this.commandStack.record(cmd);
    WorldManager.updateTrackDef(afterDef);

    this.reshapingTrackUUID = null;
    this.reshapeBeforeDef = null;
  }

  // ── Eraser tool ────────────────────────────────────────────────────────────

  private eraseAtPoint(wx: number, wy: number): void {
    const track = this.trackManager.getClosestTrack({ x: wx, y: wy }, 80);
    if (!track) return;
    this.deleteSelectedTracks([track.getUUID()]);
  }

  // ── Generator tool ─────────────────────────────────────────────────────────

  private runGeneratorAt(wx: number, wy: number): void {
    const generator = new TrackGenerator(this, this.trackManager, WorldManager.world?.seed);
    const tracks = generator.generateTracks({
      startPoint: new Phaser.Math.Vector2(wx, wy),
      startAngle: Phaser.Math.DegToRad(90),
      sections: GameConfig.GENERATION.MAIN.SECTIONS,
      minLength: GameConfig.GENERATION.MAIN.MIN_LENGTH,
      maxLength: GameConfig.GENERATION.MAIN.MAX_LENGTH,
      curveProbability: GameConfig.GENERATION.MAIN.CURVE_PROB,
      minCurveAngle: GameConfig.GENERATION.MAIN.MIN_ANGLE,
      maxCurveAngle: GameConfig.GENERATION.MAIN.MAX_ANGLE,
      smoothness: GameConfig.GENERATION.MAIN.SMOOTHNESS,
    });
    for (const track of tracks) {
      WorldManager.addTrackDef(this.trackToDef(track));
    }
    this.toolbar.setSaveIndicator('unsaved');
    EventBus.emit('ui:toast', { message: `Generated ${tracks.length} tracks`, type: 'success' });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  private deleteSelectedTracks(uuids: string[]): void {
    if (uuids.length === 0) return;
    const cmd = new DeleteTracksCommand(this.trackManager, uuids);
    this.commandStack.push(cmd);
    this.selectionManager.clearSelection();
    for (const uuid of uuids) {
      EventBus.emit('track:removed', { trackUUID: uuid });
    }
    this.toolbar.setSaveIndicator('unsaved');
  }

  // ── Context menu ───────────────────────────────────────────────────────────

  private showContextMenu(pointer: Phaser.Input.Pointer): void {
    const uuids = this.selectionManager.selectedUUIDs;
    let items;
    if (uuids.length > 0) {
      items = buildTrackContextItems(this.trackManager, uuids, (ids) => this.deleteSelectedTracks(ids));
    } else {
      items = buildEmptyContextItems(pointer.x, pointer.y, (sx, sy) => {
        const world = this.cameras.main.getWorldPoint(sx, sy);
        this.runGeneratorAt(world.x, world.y);
      });
    }
    if (items.length > 0) {
      this.contextMenu.show(pointer.x, pointer.y, items);
    }
  }

  // ── Cursor feedback ────────────────────────────────────────────────────────

  private updateToolCursor(tool: CreateTool): void {
    const cursors: Record<CreateTool, string> = {
      select:        'default',
      pan:           'grab',
      completer:     'crosshair',
      junction:      'cell',
      generator:     'crosshair',
      eraser:        'not-allowed',
      'terrain-view': 'default',
      none:          'default',
    };
    this.cameraController.setCursor(cursors[tool] ?? 'default');
  }

  // ── Minimap ───────────────────────────────────────────────────────────────

  private drawMinimap(): void {
    const { width, height } = this.scale;
    const mapW = 180;
    const mapH = 120;
    // Offset right to avoid overlapping the properties panel
    const mapX = width - mapW - 16;
    const mapY = height - mapH - 16;

    this.minimapGraphics.clear();
    this.minimapGraphics.fillStyle(0x06131f, 0.85);
    this.minimapGraphics.fillRect(mapX, mapY, mapW, mapH);
    this.minimapGraphics.lineStyle(1, 0xffffff, 0.3);
    this.minimapGraphics.strokeRect(mapX, mapY, mapW, mapH);

    const tracks = this.trackManager.tracks;
    if (tracks.length === 0) return;

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
      const isSelected  = this.selectionManager.isSelected(t.getUUID());
      const color = isSelected ? 0xffffff : (isConnected ? 0x00ff88 : 0xff4444);
      this.minimapGraphics.lineStyle(isSelected ? 2 : 1, color, 0.9);
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
