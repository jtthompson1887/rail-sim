import Phaser from 'phaser';
import TrackManager from '../managers/TrackManager';
import type { TrackTopologySnapshot } from '../managers/TrackManager';
import { TrainManager } from '../managers/TrainManager';
import { WorldManager } from '../managers/WorldManager';
import { GameStateManager } from '../managers/GameStateManager';
import { SceneryManager } from '../managers/SceneryManager';
import {
  CameraController,
  clampCameraZoom,
} from '../systems/CameraController';
import {
  InputManager,
  isGameplayInputFocused,
} from '../systems/InputManager';
import { TerrainGenerator } from '../systems/TerrainGenerator';
import { TerrainChunkManager } from '../systems/TerrainChunkManager';
import { TerrainValidator } from '../systems/TerrainValidator';
import { ConstructionAnalyzer } from '../systems/ConstructionAnalyzer';
import { ConstructionService } from '../systems/ConstructionService';
import { SnapSystem } from '../systems/SnapSystem';
import { CommandStack } from '../systems/CommandStack';
import { SelectionManager } from '../systems/SelectionManager';
import { EventBus } from '../services/EventBus';
import { WorldContentLoader } from '../services/WorldContentLoader';
import { AudioManager } from '../managers/AudioManager';
import { buildTrackContextItems, buildEmptyContextItems } from '../ui/ContextMenu';
import {
  GENERATOR_LOCK_REASON,
  disabledConstructionToolReason,
  type CreateTool,
} from '../ui/EditorToolbar';
import { GameConfig } from '../config/GameConfig';
import { REGIONAL_DEVELOPMENT_GRANT } from '../config/FreightProgression';
import EditorUIScene from './EditorUIScene';
import { isMobileWidth, scalePx } from '../utils/responsive';
import type {
  IEditorTool,
  InputLockOwner,
} from '../systems/tools/IEditorTool';
import { SelectTool } from '../systems/tools/SelectTool';
import { PlaceVehicleTool } from '../systems/tools/PlaceVehicleTool';
import { PlaceTrackTool } from '../systems/tools/PlaceTrackTool';
import { DeleteTracksCommand } from '../commands/DeleteTracksCommand';
import { demolitionRefund } from '../systems/ConstructionEconomy';
import type {
  DeletionReviewDTO,
  DeleteTracksIntent,
} from '../ui/PropertiesPanel';
import { clonePlainData } from '../utils/PlainData';
import {
  captureTrainRuntime,
  type TrainRuntimeSnapshot,
} from '../freight/TrainRuntime';
import type {
  CargoBlockerCode,
  CargoTransferStatus,
  FreightDeliveryEvent,
} from '../freight/CargoSystem';
import {
  capacityForProduct,
  FLATBED_FREIGHT_SET_ID,
  getFreightSet,
} from '../freight/FreightSetCatalog';
import {
  queryRailAccessConnectivity,
  type RailAccessConnectivityResult,
} from '../freight/RailAccessConnectivity';
import { TrainSerializer } from '../utils/TrainSerializer';
import type { WorldData } from '../config/WorldData';
import type {
  ConstructionPreviewModel,
  ConstructionToolPhase,
} from '../ui/ConstructionPreviewOverlay';
import {
  ECONOMY_TICK_MS,
  EconomySystem,
  type EconomyUpdateResult,
} from '../economy/EconomySystem';
import {
  buildFacilityInspection,
  type FacilityInspectionDto,
} from '../economy/FacilityPresentation';
import type { FacilityEconomyDef } from '../economy/EconomyData';
import {
  FacilityView,
  type FacilityViewPlacement,
} from '../entities/FacilityView';
import {
  FreightPurchaseService,
  type FreightPurchaseQuote,
  type FreightPurchaseRuntimePort,
} from '../freight/FreightPurchaseService';
import {
  buildOperatingSummary,
  buildTrainInspection,
} from '../freight/FreightPresentation';
import {
  deriveFreightObjective,
  freightObjectiveCelebrationSession,
  type FreightObjectiveDto,
} from '../freight/FreightObjective';
import { getProduct } from '../economy/ProductCatalog';

interface ConstructionE2ESnapshot {
  readonly phase: ConstructionToolPhase;
  readonly preview: ConstructionPreviewModel | null;
  readonly camera: Readonly<{
    scrollX: number;
    scrollY: number;
    zoom: number;
    width: number;
    height: number;
  }>;
  readonly world: WorldData | null;
  readonly topology: TrackTopologySnapshot;
}

export interface FirstRouteBrowserSnapshot {
  readonly world: WorldData;
  readonly runtime: readonly TrainRuntimeSnapshot[];
  readonly saveState: 'saved' | 'unsaved' | 'saving';
  readonly objective: FreightObjectiveDto;
  readonly construction: {
    readonly phase: ConstructionToolPhase;
    readonly preview: ConstructionPreviewModel | null;
    readonly topology: TrackTopologySnapshot;
  };
  readonly camera: {
    readonly scrollX: number;
    readonly scrollY: number;
    readonly zoom: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface FirstRouteBrowserHarness {
  snapshot(): FirstRouteBrowserSnapshot;
  setMode(mode: 'create' | 'play'): void;
  advanceFixedTicks(count: number): void;
  setTrainRuntime(
    trainId: string,
    runtime: Pick<
      TrainRuntimeSnapshot,
      'x' | 'y' | 'speedWorldUnitsPerSecond' | 'throttle' | 'derailed'
    >,
  ): void;
  retrySave(): boolean;
}

/** Window augmentation for Playwright / E2E test hooks. */
declare global {
  interface Window {
    __railSimScene: string;
    __railSimWorldDerailCount: number;
    __railSimTrainManager: TrainManager | undefined;
    __railSimTrackManager: TrackManager | undefined;
    __railSimConstructionSnapshot:
      (() => ConstructionE2ESnapshot) | undefined;
    __railSimFirstRouteHarness: FirstRouteBrowserHarness | undefined;
  }
}

const EDITOR_UI_SCENE_KEY = 'EditorUIScene';
const TOOLBAR_PADDING = 2;
const SAVE_FAILURE_MESSAGE = 'Could not save the world. Retry Save is available.';
const OPPORTUNITY_CORRIDOR_WIDTH_PX = 24;
const OPPORTUNITY_CORRIDOR_LABEL_OFFSET_PX = 34;
const OPPORTUNITY_CORRIDOR_LABEL_SEPARATION_PX = 24;
type SaveState = 'saved' | 'unsaved' | 'saving';

const deepFreezePlainData = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    const record = value as Record<string, unknown>;
    Object.keys(record).forEach(
      (key) => deepFreezePlainData(record[key]),
    );
    Object.freeze(value);
  }
  return value;
};

function deletionBlockingReason(
  world: WorldData,
  uuids: ReadonlyArray<string>,
): string {
  const selected = new Set(uuids);
  const stationIds = new Set(
    world.stations
      .filter((station) => selected.has(station.trackUUID))
      .map((station) => station.id),
  );
  if (stationIds.size > 0) {
    return 'Deletion blocked · Remove stations from these tracks first';
  }
  if (world.trains.some((train) => selected.has(train.trackUUID))) {
    return 'Deletion blocked · Move trains off these tracks first';
  }
  return '';
}

