import Phaser from 'phaser';
import TrackManager from '../managers/TrackManager';
import { TrainManager } from '../managers/TrainManager';
import { WorldManager } from '../managers/WorldManager';
import { GameStateManager } from '../managers/GameStateManager';
import { SceneryManager } from '../managers/SceneryManager';
import { CameraController } from '../systems/CameraController';
import { InputManager } from '../systems/InputManager';
import { TerrainGenerator } from '../systems/TerrainGenerator';
import { TerrainChunkManager } from '../systems/TerrainChunkManager';
import { TerrainValidator } from '../systems/TerrainValidator';
import { SnapSystem } from '../systems/SnapSystem';
import { CommandStack } from '../systems/CommandStack';
import { TrainSerializer } from '../utils/TrainSerializer';
import { SelectionManager } from '../systems/SelectionManager';
import { EventBus } from '../services/EventBus';
import { WorldContentLoader } from '../services/WorldContentLoader';
import { AudioManager } from '../managers/AudioManager';
import { MinimapRenderer } from '../ui/MinimapRenderer';
import { buildTrackContextItems, buildEmptyContextItems } from '../ui/ContextMenu';
import {
  CONSTRUCTION_ANALYSIS_LOCK_REASON,
  CONSTRUCTION_ECONOMY_LOCK_REASON,
  disabledConstructionToolReason,
  type CreateTool,
} from '../ui/EditorToolbar';
import { GameConfig } from '../config/GameConfig';
import EditorUIScene from './EditorUIScene';
import { isMobileWidth, scalePx } from '../utils/responsive';
import type { IEditorTool } from '../systems/tools/IEditorTool';
import { SelectTool } from '../systems/tools/SelectTool';
import { PlaceVehicleTool } from '../systems/tools/PlaceVehicleTool';

/** Window augmentation for Playwright / E2E test hooks. */
declare global {
  interface Window {
    __railSimScene: string;
    __railSimWorldDerailCount: number;
    __railSimTrainManager: TrainManager | undefined;
    __railSimTrackManager: TrackManager | undefined;
  }
}

