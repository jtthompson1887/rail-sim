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
import { InputManager } from '../systems/InputManager';
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
import EditorUIScene from './EditorUIScene';
import { isMobileWidth, scalePx } from '../utils/responsive';
import type { IEditorTool } from '../systems/tools/IEditorTool';
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
import { captureTrainRuntime } from '../freight/TrainRuntime';
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
import { EconomySystem } from '../economy/EconomySystem';
import {
  buildFacilityInspection,
  type FacilityInspectionDto,
} from '../economy/FacilityPresentation';
import type { FacilityEconomyDef } from '../economy/EconomyData';
import {
  FacilityView,
  type FacilityViewPlacement,
} from '../entities/FacilityView';

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

/** Window augmentation for Playwright / E2E test hooks. */
declare global {
  interface Window {
    __railSimScene: string;
    __railSimWorldDerailCount: number;
    __railSimTrainManager: TrainManager | undefined;
    __railSimTrackManager: TrackManager | undefined;
    __railSimConstructionSnapshot:
      (() => ConstructionE2ESnapshot) | undefined;
  }
}

const EDITOR_UI_SCENE_KEY = 'EditorUIScene';
const TOOLBAR_PADDING = 2;
const SAVE_FAILURE_MESSAGE = 'Could not save the world. Retry Save is available.';
const OPPORTUNITY_CORRIDOR_WIDTH_PX = 24;
const OPPORTUNITY_CORRIDOR_LABEL_OFFSET_PX = 34;
const OPPORTUNITY_CORRIDOR_LABEL_SEPARATION_PX = 24;
type SaveState = 'saved' | 'unsaved' | 'saving';

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
    const freePanTools: CreateTool[] = ['none', 'pan', 'terrain-view'];
    const lockOwner: import('../systems/tools/IEditorTool').InputLockOwner =
      freePanTools.indexOf(tool) === -1 ? 'editor-tool' : 'camera';
    this.cameraController.setInputLockOwner(lockOwner);
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

  constructor() {
    super({ key: 'WorldScene' });
  }

  init(data: { worldId?: string; mode?: 'create' | 'play' }): void {
    this.worldLoadFailed = false;
    this.lastReportedSaveState = 'saved';
    this.pendingStartupSaveError = null;
    this.capturingStartupSaveOutcome = false;
    this.economySystem = new EconomySystem();
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
    EventBus.on('facility:selected', this.facilitySelectedHandler);
    EventBus.on('vehicle:type-changed', this.vehicleTypeChangedHandler);

    // Expose managers for E2E tests after everything is constructed
    window.__railSimTrainManager = this.trainManager;
    window.__railSimTrackManager = this.trackManager;
    window.__railSimConstructionSnapshot = () => {
      const placeTrack = this.toolRegistry.get('place-track') as PlaceTrackTool | undefined;
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
      EventBus.off('facility:selected', this.facilitySelectedHandler);
      EventBus.off('vehicle:type-changed', this.vehicleTypeChangedHandler);
      this.scene.stop(EDITOR_UI_SCENE_KEY);
      for (const tool of this.toolRegistry.values()) tool.destroy();
      this.selectionManager.destroy();
      this.terrainChunkManager.destroyAll();
      this.sceneryManager.destroyAll();
      for (const view of this.facilityViews) view.destroy();
      this.facilityViews = [];
      this.facilityInspections.clear();
      this.selectedFacilityId = null;
      window.__railSimTrainManager = undefined;
      window.__railSimTrackManager = undefined;
      window.__railSimConstructionSnapshot = undefined;
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
      saveState: this.lastReportedSaveState,
      saveErrorMessage: this.pendingStartupSaveError ?? undefined,
    });
    this.pendingStartupSaveError = null;

    this.applyStarterOpportunityCamera();
    this.renderStarterOpportunitySurvey();
    this.renderFacilities();
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

    const economyResult = this.economySystem.update(
      delta,
      GameStateManager.worldMode === 'play'
        && GameStateManager.state === 'playing'
        && !this.scene.isPaused(),
    );
    if (economyResult.ticksAdvanced > 0) {
      this.saveWorldAndReport(false);
      this.refreshFacilityPresentation(true);
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
    if (this.activeTool === 'place-track') this.clearFacilitySelection();
    this.updateFacilitySelectionAvailability();
    EventBus.emit('ui:toolbar-visible', { visible: true });
    this.saveWorldAndReport();
  }

  private saveWorldAndReport(showFailureToast = true): boolean {
    return this.saveAndReport(
      () => this.syncTrainLocationsAndSave(),
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
    this.inputManager.setupClickHandling(this.trainManager);
    EventBus.emit('ui:toolbar-visible', { visible: false });
    // Auto-follow the first available train
    const trains = this.trainManager.trains;
    if (trains.length > 0) {
      this.clearFacilitySelection();
      this.trainManager.selectTrain(trains[0]);
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
    EventBus.emit('ui:company-state', {
      cash: WorldManager.world?.company.cash ?? 0,
      saveState,
      economyTick: WorldManager.world?.economy.tick ?? 0,
      constructionIndexBps:
        WorldManager.world?.economy.market.constructionIndexBps ?? 10_000,
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
    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable
      || ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].indexOf(target.tagName) !== -1
      || target.closest('[data-testid="construction-inspector"]') !== null
      || target.closest('[data-testid="facility-inspector"]') !== null
    )) return;
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