function polylineMidpoint(
  points: ReadonlyArray<Readonly<{ x: number; y: number }>>,
): { x: number; y: number } {
  const lengths = points.slice(1).map((point, index) => Math.hypot(
    point.x - points[index].x,
    point.y - points[index].y,
  ));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (remaining <= length) {
      const ratio = length > 0 ? remaining / length : 0;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    remaining -= length;
  }
  const fallback = points[points.length - 1] ?? { x: 0, y: 0 };
  return { x: fallback.x, y: fallback.y };
}

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
  private readonly starterOpportunityLabels: Phaser.GameObjects.Text[] = [];
  private facilityViews: FacilityView[] = [];
  private readonly facilityInspections = new Map<string, FacilityInspectionDto>();
  private selectedFacilityId: string | null = null;
  private contentLoader!: WorldContentLoader;
  private autoSaveTimer: number = 0;
  private lastReportedSaveState: SaveState = 'saved';
  private pendingStartupSaveError: string | null = null;
  private capturingStartupSaveOutcome = false;
  private activeTool: CreateTool = 'none';
  private worldLoadFailed = false;
  private economySystem = new EconomySystem();
  private freightPurchaseService!: FreightPurchaseService;
  private readonly operationsLockedTrainIds = new Set<string>();
  private readonly cargoStatusByTrainId =
    new Map<string, CargoTransferStatus>();
  private constructionHistoryClearedForOperations = false;
  private firstRouteHarnessControlsRuntime = false;

  // ── Tool system ──────────────────────────────────────────────────────────
  private toolRegistry!: Map<CreateTool, IEditorTool>;
  private activeEditorTool: IEditorTool | null = null;

  private inputLockOwnerForTool(tool: CreateTool): InputLockOwner {
    return ['none', 'pan', 'terrain-view'].indexOf(tool) === -1
      ? 'editor-tool'
      : 'camera';
  }

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
      this.updateFacilitySelectionAvailability();
      this.updateToolCursor('none');
      this.cameraController.setInputLockOwner('camera');
      EventBus.emit('ui:toast', { message: disabledReason, type: 'info' });
      return;
    }
    // Cancel and deactivate previous tool
    this.activeEditorTool?.cancel();
    this.activeEditorTool?.deactivate();
    this.activeTool = tool;
    this.activeEditorTool = this.toolRegistry.get(tool) ?? null;
    if (tool === 'place-track') this.clearFacilitySelection();
    this.updateFacilitySelectionAvailability();
    this.activeEditorTool?.activate();
    this.updateToolCursor(tool);
    // Set input lock owner: camera owns for free-pan tools, editor-tool owns for editing tools
    this.cameraController.setInputLockOwner(
      this.inputLockOwnerForTool(tool),
    );
  };

  private readonly undoHandler = () => {
    if (GameStateManager.worldMode !== 'create') return;
    if (this.activeTool === 'place-track') this.activeEditorTool?.cancel();
    this.commandStack.undo();
  };
  private readonly redoHandler = () => {
    if (GameStateManager.worldMode !== 'create') return;
    if (this.activeTool === 'place-track') this.activeEditorTool?.cancel();
    this.commandStack.redo();
  };
  private readonly generatorRunHandler = () => {
    if (GameStateManager.worldMode !== 'create') return;
    EventBus.emit('ui:toast', {
      message: GENERATOR_LOCK_REASON,
      type: 'info',
    });
  };
  private readonly saveHandler = () => {
    if (GameStateManager.worldMode !== 'create') return;
    this.saveWorldAndReport();
  };

  private readonly modeToggleHandler = () => {
    if (GameStateManager.worldMode === 'create') {
      GameStateManager.enterPlay(WorldManager.currentWorldId ?? '');
    } else {
      GameStateManager.returnToCreate();
    }
  };

  private readonly editorDeleteHandler = (intent: DeleteTracksIntent) => {
    if (GameStateManager.worldMode !== 'create') return;
    const world = WorldManager.world;
    const selected = this.selectionManager.selectedUUIDs;
    const exactSelection = selected.length === intent.uuids.length
      && selected.every((uuid, index) => uuid === intent.uuids[index]);
    const refund = intent.uuids.reduce((sum, uuid) => {
      const track = world?.tracks.find((candidate) => candidate.uuid === uuid);
      return track ? sum + demolitionRefund(track.paidBuildCost) : Number.NaN;
    }, 0);
    if (!world
      || intent.expectedConstructionRevision !== world.constructionRevision
      || !exactSelection
      || !Number.isSafeInteger(refund)
      || refund !== intent.expectedRefund) {
      EventBus.emit('ui:toast', {
        message: 'Deletion changed — review the refund again.',
        type: 'warning',
      });
      this.publishDeletionReview(selected);
      return;
    }
    const blockingReason = deletionBlockingReason(world, intent.uuids);
    if (blockingReason) {
      EventBus.emit('ui:toast', {
        message: blockingReason.replace(' · ', ': '),
        type: 'warning',
      });
      this.publishDeletionReview(selected);
      return;
    }
    const command = new DeleteTracksCommand(
      this.trackManager,
      this,
      intent.uuids,
    );
    if (!this.commandStack.push(command)) {
      EventBus.emit('ui:toast', {
        message: 'Deletion could not be completed because the railway changed.',
        type: 'warning',
      });
      this.publishDeletionReview(selected);
      return;
    }
    this.selectionManager.clearSelection();
  };

  private readonly constructionIntentHandler = ({
    action,
  }: {
    action: 'confirm' | 'backstep' | 'cancel';
  }) => {
    if (GameStateManager.worldMode !== 'create'
      || this.activeTool !== 'place-track') return;
    const tool = this.activeEditorTool as PlaceTrackTool | null;
    if (action === 'confirm') tool?.confirm();
    else if (action === 'backstep') tool?.backstep();
    else tool?.cancel();
  };

  private readonly selectionChangedHandler = ({ uuids }: { uuids: string[] }) => {
    this.publishDeletionReview(uuids);
    if (uuids.length > 0) this.clearFacilitySelection();
  };

  private readonly trainSelectedHandler = () => {
    this.clearFacilitySelection();
  };

  private readonly trainDeselectedHandler = () => {
    EventBus.emit('ui:train-inspection', { inspection: null });
  };

  private readonly facilitySelectedHandler = ({
    facilityId,
  }: {
    facilityId: string;
  }) => {
    if (!this.facilityViews.some(
      (view) => view.facilityId === facilityId,
    )) return;
    this.selectionManager.clearSelection();
    this.trainManager.deselectTrain();
    this.selectedFacilityId = facilityId;
    for (const view of this.facilityViews) {
      view.setSelected(view.facilityId === facilityId);
    }
    this.refreshFacilityPresentation(true);
  };

  private readonly vehicleTypeChangedHandler = ({ type }: { type: import('../config/VehicleTypes').VehicleType }) => {
    if (GameStateManager.worldMode !== 'create') return;
    const placeVehicleTool = this.toolRegistry.get('place-vehicle') as PlaceVehicleTool | undefined;
    placeVehicleTool?.setVehicleType(type);
  };

  private readonly freightPurchaseModeRequestedHandler = ({
    freightSetId,
  }: {
    freightSetId: typeof FLATBED_FREIGHT_SET_ID;
  }) => {
    if (GameStateManager.worldMode !== 'create') return;
    const tool = this.toolRegistry.get(
      'place-vehicle',
    ) as PlaceVehicleTool | undefined;
    tool?.setFreightSetId(freightSetId);
    EventBus.emit('ui:toolbar-select-tool', { tool: 'place-vehicle' });
  };

  private readonly freightPurchaseConfirmedHandler = ({
    quote,
  }: {
    quote: FreightPurchaseQuote;
  }) => {
    if (GameStateManager.worldMode !== 'create') return;
    const purchaseResult = this.freightPurchaseService.purchase(
      quote,
    );
    const detachedResult = Object.freeze({ ...purchaseResult });

    if (purchaseResult.ok) {
      const report = this.commandStack.onChange;
      this.commandStack.onChange = undefined;
      try {
        this.commandStack.clear();
      } finally {
        this.commandStack.onChange = report;
      }
      EventBus.emit('ui:toolbar-undo-state', {
        canUndo: false,
        canRedo: false,
      });
      this.selectionManager.clearSelection();
      const train = this.trainManager.trains.find(
        (candidate) => candidate.getUUID() === purchaseResult.trainId,
      );
      if (train) this.trainManager.selectTrain(train.getUUID());
      this.clearFacilitySelection();
      this.reportSaveState(purchaseResult.saveState);
      if (!purchaseResult.saved) {
        EventBus.emit('ui:toast', {
          message: SAVE_FAILURE_MESSAGE,
          type: 'error',
        });
      }
    }

    EventBus.emit('freight:purchase-result', detachedResult);
  };

  constructor() {
    super({ key: 'WorldScene' });
  }

  init(data: { worldId?: string; mode?: 'create' | 'play' }): void {
    this.activeTool = 'none';
    this.activeEditorTool = null;
    this.worldLoadFailed = false;
    this.lastReportedSaveState = 'saved';
    this.pendingStartupSaveError = null;
    this.capturingStartupSaveOutcome = false;
    this.economySystem = new EconomySystem();
    this.operationsLockedTrainIds.clear();
    this.cargoStatusByTrainId.clear();
    this.constructionHistoryClearedForOperations = false;
    this.firstRouteHarnessControlsRuntime = false;
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
    if (
      typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined'
      && __RAIL_SIM_TEST_CONTROLS__
    ) {
      window.__railSimScene = 'WorldScene';
      window.__railSimWorldDerailCount = 0;
    }

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
    this.freightPurchaseService = new FreightPurchaseService(
      WorldManager,
      this.createFreightPurchaseRuntimePort(),
    );

    // ── Editor systems ─────────────────────────────────────────────────────
    this.snapSystem     = new SnapSystem(this.trackManager);
    this.commandStack   = new CommandStack(GameConfig.WORLD.MAX_UNDO_STEPS);
    this.bindCommandStackReporting();
    this.selectionManager = new SelectionManager(this, this.trackManager, this.snapSystem);

    // ── Tool registry ──────────────────────────────────────────────────────
    this.toolRegistry = new Map<CreateTool, IEditorTool>();
    this.toolRegistry.set('select', new SelectTool(this.selectionManager));
    if (world) {
      const constructionService = new ConstructionService(
        this.trackManager,
        new ConstructionAnalyzer(this.terrainGenerator),
      );
      this.toolRegistry.set('place-track', new PlaceTrackTool(
        this,
        this.trackManager,
        this.snapSystem,
        constructionService,
        this.commandStack,
      ));
    }
    this.toolRegistry.set('place-vehicle', new PlaceVehicleTool(
      this,
      this.trackManager,
      this.trainManager,
      this.commandStack,
      this.freightPurchaseService,
    ));

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
    EventBus.on('construction:intent', this.constructionIntentHandler);
    EventBus.on('selection:changed', this.selectionChangedHandler);
    EventBus.on('train:selected', this.trainSelectedHandler);
    EventBus.on('train:deselected', this.trainDeselectedHandler);
    EventBus.on('facility:selected', this.facilitySelectedHandler);
    EventBus.on('vehicle:type-changed', this.vehicleTypeChangedHandler);
    EventBus.on(
      'freight:purchase-mode-requested',
      this.freightPurchaseModeRequestedHandler,
    );
    EventBus.on(
      'freight:purchase-confirmed',
      this.freightPurchaseConfirmedHandler,
    );

    if (
      typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined'
      && __RAIL_SIM_TEST_CONTROLS__
    ) {
      window.__railSimTrainManager = this.trainManager;
      window.__railSimTrackManager = this.trackManager;
      window.__railSimConstructionSnapshot = () => {
        const placeTrack = this.toolRegistry.get(
          'place-track',
        ) as PlaceTrackTool | undefined;
        const camera = this.cameras.main;
        return clonePlainData({
          phase: placeTrack?.phase ?? 'idle',
          preview: placeTrack?.previewModel ?? null,
          camera: {
            scrollX: camera.scrollX,
            scrollY: camera.scrollY,
            zoom: camera.zoom,
            width: camera.width,
            height: camera.height,
          },
          world: WorldManager.world,
          topology: this.trackManager.captureTopology(),
        });
      };
      window.__railSimFirstRouteHarness = {
        snapshot: () => this.captureFirstRouteBrowserSnapshot(),
        setMode: (mode) => this.setFirstRouteBrowserMode(mode),
        advanceFixedTicks: (count) => this.advanceFirstRouteFixedTicks(count),
        setTrainRuntime: (trainId, runtime) => {
          this.setFirstRouteTrainRuntime(trainId, runtime);
        },
        retrySave: () => this.saveWorldAndReport(),
      };
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('mode:changed',        this.modeChangedHandler);
      EventBus.off('tool:changed',        this.toolChangedHandler);
      EventBus.off('editor:undo',         this.undoHandler);
      EventBus.off('editor:redo',         this.redoHandler);
      EventBus.off('editor:save',         this.saveHandler);
      EventBus.off('editor:mode-toggle',  this.modeToggleHandler);
      EventBus.off('generator:run',       this.generatorRunHandler);
      EventBus.off('editor:delete-tracks', this.editorDeleteHandler);
      EventBus.off('construction:intent', this.constructionIntentHandler);
      EventBus.off('selection:changed', this.selectionChangedHandler);
      EventBus.off('train:selected', this.trainSelectedHandler);
      EventBus.off('train:deselected', this.trainDeselectedHandler);
      EventBus.off('facility:selected', this.facilitySelectedHandler);
      EventBus.off('vehicle:type-changed', this.vehicleTypeChangedHandler);
      EventBus.off(
        'freight:purchase-mode-requested',
        this.freightPurchaseModeRequestedHandler,
      );
      EventBus.off(
        'freight:purchase-confirmed',
        this.freightPurchaseConfirmedHandler,
      );
      this.scene.stop(EDITOR_UI_SCENE_KEY);
      for (const tool of this.toolRegistry.values()) tool.destroy();
      this.selectionManager.destroy();
      this.terrainChunkManager.destroyAll();
      this.sceneryManager.destroyAll();
      for (const view of this.facilityViews) view.destroy();
      this.facilityViews = [];
      this.facilityInspections.clear();
      this.selectedFacilityId = null;
      this.operationsLockedTrainIds.clear();
      this.cargoStatusByTrainId.clear();
      if (
        typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined'
        && __RAIL_SIM_TEST_CONTROLS__
      ) {
        window.__railSimTrainManager = undefined;
        window.__railSimTrackManager = undefined;
        window.__railSimConstructionSnapshot = undefined;
        window.__railSimFirstRouteHarness = undefined;
      }
    });

    // Input routing
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup',   this.handlePointerUp,   this);
    this.input.on('pointerupoutside', this.handlePointerUp, this);
    this.input.on('pointercancel', this.handlePointerCancel, this);
    this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
      this.handleKeyDown(event);
    });

    // ESC → pause in play mode
    this.input.keyboard.on('keydown-ESC', () => {
      if (GameStateManager.worldMode === 'play' && GameStateManager.state === 'playing') {
        GameStateManager.pause();
        EventBus.emit('ui:pause-visible', { visible: true });
        this.scene.launch('PauseScene');
        this.scene.pause();
      }
    });

    // Apply initial mode before launching the editor UI so launch data reflects
    // the completed startup persistence outcome.
    this.capturingStartupSaveOutcome = true;
    if (GameStateManager.worldMode === 'create') {
      this.activateCreateMode();
    } else {
      this.activatePlayMode();
    }
    this.capturingStartupSaveOutcome = false;

    this.scene.launch(EDITOR_UI_SCENE_KEY, {
      trackManager: this.trackManager,
      selectionManager: this.selectionManager,
      visible: GameStateManager.worldMode === 'create',
      companyCash: world?.company.cash ?? 0,
      economyTick: world?.economy.tick ?? 0,
      constructionIndexBps:
        world?.economy.market.constructionIndexBps ?? 10_000,
      operatingSummary: world
        ? buildOperatingSummary(world.company, world.economy.tick)
        : {
          fromTick: 0,
          throughTick: 0,
          deliveryRevenue: 0,
          contractBonuses: 0,
          runningExpenses: 0,
          operatingProfit: 0,
          capitalExpenditure: 0,
          cashFlow: 0,
        },
      saveState: this.lastReportedSaveState,
      saveErrorMessage: this.pendingStartupSaveError ?? undefined,
    });
    this.pendingStartupSaveError = null;

    this.applyStarterOpportunityCamera();
    this.renderStarterOpportunitySurvey();
    this.renderFacilities();
    EventBus.emit('ui:freight-purchase-state', {
      quote: null,
      cash: world?.company.cash ?? 0,
      message: 'Click on player track to place the General Flatbed Set',
    });
    this.publishFreightPresentation(
      (this.trainManager?.trains ?? []).map(
        (train) => captureTrainRuntime(train),
      ),
    );
  }

  /** Frame the persisted planning opportunity without regenerating it. */
  private applyStarterOpportunityCamera(): void {
    const recommendation = WorldManager.world?.starterOpportunity.recommendedCamera;
    if (!recommendation) return;
    const viewportScale = Math.min(
      this.scale.width / GameConfig.RESOLUTION.WIDTH,
      this.scale.height / GameConfig.RESOLUTION.HEIGHT,
    );
    const zoom = clampCameraZoom(recommendation.zoom * viewportScale);
    const toolbarInset = GameStateManager.worldMode === 'create'
      ? scalePx(
        72,
        this.scale.width,
        this.scale.height,
        isMobileWidth(this.scale.width) ? 44 : 56,
      ) + TOOLBAR_PADDING
      : 0;
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(
      recommendation.x - toolbarInset / (2 * zoom),
      recommendation.y,
    );
  }

  /** Draw survey-only guidance; this deliberately creates no RailTrack objects. */
  private renderStarterOpportunitySurvey(): void {
    const opportunity = WorldManager.world?.starterOpportunity;
    if (!opportunity) return;
    const zoom = this.cameras.main.zoom;
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    const worldUnitsPerScreenPixel = 1 / zoom;
    this.starterOpportunityLabels.length = 0;
    const graphics = this.add.graphics().setDepth(-20);
    const colours = [0x4ad5ff, 0xffdc7d];
    opportunity.corridors.forEach((corridor, index) => {
      graphics.lineStyle(
        OPPORTUNITY_CORRIDOR_WIDTH_PX * worldUnitsPerScreenPixel,
        colours[index],
        0.2,
      );
      graphics.beginPath();
      graphics.moveTo(corridor.waypoints[0].x, corridor.waypoints[0].y);
      for (const waypoint of corridor.waypoints.slice(1)) {
        graphics.lineTo(waypoint.x, waypoint.y);
      }
      graphics.strokePath();
      const labelPoint = polylineMidpoint(corridor.waypoints);
      const tradeoff = corridor.dominantTradeoff === 'short-steep'
        ? 'Shorter / steeper'
        : corridor.dominantTradeoff === 'long-flat'
          ? 'Longer / flatter'
          : 'Structure-heavy';
      const label = this.add.text(
        labelPoint.x,
        labelPoint.y + (
          OPPORTUNITY_CORRIDOR_LABEL_OFFSET_PX
          + index * OPPORTUNITY_CORRIDOR_LABEL_SEPARATION_PX
        ) * worldUnitsPerScreenPixel,
        `${tradeoff} · est. £${corridor.estimatedCost.toLocaleString()}`,
        {
          fontFamily: 'Verdana',
          fontSize: '16px',
          color: index === 0 ? '#9feaff' : '#ffe8a6',
          backgroundColor: '#06131fcc',
          padding: { x: 6, y: 3 },
        },
      ).setOrigin(0.5, 0).setDepth(-19);
      this.starterOpportunityLabels.push(label);
    });
    const prompt = this.add.text(
      opportunity.recommendedCamera.x,
      Math.min(...opportunity.sites.map(
        (site) => site.y - site.footprintRadius,
      )) - OPPORTUNITY_CORRIDOR_LABEL_SEPARATION_PX * worldUnitsPerScreenPixel,
      'Connect Managed Forest to Sawmill. Keep £110,000 for a timber train and operating reserve.',
      {
        fontFamily: 'Verdana',
        fontSize: '16px',
        color: '#ffe39a',
        backgroundColor: '#06131fcc',
        padding: { x: 8, y: 4 },
      },
    ).setOrigin(0.5, 1).setDepth(-19);
    this.starterOpportunityLabels.push(prompt);
  }

  private updateStarterOpportunityLabelScale(): void {
    const zoom = this.cameras.main.zoom;
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    const scale = 1 / zoom;
    for (const label of this.starterOpportunityLabels) label.setScale(scale);
  }

  private createFacilityView(
    placement: FacilityViewPlacement,
    inspection: FacilityInspectionDto,
  ): FacilityView {
    return new FacilityView(this, placement, inspection);
  }

  private renderFacilities(): void {
    for (const view of this.facilityViews) view.destroy();
    this.facilityViews = [];
    this.facilityInspections.clear();
    const world = WorldManager.world;
    if (!world) return;
    for (const facility of world.economy.facilities) {
      const railConnected = this.isFacilityRailConnected(facility);
      const inspection = buildFacilityInspection(
        world,
        facility.id,
        railConnected,
      );
      if (!inspection) continue;
      this.facilityInspections.set(facility.id, inspection);
      const view = this.createFacilityView({
        id: facility.id,
        x: facility.x,
        y: facility.y,
        railAccessX: facility.railAccess.x,
        railAccessY: facility.railAccess.y,
        railAccessRadius: facility.railAccess.radius,
      }, inspection);
      view.setSelectionEnabled(this.activeTool !== 'place-track');
      this.facilityViews.push(view);
    }
  }

  private updateFacilitySelectionAvailability(): void {
    const enabled = this.activeTool !== 'place-track';
    for (const view of this.facilityViews) {
      view.setSelectionEnabled(enabled);
    }
  }

  private isFacilityRailConnected(facility: FacilityEconomyDef): boolean {
    return this.queryFacilityRailConnectivity(facility, facility).connected;
  }

  private queryFacilityRailConnectivity(
    source: FacilityEconomyDef,
    destination: FacilityEconomyDef,
  ): RailAccessConnectivityResult {
    const world = WorldManager.world;
    if (!world) {
      return {
        connected: false,
        sourceEndpointTrackUUIDs: [],
        destinationEndpointTrackUUIDs: [],
        connectedTrackUUIDs: [],
      };
    }
    return queryRailAccessConnectivity(
      world.tracks,
      this.trackManager.captureTopology(),
      { facilityId: source.id, ...source.railAccess },
      { facilityId: destination.id, ...destination.railAccess },
    );
  }

  private createFreightPurchaseRuntimePort(): FreightPurchaseRuntimePort {
    return {
      spawn: (trainId, freightSetId) => (
        this.trainManager.createFreightTrain(trainId, freightSetId)
      ),
      place: (train, trackUUID, trackT, facing) => (
        this.trainManager.placeFreightTrain(
          train,
          trackUUID,
          trackT,
          facing,
        )
      ),
      remove: (trainId) => (
        this.trainManager.removeFreightTrain(trainId)
      ),
    };
  }

  private refreshFacilityPresentation(publishSelected: boolean): void {
    const world = WorldManager.world;
    if (!world) return;
    const byId = new Map(
      world.economy.facilities.map((facility) => [facility.id, facility]),
    );
    for (const view of this.facilityViews) {
      const facility = byId.get(view.facilityId);
      if (!facility) continue;
      const inspection = buildFacilityInspection(
        world,
        facility.id,
        this.isFacilityRailConnected(facility),
      );
      if (!inspection) continue;
      this.facilityInspections.set(facility.id, inspection);
      view.update(
        inspection,
        this.cameras.main.zoom,
        facility.id === this.selectedFacilityId,
      );
    }
    if (publishSelected && this.selectedFacilityId) {
      const inspection = this.facilityInspections.get(this.selectedFacilityId);
      if (inspection) EventBus.emit('facility:inspection', inspection);
    }
  }

  private updateFacilityViewScale(): void {
    for (const view of this.facilityViews) {
      const inspection = this.facilityInspections.get(view.facilityId);
      if (inspection) view.update(
        inspection,
        this.cameras.main.zoom,
        view.facilityId === this.selectedFacilityId,
      );
    }
  }

  private clearFacilitySelection(): void {
    const facilityId = this.selectedFacilityId;
    if (!facilityId) return;
    this.selectedFacilityId = null;
    for (const view of this.facilityViews) view.setSelected(false);
    EventBus.emit('facility:deselected', { facilityId });
  }

  update(time: number, delta: number): void {
    this.cameraController.update(time, delta);
    this.publishDebugState();

    const playActive = GameStateManager.worldMode === 'play'
      && GameStateManager.state === 'playing';
    if (playActive && !this.firstRouteHarnessControlsRuntime) {
      this.inputManager.handleTrainMovement(
        this.trainManager.selectedTrain,
        this.operationsLockedTrainIds,
      );
    }
    const runtime = (this.trainManager?.trains ?? []).map(
      (train) => captureTrainRuntime(train),
    );
    const operating = playActive && !this.scene.isPaused();
    const economyResult = this.firstRouteHarnessControlsRuntime
      ? null
      : this.economySystem.update(
        delta,
        operating,
        runtime,
      );
    if (economyResult) this.applyEconomyUpdateResult(economyResult);

    if (this.operationsLockedTrainIds.size > 0) {
      this.trainManager.stopFreightTrains(
        Array.from(this.operationsLockedTrainIds).sort(),
      );
    }

    // Stream terrain chunks and scenery around the camera
    const cam = this.cameras.main;
    const camCX = cam.scrollX + cam.width / (2 * cam.zoom);
    const camCY = cam.scrollY + cam.height / (2 * cam.zoom);
    this.updateStarterOpportunityLabelScale();
    this.updateFacilityViewScale();
    this.terrainChunkManager.update(camCX, camCY, cam.zoom);
    this.sceneryManager.update(camCX, camCY, cam.zoom);

    // Terrain overlay when tool is active
    this.updateTerrainOverlay();

    if (GameStateManager.worldMode === 'create') {
      this.activeEditorTool?.update(delta);
      this.autoSaveTimer += delta / 1000;
      if (this.autoSaveTimer >= GameConfig.WORLD.AUTO_SAVE_INTERVAL_SECS) {
        this.autoSaveTimer = 0;
        this.runPeriodicSafetySave();
      }
      GameStateManager.tick(delta / 1000);
    } else if (playActive) {
      if (!this.firstRouteHarnessControlsRuntime) {
        this.trainManager.update(
          time,
          delta,
          this.operationsLockedTrainIds,
        );
      }
      this.contentLoader.stations.forEach((s) => s.update(delta));
      GameStateManager.tick(delta / 1000);
      this.publishHUDState();
    }
    this.publishFreightPresentation(
      (this.trainManager?.trains ?? []).map(
        (train) => captureTrainRuntime(train),
      ),
    );
  }

  private applyEconomyUpdateResult(
    economyResult: EconomyUpdateResult,
  ): void {
    if (economyResult.authoritativeChanged) {
      this.clearConstructionHistoryForOperations();
      const lockedBefore = new Set(this.operationsLockedTrainIds);
      this.mergeOperationPresentation(economyResult.cargoStatuses);
      economyResult.stopTrainIds.forEach((trainId) => {
        this.operationsLockedTrainIds.add(trainId);
      });
      if (economyResult.stopTrainIds.length === 0
        && lockedBefore.size > 0
        && this.canUnlockOperationsTrains(
          lockedBefore,
          economyResult.runningCostBlockerByTrainId,
        )) {
        this.operationsLockedTrainIds.clear();
      }
      this.mergeRunningCostBlockers(
        economyResult.runningCostBlockerByTrainId,
      );
      this.applyOperationsLockBlockers();
      economyResult.completedDeliveries.forEach((event) => {
        this.presentCompletedDelivery(event);
      });
    }
    if (economyResult.authoritativeChanged
      || economyResult.commitRejected) {
      this.refreshFacilityPresentation(true);
    }
    if (economyResult.commitRejected) {
      this.reconcileLiveTrainRuntimeFromAuthority();
      EventBus.emit('ui:toast', {
        message: 'Freight state changed · retry operation',
        type: 'info',
      });
    } else if (economyResult.authoritativeChanged) {
      this.saveWorldAndReport(false, false);
    }
  }

  private captureFirstRouteBrowserSnapshot(): FirstRouteBrowserSnapshot {
    const world = WorldManager.world;
    if (!world) throw new Error('No world is loaded');
    const camera = this.cameras.main;
    const runtime = this.trainManager.trains.map(captureTrainRuntime);
    const placeTrack = this.toolRegistry.get(
      'place-track',
    ) as PlaceTrackTool | undefined;
    return deepFreezePlainData(clonePlainData({
      world,
      runtime,
      saveState: this.lastReportedSaveState,
      objective: deriveFreightObjective(
        world,
        this.trackManager.captureTopology(),
      ),
      construction: {
        phase: placeTrack?.phase ?? 'idle',
        preview: placeTrack?.previewModel ?? null,
        topology: this.trackManager.captureTopology(),
      },
      camera: {
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
        zoom: camera.zoom,
        width: camera.width,
        height: camera.height,
      },
    }));
  }

  private setFirstRouteBrowserMode(mode: 'create' | 'play'): void {
    const worldId = WorldManager.currentWorldId ?? '';
    if (mode === 'play') {
      GameStateManager.enterPlay(worldId);
    } else if (GameStateManager.worldMode === 'play') {
      GameStateManager.returnToCreate();
    } else {
      GameStateManager.enterCreate(worldId);
    }
  }

  private advanceFirstRouteFixedTicks(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) {
      throw new RangeError('Fixed tick count must be between 0 and 10,000');
    }
    if (GameStateManager.worldMode !== 'play'
      || GameStateManager.state !== 'playing') {
      throw new Error('Fixed ticks require play mode');
    }
    this.firstRouteHarnessControlsRuntime = true;
    for (let index = 0; index < count; index += 1) {
      const runtime = this.trainManager.trains.map(captureTrainRuntime);
      const result = this.economySystem.update(
        ECONOMY_TICK_MS,
        true,
        runtime,
      );
      this.applyEconomyUpdateResult(result);
      GameStateManager.tick(ECONOMY_TICK_MS / 1_000);
    }
    this.publishFreightPresentation(
      this.trainManager.trains.map(captureTrainRuntime),
    );
    this.publishHUDState();
  }

  private setFirstRouteTrainRuntime(
    trainId: string,
    runtime: Pick<
      TrainRuntimeSnapshot,
      'x' | 'y' | 'speedWorldUnitsPerSecond' | 'throttle' | 'derailed'
    >,
  ): void {
    if (!Number.isFinite(runtime.x)
      || !Number.isFinite(runtime.y)
      || !Number.isFinite(runtime.speedWorldUnitsPerSecond)
      || runtime.speedWorldUnitsPerSecond < 0
      || [-1, 0, 1].indexOf(runtime.throttle) === -1
      || typeof runtime.derailed !== 'boolean') {
      throw new RangeError('Invalid train runtime');
    }
    const train = this.trainManager.trains.find(
      (candidate) => candidate.getUUID() === trainId,
    );
    if (!train) throw new Error(`Unknown train runtime: ${trainId}`);
    this.firstRouteHarnessControlsRuntime = true;
    const body = train.getMatterBody();
    body.setPosition(runtime.x, runtime.y);

    if (runtime.derailed) {
      train.derailed = true;
      train.currentTrack = null;
    } else {
      if (train.derailed) {
        if (!this.trainManager.tryRecoverDerailedTrain(train)) {
          throw new Error(`Could not re-rail train runtime: ${trainId}`);
        }
      } else {
        const closest = this.trackManager.getClosestTrack(
          { x: runtime.x, y: runtime.y },
          Math.max(GameConfig.TRACK.MAX_CLOSE_DISTANCE, 120),
          train.currentTrack ?? undefined,
        );
        if (!closest) {
          throw new Error(`Train runtime is outside player track: ${trainId}`);
        }
        train.currentTrack = closest;
        const authoritative = WorldManager.world?.trains.find(
          ({ id }) => id === trainId,
        );
        body.setAngle(
          closest.getTrackAngle(body)
          + (authoritative?.facing === -1 ? 180 : 0),
        );
      }
      train.derailed = false;
    }

    train.enginePower = runtime.throttle * GameConfig.TRAIN.ENGINE_POWER;
    const speedPerFrame = runtime.speedWorldUnitsPerSecond / 60;
    const matterBody = body.body as {
      force?: { x: number; y: number };
    };
    if (matterBody.force) {
      matterBody.force.x = 0;
      matterBody.force.y = 0;
    }
    body.setAngularVelocity(0);
    body.setVelocity(
      Math.cos(body.rotation) * speedPerFrame,
      Math.sin(body.rotation) * speedPerFrame,
    );
    this.publishFreightPresentation(
      this.trainManager.trains.map(captureTrainRuntime),
    );
  }

  private reconcileLiveTrainRuntimeFromAuthority(): void {
    const world = WorldManager.world;
    if (!world) return;
    const liveById = new Map(
      this.trainManager.trains.map((train) => [train.getUUID(), train]),
    );
    world.trains.forEach((authoritative) => {
      const live = liveById.get(authoritative.id);
      if (!live) return;
      this.trainManager.placeFreightTrain(
        live,
        authoritative.trackUUID,
        authoritative.trackT,
        authoritative.facing,
      );
    });
  }

  private clearConstructionHistoryForOperations(): void {
    if (this.constructionHistoryClearedForOperations) return;
    const commandStack = this.commandStack;
    if (commandStack) {
      const report = commandStack.onChange;
      commandStack.onChange = undefined;
      try {
        commandStack.clear();
      } finally {
        commandStack.onChange = report;
      }
    }
    EventBus.emit('ui:toolbar-undo-state', {
      canUndo: false,
      canRedo: false,
    });
    this.constructionHistoryClearedForOperations = true;
  }

  private mergeOperationPresentation(
    statuses: readonly CargoTransferStatus[],
  ): void {
    statuses.forEach((status) => {
      this.cargoStatusByTrainId.set(
        status.trainId,
        clonePlainData(status),
      );
    });
  }

  private mergeRunningCostBlockers(
    blockerByTrainId: Readonly<Record<string, CargoBlockerCode | null>>,
  ): void {
    Object.keys(blockerByTrainId).forEach((trainId) => {
      const blocker = blockerByTrainId[trainId];
      if (blocker === null) return;
      this.setTrainOperationBlocker(trainId, blocker);
    });
  }

  private setTrainOperationBlocker(
    trainId: string,
    blocker: CargoBlockerCode,
  ): void {
    const existing = this.cargoStatusByTrainId.get(trainId);
    if (existing?.blocker !== null && existing?.blocker !== undefined) {
      return;
    }
    const cargoUnits = WorldManager.world?.trains.find(
      ({ id }) => id === trainId,
    )?.cargo?.units ?? 0;
    this.cargoStatusByTrainId.set(trainId, existing
      ? {
        ...existing,
        kind: 'blocked',
        blocker,
      }
      : {
        trainId,
        facilityId: null,
        productId: null,
        kind: 'blocked',
        blocker,
        batchUnits: 0,
        cargoUnits,
        capacityUnits: 0,
        batchRevenue: 0,
      });
  }

  private applyOperationsLockBlockers(): void {
    this.operationsLockedTrainIds.forEach((trainId) => {
      this.setTrainOperationBlocker(
        trainId,
        'insufficient-running-cash',
      );
    });
  }

  private canUnlockOperationsTrains(
    lockedTrainIds: ReadonlySet<string>,
    blockerByTrainId: Readonly<Record<string, CargoBlockerCode | null>>,
  ): boolean {
    const world = WorldManager.world;
    if (!world) return false;
    let requiredCash = 0;
    for (const trainId of lockedTrainIds) {
      if (blockerByTrainId[trainId] !== null) return false;
      const train = world.trains.find(({ id }) => id === trainId);
      const freightSet = train
        ? getFreightSet(train.freightSetId)
        : undefined;
      if (!freightSet) return false;
      requiredCash += freightSet.runningCostPerActiveTick;
      if (!Number.isSafeInteger(requiredCash)) return false;
    }
    return world.company.cash >= requiredCash;
  }

  private presentCompletedDelivery(event: FreightDeliveryEvent): void {
    EventBus.emit('ui:freight-delivery-completed', Object.freeze({
      ...event,
    }));
    const world = WorldManager.world;
    const destination = world?.economy.facilities.find(
      ({ id }) => id === event.destinationFacilityId,
    );
    const product = getProduct(event.productId);
    const train = world?.trains.find(({ id }) => id === event.trainId);
    const freightSet = train
      ? getFreightSet(train.freightSetId)
      : undefined;
    const capacity = freightSet && product
      ? capacityForProduct(freightSet, product)
      : null;
    const completesStructuralObjective = event.productId === 'structural-timber'
      && destination?.definitionId === 'prefabrication-plant'
      && event.operatingProfit > 0
      && capacity?.ok === true
      && event.units === capacity.capacityUnits
      && world?.freightProgress
        .profitableStructuralTimberDeliveryCompleted === true;
    const celebrateStructuralObjective = world
      && completesStructuralObjective
      && freightObjectiveCelebrationSession.consume(
        world.id,
        'structural-timber-link',
        true,
      );
    EventBus.emit('ui:toast', celebrateStructuralObjective
      ? {
        message:
          `${product!.displayName} delivered to ${destination!.name}`
          + ` · +£${event.revenue.toLocaleString('en-GB')}`
          + ` · trip profit £${event.operatingProfit.toLocaleString('en-GB')}`,
        type: 'success',
      }
      : {
        message:
          `Delivery complete · +£${event.revenue.toLocaleString('en-GB')}`,
        type: 'success',
      });
    EventBus.emit('ui:cash-pulse', { amount: event.revenue });
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
    this.cameraController.setInputLockOwner(
      this.inputLockOwnerForTool(this.activeTool),
    );
    if (this.activeTool === 'place-track') this.clearFacilitySelection();
    this.updateFacilitySelectionAvailability();
    EventBus.emit('ui:toolbar-visible', { visible: true });
    this.saveWorldAndReport(
      true,
      !this.capturingStartupSaveOutcome,
    );
  }

  private saveWorldAndReport(
    showFailureToast = true,
    syncRuntime = true,
  ): boolean {
    const shouldSyncRuntime = syncRuntime
      && this.lastReportedSaveState !== 'unsaved';
    return this.saveAndReport(
      () => shouldSyncRuntime
        ? this.syncTrainLocationsAndSave()
        : WorldManager.save(),
      showFailureToast,
    );
  }

  private syncTrainLocationsAndSave(): boolean {
    const world = WorldManager.world;
    if (!world) return WorldManager.save();

    const runtimeById = new Map(
      (this.trainManager?.trains ?? []).map((train) => [
        train.getUUID(),
        captureTrainRuntime(train),
      ]),
    );

    WorldManager.applyOperationsBatch(world.revision, (draft) => {
      let changed = false;
      draft.trains = draft.trains.map((authoritative) => {
        const runtime = runtimeById.get(authoritative.id);
        const merged = runtime
          ? TrainSerializer.mergeRuntime(authoritative, runtime)
          : null;
        if (merged
          && (merged.trackUUID !== authoritative.trackUUID
            || merged.trackT !== authoritative.trackT
            || merged.facing !== authoritative.facing)) {
          changed = true;
        }
        return merged ?? clonePlainData(authoritative);
      });
      return changed;
    });

    return WorldManager.save();
  }

  private saveAndReport(
    persist: () => boolean,
    showFailureToast: boolean,
  ): boolean {
    this.reportSaveState('saving');
    const saved = persist();
    this.reportSaveState(saved ? 'saved' : 'unsaved');
    if (!saved && showFailureToast) {
      if (this.capturingStartupSaveOutcome) {
        this.pendingStartupSaveError = SAVE_FAILURE_MESSAGE;
      } else {
        EventBus.emit('ui:toast', {
          message: SAVE_FAILURE_MESSAGE,
          type: 'error',
        });
      }
    }
    return saved;
  }

  private runPeriodicSafetySave(): void {
    if (this.lastReportedSaveState === 'saved') return;
    this.saveWorldAndReport(false);
  }

  private reportSaveState(state: SaveState): void {
    this.lastReportedSaveState = state;
    EventBus.emit('ui:toolbar-save-state', { state });
    this.publishCompanyState(state);
  }

  private activatePlayMode(): void {
    this.activeEditorTool?.cancel();
    this.selectionManager.clearSelection();
    for (const view of this.facilityViews) view.setSelectionEnabled(true);
    this.cameraController.setInputLockOwner('camera');
    this.inputManager.setupClickHandling(this.trainManager);
    EventBus.emit('ui:toolbar-visible', { visible: false });
    // Auto-follow the first available train
    const trains = this.trainManager.trains;
    if (trains.length > 0) {
      this.clearFacilitySelection();
      this.trainManager.selectTrain(trains[0].getUUID());
    }
  }

  // ── Input dispatch ─────────────────────────────────────────────────────────

  /** Return true if the pointer's screen position overlaps any editor UI panel. */
  private isPointerOverUI(pointer: Phaser.Input.Pointer): boolean {
    const editorUI = this.scene?.get?.(EDITOR_UI_SCENE_KEY) as EditorUIScene | null;
    if (editorUI?.containsScreenPoint(pointer.x, pointer.y)) return true;
    const { width, height } = this.scale;
    const toolbarWidth = scalePx(72, width, height, isMobileWidth(width) ? 44 : 56);
    return pointer.x <= toolbarWidth + TOOLBAR_PADDING;
  }

  private bindCommandStackReporting(): void {
    this.commandStack.onChange = (canUndo, canRedo) => {
      EventBus.emit('ui:toolbar-undo-state', { canUndo, canRedo });
      this.saveWorldAndReport();
      this.publishDeletionReview(this.selectionManager.selectedUUIDs);
      this.refreshFacilityPresentation(true);
    };
  }

  private publishDeletionReview(uuids: ReadonlyArray<string>): void {
    const world = WorldManager.world;
    const tracks = world
      ? uuids.map((uuid) => world.tracks.find((track) => track.uuid === uuid))
      : [];
    const complete = !!world
      && tracks.length === uuids.length
      && tracks.every((track) => track !== undefined);
    const blockingReason = world && complete
      ? deletionBlockingReason(world, uuids)
      : uuids.length > 0
        ? 'Deletion changed · Review the selection again'
        : '';
    const review: DeletionReviewDTO = Object.freeze({
      uuids: Object.freeze([...uuids]),
      expectedRefund: complete
        ? tracks.reduce(
          (sum, track) => sum + demolitionRefund(track!.paidBuildCost),
          0,
        )
        : 0,
      expectedConstructionRevision: world?.constructionRevision ?? -1,
      available: complete && uuids.length > 0 && blockingReason === '',
      blockingReason,
    });
    EventBus.emit('ui:deletion-review', review);
  }

  private publishCompanyState(
    saveState: SaveState,
  ): void {
    const world = WorldManager.world;
    EventBus.emit('ui:company-state', {
      cash: world?.company.cash ?? 0,
      saveState,
      economyTick: world?.economy.tick ?? 0,
      constructionIndexBps:
        world?.economy.market.constructionIndexBps ?? 10_000,
      operatingSummary: world
        ? buildOperatingSummary(world.company, world.economy.tick)
        : {
          fromTick: 0,
          throughTick: 0,
          deliveryRevenue: 0,
          contractBonuses: 0,
          runningExpenses: 0,
          operatingProfit: 0,
          capitalExpenditure: 0,
          cashFlow: 0,
        },
    });
  }

  private publishFreightPresentation(
    runtime: readonly ReturnType<typeof captureTrainRuntime>[],
  ): void {
    const world = WorldManager.world;
    if (!world || !this.trackManager) {
      EventBus.emit('ui:train-inspection', { inspection: null });
      return;
    }
    const objective = deriveFreightObjective(
      world,
      this.trackManager.captureTopology(),
    );
    EventBus.emit('ui:freight-objective', objective);
    if (freightObjectiveCelebrationSession.consume(
      world.id,
      'first-profitable-route',
      world.freightProgress.profitableLogDeliveryCompleted,
    )) {
      EventBus.emit('ui:toast', {
        message:
          'First freight route complete · Regional Development Grant +£'
          + REGIONAL_DEVELOPMENT_GRANT.toLocaleString('en-GB')
          + ' · Next: Extend the timber chain',
        type: 'success',
      });
    }

    const selectedId = this.trainManager?.selectedTrain?.getUUID();
    const selectedRuntime = runtime.find(
      ({ trainId }) => trainId === selectedId,
    );
    if (!selectedRuntime) {
      EventBus.emit('ui:train-inspection', { inspection: null });
      return;
    }
    const train = world.trains.find(({ id }) => id === selectedId);
    const fallbackFreightSet = train
      ? getFreightSet(train.freightSetId)
      : undefined;
    const fallbackProduct = train?.cargo
      ? getProduct(train.cargo.productId)
      : undefined;
    const fallbackCapacity = fallbackFreightSet && fallbackProduct
      ? capacityForProduct(fallbackFreightSet, fallbackProduct)
      : null;
    const transfer = this.cargoStatusByTrainId.get(selectedId) ?? {
      trainId: selectedId,
      facilityId: null,
      productId: null,
      kind: 'idle' as const,
      blocker: null,
      batchUnits: 0,
      cargoUnits: train?.cargo?.units ?? 0,
      capacityUnits: fallbackCapacity?.ok
        ? fallbackCapacity.capacityUnits
        : 0,
      batchRevenue: 0,
    };
    EventBus.emit('ui:train-inspection', {
      inspection: buildTrainInspection(world, selectedRuntime, transfer),
    });
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.isPointerOverUI(pointer)) return;
    this.clearFacilitySelection();
    if (GameStateManager.worldMode !== 'create') return;

    // Right-click: check if active tool wants it first, otherwise show context menu
    if (pointer.rightButtonDown()) {
      if (this.activeEditorTool?.wantsPointerButton(2)) {
        const world = this.inputManager.toWorldPoint(pointer);
        this.activeEditorTool.onPointerDown(world.x, world.y, pointer);
      } else {
        this.showContextMenu(pointer);
      }
      return;
    }

    const world = this.inputManager.toWorldPoint(pointer);
    this.activeEditorTool?.onPointerDown(world.x, world.y, pointer);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    const world = this.inputManager.toWorldPoint(pointer);
    this.activeEditorTool?.onPointerMove(world.x, world.y, pointer);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    const world = this.inputManager.toWorldPoint(pointer);
    this.activeEditorTool?.onPointerUp(world.x, world.y, pointer);
  }

  private handlePointerCancel(pointer: Phaser.Input.Pointer): void {
    if (GameStateManager.worldMode !== 'create') return;
    if (this.activeEditorTool?.onPointerCancel) {
      this.activeEditorTool.onPointerCancel(pointer);
    } else {
      this.activeEditorTool?.cancel();
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (isGameplayInputFocused(event.target as Element | null)) return;
    if (GameStateManager.worldMode === 'create') {
      // Ctrl shortcuts
      if (event.ctrlKey) {
        if (event.code === 'KeyZ') {
          if (this.activeTool === 'place-track') this.activeEditorTool?.cancel();
          this.commandStack.undo();
          return;
        }
        if (event.code === 'KeyY') {
          if (this.activeTool === 'place-track') this.activeEditorTool?.cancel();
          this.commandStack.redo();
          return;
        }
        if (event.code === 'KeyS') {
          this.saveWorldAndReport();
          return;
        }
      }

      // Keyboard tool shortcuts (only when no modifier)
      if (!event.ctrlKey && !event.altKey) {
        const disabledShortcuts: Record<string, CreateTool> = {
          KeyD: 'completer',
          KeyJ: 'junction',
          KeyG: 'generator',
          KeyX: 'eraser',
        };
        const disabledTool = disabledShortcuts[event.code];
        const disabledReason = disabledTool
          ? disabledConstructionToolReason(disabledTool)
          : null;
        if (disabledReason) {
          EventBus.emit('ui:toast', { message: disabledReason, type: 'info' });
          return;
        }
        const shortcuts: Record<string, CreateTool> = {
          KeyV: 'select', KeyH: 'pan', KeyT: 'terrain-view',
          KeyN: 'place-vehicle', KeyP: 'place-track',
        };
        const mapped = shortcuts[event.code];
        if (mapped) { EventBus.emit('ui:toolbar-select-tool', { tool: mapped }); return; }
      }

      if (event.code === 'Escape') {
        this.clearFacilitySelection();
        if (this.activeTool === 'place-track') {
          this.activeEditorTool?.cancel();
          return;
        }
        // Cancel the active tool first, then clear selection
        this.activeEditorTool?.cancel();
        this.selectionManager.clearSelection();
        EventBus.emit('ui:toolbar-select-tool', { tool: 'none' });
        return;
      }

      // Delegate to active tool
      this.activeEditorTool?.onKeyDown(event);

      if (event.code === 'Delete' && !event.repeat) {
        this.requestDeletionReview(this.selectionManager.selectedUUIDs);
      }
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  private deleteSelectedTracks(uuids: string[]): void {
    this.requestDeletionReview(uuids);
  }

  private requestDeletionReview(uuids: ReadonlyArray<string>): void {
    if (GameStateManager.worldMode !== 'create' || uuids.length === 0) return;
    EventBus.emit('ui:delete-request', { uuids: [...uuids] });
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