const EDITOR_UI_SCENE_KEY = 'EditorUIScene';
const TOOLBAR_PADDING = 2;

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
  private terrainGenerator!: TerrainGenerator;
  private terrainChunkManager!: TerrainChunkManager;
  private terrainValidator!: TerrainValidator;
  private sceneryManager!: SceneryManager;
  private snapSystem!: SnapSystem;
  private commandStack!: CommandStack;
  private selectionManager!: SelectionManager;

  /** Semi-transparent terrain overlay drawn when terrain-view tool is active. */
  private terrainOverlay!: Phaser.GameObjects.Graphics;
  private contentLoader!: WorldContentLoader;
  private minimapRenderer!: MinimapRenderer;
  private autoSaveTimer: number = 0;
  private activeTool: CreateTool = 'none';
  private worldLoadFailed = false;

  // ── Tool system ──────────────────────────────────────────────────────────
  private toolRegistry!: Map<CreateTool, IEditorTool>;
  private activeEditorTool: IEditorTool | null = null;

  private readonly modeChangedHandler = ({ mode }: { mode: 'create' | 'play' }) => {
    if (mode === 'create') this.activateCreateMode();
    else if (mode === 'play') this.activatePlayMode();
  };

  private readonly toolChangedHandler = ({ tool }: { tool: CreateTool }) => {
    if (GameStateManager.worldMode !== 'create') return;
    const disabledReason = disabledConstructionToolReason(tool);
    if (disabledReason) {
      this.activeEditorTool?.cancel();
      this.activeEditorTool?.deactivate();
      this.activeTool = 'none';
      this.activeEditorTool = null;
      EventBus.emit('ui:toast', { message: disabledReason, type: 'info' });
      return;
    }
    // Cancel and deactivate previous tool
    this.activeEditorTool?.cancel();
    this.activeEditorTool?.deactivate();
    this.activeTool = tool;
    this.activeEditorTool = this.toolRegistry.get(tool) ?? null;
    this.activeEditorTool?.activate();
    this.updateToolCursor(tool);
    // Set input lock owner: camera owns for free-pan tools, editor-tool owns for editing tools
    const freePanTools: CreateTool[] = ['none', 'pan', 'terrain-view'];
    const lockOwner: import('../systems/tools/IEditorTool').InputLockOwner =
      freePanTools.indexOf(tool) === -1 ? 'editor-tool' : 'camera';
    this.cameraController.setInputLockOwner(lockOwner);
  };

  private readonly undoHandler = () => {
    if (GameStateManager.worldMode === 'create') this.commandStack.undo();
  };
  private readonly redoHandler = () => {
    if (GameStateManager.worldMode === 'create') this.commandStack.redo();
  };
  private readonly generatorRunHandler = () => {
    if (GameStateManager.worldMode !== 'create') return;
    EventBus.emit('ui:toast', {
      message: CONSTRUCTION_ANALYSIS_LOCK_REASON,
      type: 'info',
    });
  };
  private readonly saveHandler = () => {
    if (GameStateManager.worldMode !== 'create') return;
    this.syncTrainsSaveAndReport();
  };

  private readonly modeToggleHandler = () => {
    if (GameStateManager.worldMode === 'create') {
      GameStateManager.enterPlay(WorldManager.currentWorldId ?? '');
    } else {
      GameStateManager.returnToCreate();
    }
  };

  private readonly editorDeleteHandler = ({ uuids }: { uuids: string[] }) => {
    if (GameStateManager.worldMode !== 'create') return;
    void uuids;
    this.reportEconomyLock();
  };

  private readonly vehicleTypeChangedHandler = ({ type }: { type: import('../config/VehicleTypes').VehicleType }) => {
    if (GameStateManager.worldMode !== 'create') return;
    const placeVehicleTool = this.toolRegistry.get('place-vehicle') as PlaceVehicleTool | undefined;
    placeVehicleTool?.setVehicleType(type);
  };

  constructor() {
    super({ key: 'WorldScene' });
  }

  init(data: { worldId?: string; mode?: 'create' | 'play' }): void {
    this.worldLoadFailed = false;
    if (data.worldId && !WorldManager.load(data.worldId)) {
      this.worldLoadFailed = true;
      return;
    }
    const startMode = data.mode ?? 'create';
    if (startMode === 'create') {
      GameStateManager.enterCreate(WorldManager.currentWorldId ?? '');
    } else {
      GameStateManager.enterPlay(WorldManager.currentWorldId ?? '');
    }
  }

  create(): void {
    if (this.worldLoadFailed) {
      this.scene.start('WorldSelectScene');
      return;
    }
    // Expose scene identity and E2E accessors
    window.__railSimScene = 'WorldScene';
    window.__railSimWorldDerailCount = 0;

    // ── Terrain system ──────────────────────────────────────────────────────
    const world = WorldManager.world;
    const terrainSeed = world?.generationConfig.seed ?? 'default';
    const biome = world?.generationConfig.biome ?? 'temperate';

    this.terrainGenerator    = new TerrainGenerator(terrainSeed);
    this.terrainValidator    = new TerrainValidator(this.terrainGenerator);
    this.terrainChunkManager = new TerrainChunkManager(this, this.terrainGenerator, biome);
    this.sceneryManager      = new SceneryManager(this, this.terrainGenerator, biome, terrainSeed);
    this.terrainOverlay      = this.add.graphics().setDepth(-50).setScrollFactor(0);

    this.trackManager    = new TrackManager(this);
    this.cameraController = new CameraController(this);
    this.trainManager    = new TrainManager(this, this.trackManager, this.cameraController);
    this.inputManager    = new InputManager(this, this.cameraController);
    this.audioManager    = new AudioManager(this);

    // ── Editor systems ─────────────────────────────────────────────────────
    this.snapSystem     = new SnapSystem(this.trackManager);
    this.commandStack   = new CommandStack(GameConfig.WORLD.MAX_UNDO_STEPS);
    this.commandStack.onChange = (canUndo, canRedo) => {
      EventBus.emit('ui:toolbar-undo-state', { canUndo, canRedo });
      EventBus.emit('ui:toolbar-save-state', { state: 'unsaved' });
    };
    this.selectionManager = new SelectionManager(this, this.trackManager, this.snapSystem);

    // ── Tool registry ──────────────────────────────────────────────────────
    this.toolRegistry = new Map<CreateTool, IEditorTool>();
    this.toolRegistry.set('select', new SelectTool(this.selectionManager));
    this.toolRegistry.set('place-vehicle', new PlaceVehicleTool(this, this.trackManager, this.trainManager));

    // ── UI (owned by EditorUIScene to be unaffected by WorldScene camera zoom) ──
    this.scene.launch(EDITOR_UI_SCENE_KEY, { trackManager: this.trackManager, selectionManager: this.selectionManager });

    this.minimapRenderer = new MinimapRenderer(this, this.trackManager, this.selectionManager);

    // Load world content
    this.contentLoader = new WorldContentLoader(this, this.trackManager, this.trainManager);
    this.contentLoader.load();

    // HUD and debug overlays
    this.scene.launch('HUDScene');
    this.scene.launch('DebugOverlayScene');

    // Subscribe to events
    EventBus.on('mode:changed',       this.modeChangedHandler);
    EventBus.on('tool:changed',       this.toolChangedHandler);
    EventBus.on('editor:undo',        this.undoHandler);
    EventBus.on('editor:redo',        this.redoHandler);
    EventBus.on('editor:save',        this.saveHandler);
    EventBus.on('editor:mode-toggle', this.modeToggleHandler);
    EventBus.on('generator:run',      this.generatorRunHandler);
    EventBus.on('editor:delete-tracks', this.editorDeleteHandler);
    EventBus.on('vehicle:type-changed', this.vehicleTypeChangedHandler);

    // Expose managers for E2E tests after everything is constructed
    window.__railSimTrainManager = this.trainManager;
    window.__railSimTrackManager = this.trackManager;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('mode:changed',        this.modeChangedHandler);
      EventBus.off('tool:changed',        this.toolChangedHandler);
      EventBus.off('editor:undo',         this.undoHandler);
      EventBus.off('editor:redo',         this.redoHandler);
      EventBus.off('editor:save',         this.saveHandler);
      EventBus.off('editor:mode-toggle',  this.modeToggleHandler);
      EventBus.off('generator:run',       this.generatorRunHandler);
      EventBus.off('editor:delete-tracks', this.editorDeleteHandler);
      EventBus.off('vehicle:type-changed', this.vehicleTypeChangedHandler);
      this.scene.stop(EDITOR_UI_SCENE_KEY);
      for (const tool of this.toolRegistry.values()) tool.destroy();
      this.selectionManager.destroy();
      this.terrainChunkManager.destroyAll();
      this.sceneryManager.destroyAll();
      window.__railSimTrainManager = undefined;
      window.__railSimTrackManager = undefined;
    });

    // Input routing
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup',   this.handlePointerUp,   this);
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

    // Stream terrain chunks and scenery around the camera
    const cam = this.cameras.main;
    const camCX = cam.scrollX + cam.width / (2 * cam.zoom);
    const camCY = cam.scrollY + cam.height / (2 * cam.zoom);
    this.terrainChunkManager.update(camCX, camCY, cam.zoom);
    this.sceneryManager.update(camCX, camCY, cam.zoom);

    // Terrain overlay when tool is active
    this.updateTerrainOverlay();

    if (GameStateManager.worldMode === 'create') {
      this.activeEditorTool?.update(delta);
      this.minimapRenderer.draw();
      this.autoSaveTimer += delta / 1000;
      if (this.autoSaveTimer >= GameConfig.WORLD.AUTO_SAVE_INTERVAL_SECS) {
        this.autoSaveTimer = 0;
        this.syncTrainsSaveAndReport();
      }
      GameStateManager.tick(delta / 1000);
    } else if (GameStateManager.worldMode === 'play' && GameStateManager.state === 'playing') {
      this.inputManager.handleTrainMovement(this.trainManager.selectedTrain);
      this.trainManager.update(time, delta);
      this.contentLoader.stations.forEach((s) => s.update(delta));
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

  // ── Mode switching ────────────────────────────────────────────────────────

  private activateCreateMode(): void {
    for (const train of this.trainManager.trains) {
      train.enginePower = 0;
    }
    this.cameraController.stopFollow();
    EventBus.emit('ui:toolbar-visible', { visible: true });
    this.syncTrainsSaveAndReport();
  }

  private syncTrainsAndSave(): boolean {
    const trainDefs = this.trainManager.trains
      .map((t) => TrainSerializer.toTrainDef(t))
      .filter((d): d is import('../config/WorldData').TrainDef => d !== null);
    const carriageDefs = this.trainManager.carriages
      .map((c) => TrainSerializer.toTrainDef(c))
      .filter((d): d is import('../config/WorldData').TrainDef => d !== null);
    WorldManager.setTrainDefs([...trainDefs, ...carriageDefs]);
    return WorldManager.save();
  }

  private syncTrainsSaveAndReport(): void {
    if (this.syncTrainsAndSave()) {
      EventBus.emit('ui:toolbar-save-state', { state: 'saved' });
      return;
    }
    EventBus.emit('ui:toolbar-save-state', { state: 'unsaved' });
    EventBus.emit('ui:toast', {
      message: 'Could not save the world.',
      type: 'error',
    });
  }

  private activatePlayMode(): void {
    this.minimapRenderer.clear();
    this.selectionManager.clearSelection();
    this.inputManager.setupClickHandling(this.trainManager);
    EventBus.emit('ui:toolbar-visible', { visible: false });
    // Auto-follow the first available train
    const trains = this.trainManager.trains;
    if (trains.length > 0) {
      this.trainManager.selectTrain(trains[0]);
    }
  }

  // ── Input dispatch ─────────────────────────────────────────────────────────

  /** Return true if the pointer's screen position overlaps any editor UI panel. */
  private isPointerOverUI(pointer: Phaser.Input.Pointer): boolean {
    const { width, height } = this.scale;
    const toolbarWidth = scalePx(72, width, height, isMobileWidth(width) ? 44 : 56);
    return pointer.x <= toolbarWidth + TOOLBAR_PADDING;
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    if (this.isPointerOverUI(pointer)) return;

    // Right-click: check if active tool wants it first, otherwise show context menu
    if (pointer.rightButtonDown()) {
      if (this.activeEditorTool?.wantsPointerButton(2)) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.activeEditorTool.onPointerDown(world.x, world.y, pointer);
      } else {
        this.showContextMenu(pointer);
      }
      return;
    }

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.activeEditorTool?.onPointerDown(world.x, world.y, pointer);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.activeEditorTool?.onPointerMove(world.x, world.y, pointer);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.activeEditorTool?.onPointerUp(world.x, world.y, pointer);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (GameStateManager.worldMode === 'create') {
      // Ctrl shortcuts
      if (event.ctrlKey) {
        if (event.code === 'KeyZ') { this.commandStack.undo(); return; }
        if (event.code === 'KeyY') { this.commandStack.redo(); return; }
        if (event.code === 'KeyS') {
          this.syncTrainsSaveAndReport();
          return;
        }
      }

      // Keyboard tool shortcuts (only when no modifier)
      if (!event.ctrlKey && !event.altKey) {
        const shortcuts: Record<string, CreateTool> = {
          KeyV: 'select', KeyH: 'pan', KeyT: 'terrain-view',
          KeyN: 'place-vehicle',
        };
        const mapped = shortcuts[event.code];
        if (mapped) { EventBus.emit('ui:toolbar-select-tool', { tool: mapped }); return; }
      }

      if (event.code === 'Escape') {
        // Cancel the active tool first, then clear selection
        this.activeEditorTool?.cancel();
        this.selectionManager.clearSelection();
        EventBus.emit('ui:toolbar-select-tool', { tool: 'none' });
        return;
      }

      // Delegate to active tool
      this.activeEditorTool?.onKeyDown(event);

      if (event.code === 'Delete') {
        if (this.selectionManager.selectedUUIDs.length > 0) {
          this.reportEconomyLock();
        }
      }
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  private deleteSelectedTracks(uuids: string[]): void {
    if (uuids.length === 0) return;
    this.reportEconomyLock();
  }

  private reportEconomyLock(): void {
    EventBus.emit('ui:toast', {
      message: CONSTRUCTION_ECONOMY_LOCK_REASON,
      type: 'info',
    });
  }

  // ── Context menu ───────────────────────────────────────────────────────────

  private showContextMenu(pointer: Phaser.Input.Pointer): void {
    const uuids = this.selectionManager.selectedUUIDs;
    let items;
    if (uuids.length > 0) {
      items = buildTrackContextItems(this.trackManager, uuids, (ids) => this.deleteSelectedTracks(ids));
    } else {
      items = buildEmptyContextItems(pointer.x, pointer.y, () => {});
    }
    if (items.length > 0) {
      const editorUI = this.scene.get(EDITOR_UI_SCENE_KEY) as EditorUIScene | null;
      editorUI?.showContextMenu(pointer.x, pointer.y, items);
    }
  }

  // ── Cursor feedback ────────────────────────────────────────────────────────

  private updateToolCursor(tool: CreateTool): void {
    const cursors: Record<CreateTool, string> = {
      select:          'default',
      pan:             'grab',
      completer:       'crosshair',
      junction:        'cell',
      generator:       'crosshair',
      eraser:          'not-allowed',
      'terrain-view':  'default',
      'place-track':   'crosshair',
      'place-vehicle': 'crosshair',
      none:            'default',
    };
    this.cameraController.setCursor(cursors[tool] ?? 'default');
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

}
