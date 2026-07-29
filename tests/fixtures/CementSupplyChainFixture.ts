import Phaser from 'phaser';
import type {
  TrainDef,
  WorldData,
} from '../../src/config/WorldData';
import { PlaceTrackCommand } from '../../src/commands/PlaceTrackCommand';
import {
  ECONOMY_TICK_MS,
  EconomySystem,
  type EconomyUpdateResult,
} from '../../src/economy/EconomySystem';
import {
  analyzeCementSupplyOpportunity,
} from '../../src/economy/CementSupplyOpportunity';
import {
  analyzePrefabricationExtension,
  resolvePrefabricationExtensionStart,
} from '../../src/economy/PrefabricationOpportunity';
import type Train from '../../src/entities/Train';
import {
  FreightPurchaseService,
  type FreightPurchaseQuoteInput,
  type FreightPurchaseRuntimePort,
  type FreightPurchaseSetId,
} from '../../src/freight/FreightPurchaseService';
import {
  AGGREGATE_HOPPER_SET_ID,
  COVERED_CEMENT_SET_ID,
} from '../../src/freight/FreightSetCatalog';
import {
  captureTrainRuntime,
  type TrainRuntimeSnapshot,
} from '../../src/freight/TrainRuntime';
import TrackManager from '../../src/managers/TrackManager';
import { TrainManager } from '../../src/managers/TrainManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { SaveService } from '../../src/services/SaveService';
import { WorldContentLoader } from '../../src/services/WorldContentLoader';
import { CameraController } from '../../src/systems/CameraController';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import {
  ConstructionService,
  type ConstructionInputAnchor,
  type ConstructionPreview,
} from '../../src/systems/ConstructionService';
import { SnapSystem, type SnapResult } from '../../src/systems/SnapSystem';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { clonePlainData, equalPlainData } from '../../src/utils/PlainData';

const { makeScene } = require('../../__mocks__/phaser');

type MineralRoute = 'quarry-to-cement' | 'cement-to-prefab';

export interface CementSupplyNetworkResult {
  readonly starterTrackIds: readonly string[];
  readonly prefabTrackId: string;
  readonly quarryToCementTrackId: string;
  readonly cementToPrefabTrackId: string;
  readonly totalConstructionCost: number;
  readonly prefabConnections: number;
  readonly quarryToCementConnections: number;
  readonly cementToPrefabConnections: number;
}

export interface CementSupplyCheckpoint {
  readonly expected: WorldData;
  readonly detached: WorldData;
  readonly restoredRuntimeByTrainId:
    Readonly<Record<string, TrainRuntimeSnapshot>>;
}

export interface CementSupplyRecoveryResult {
  readonly authoritativeBefore: TrainDef;
  readonly derailed: TrainRuntimeSnapshot;
  readonly recovered: TrainRuntimeSnapshot;
  readonly authoritativeAfter: TrainDef;
}

export interface CementSupplyChainHarness {
  buildSupplyNetwork(): CementSupplyNetworkResult;
  purchaseFreightSet(freightSetId: FreightPurchaseSetId): string;
  purchaseInput(freightSetId: FreightPurchaseSetId): FreightPurchaseQuoteInput;
  placeAtFacility(trainId: string, definitionId: string): void;
  placeAtMidpoint(trainId: string, route: MineralRoute): void;
  advanceStoppedTick(): EconomyUpdateResult;
  advanceActiveTick(trainId: string): EconomyUpdateResult;
  derailAndRecover(trainId: string): CementSupplyRecoveryResult;
  saveReload(): CementSupplyCheckpoint;
  readonly world: WorldData;
  destroy(): void;
}

const constructionAnchor = (
  snap: SnapResult,
): ConstructionInputAnchor => {
  if (snap.type === 'endpoint'
    && snap.trackUUID
    && snap.endpoint
    && snap.outward
    && snap.open !== undefined) {
    return {
      x: snap.x,
      y: snap.y,
      snapped: true,
      type: 'endpoint',
      trackUUID: snap.trackUUID,
      endpoint: snap.endpoint,
      outward: { ...snap.outward },
      open: snap.open,
    };
  }
  if (snap.type === 'grid') {
    return { x: snap.x, y: snap.y, snapped: true, type: 'grid' };
  }
  return { x: snap.x, y: snap.y, snapped: false, type: 'none' };
};

const sameCurveCoordinates = (
  left: ConstructionPreview['proposal']['geometry'],
  right: ConstructionPreview['proposal']['geometry'],
): boolean => (
  left.geometryVersion === right.geometryVersion
  && (['p0', 'p1', 'p2', 'p3'] as const).every((point) => (
    left[point].x === right[point].x
      && left[point].y === right[point].y
  ))
);

class CementSupplyChainHarnessImpl implements CementSupplyChainHarness {
  private readonly scene: Phaser.Scene;
  private readonly analyzer: ConstructionAnalyzer;
  private trackManager: TrackManager;
  private trainManager: TrainManager;
  private constructionService: ConstructionService;
  private snapSystem: SnapSystem;
  private economy: EconomySystem;
  private purchase: FreightPurchaseService;
  private nextTrainId = 1;
  private acceptedConstructionCost = 0;
  private network: CementSupplyNetworkResult | null = null;

  constructor(private readonly seed: string) {
    WorldManager.reset();
    const creation = WorldManager.tryCreateNew(
      'Cement supply integration',
      seed,
      'temperate',
    );
    if (creation.ok === false) {
      throw new Error(`Generated world failed: ${creation.error.code}`);
    }

    this.scene = makeScene();
    jest.spyOn(this.scene.add, 'image').mockImplementation((
      x: number,
      y: number,
      texture: string,
    ) => Object.assign(
      new Phaser.GameObjects.Image(this.scene, x, y, texture),
      { setTint: jest.fn().mockReturnThis() },
    ));
    this.analyzer = new ConstructionAnalyzer(new TerrainGenerator(seed));
    this.trackManager = new TrackManager(this.scene);
    this.trainManager = this.createTrainManager();
    new WorldContentLoader(
      this.scene,
      this.trackManager,
      this.trainManager,
    ).load();
    this.constructionService = new ConstructionService(
      this.trackManager,
      this.analyzer,
    );
    this.snapSystem = new SnapSystem(this.trackManager);
    this.economy = new EconomySystem(WorldManager);
    this.purchase = this.createPurchaseService();
  }

  get world(): WorldData {
    const snapshot = WorldManager.snapshot();
    if (!snapshot) throw new Error('Cement supply world is not loaded');
    return clonePlainData(snapshot);
  }

  buildSupplyNetwork(): CementSupplyNetworkResult {
    if (this.network) return this.network;
    const generated = this.world;
    const corridor = [...generated.starterOpportunity.corridors].sort(
      (left, right) => left.estimatedCost - right.estimatedCost
        || left.id.localeCompare(right.id),
    )[0];
    if (!corridor) throw new Error('Generated world has no starter corridor');

    const starterTrackIds = corridor.feasibilityWitness.segments.map(
      (segment, index) => {
        const preview = this.buildTrack(
          segment.geometry.p0,
          segment.geometry.p3,
          `cement-starter-${index + 1}`,
        );
        if (!equalPlainData(preview.proposal.geometry, segment.geometry)) {
          throw new Error(`Starter segment ${index + 1} drifted from witness`);
        }
        return preview.quote!.newTrackUUID;
      },
    );

    const current = this.world;
    const extensionStart = resolvePrefabricationExtensionStart(
      current.starterOpportunity,
    );
    const prefab = this.requireFacility('prefabrication-plant');
    if (!extensionStart) {
      throw new Error('Generated world has no Prefab extension start');
    }
    const prefabWitness = analyzePrefabricationExtension(
      this.analyzer,
      extensionStart,
      prefab.railAccess,
    );
    if (!prefabWitness) {
      throw new Error('Generated world has no buildable Prefab extension');
    }
    const prefabPreview = this.buildTrack(
      extensionStart.point,
      prefab.railAccess,
      'cement-prefab-extension',
    );
    if (!sameCurveCoordinates(
      prefabPreview.proposal.geometry,
      prefabWitness.proposal.geometry,
    )) {
      throw new Error('Prefab extension drifted from generated witness');
    }

    const quarry = this.requireFacility('quarry');
    const cementWorks = this.requireFacility('cement-works');
    const cementWitness = analyzeCementSupplyOpportunity(
      this.analyzer,
      this.world.starterOpportunity,
      prefabWitness,
      {
        quarry: quarry.railAccess,
        cementWorks: cementWorks.railAccess,
        prefabricationPlant: prefab.railAccess,
      },
    );
    if (!cementWitness) {
      throw new Error('Generated world has no buildable cement supply witness');
    }
    const quarryToCement = this.buildTrack(
      quarry.railAccess,
      cementWorks.railAccess,
      'cement-quarry-to-works',
    );
    if (!sameCurveCoordinates(
      quarryToCement.proposal.geometry,
      cementWitness.quarryToCement.proposal.geometry,
    )) {
      throw new Error('Quarry-to-Cement track drifted from generated witness');
    }
    const cementToPrefab = this.buildTrack(
      cementWorks.railAccess,
      prefab.railAccess,
      'cement-works-to-prefab',
    );
    if (!sameCurveCoordinates(
      cementToPrefab.proposal.geometry,
      cementWitness.cementToPrefabrication.proposal.geometry,
    )) {
      throw new Error('Cement-to-Prefab track drifted from generated witness');
    }

    this.network = Object.freeze({
      starterTrackIds: Object.freeze([...starterTrackIds]),
      prefabTrackId: prefabPreview.quote!.newTrackUUID,
      quarryToCementTrackId: quarryToCement.quote!.newTrackUUID,
      cementToPrefabTrackId: cementToPrefab.quote!.newTrackUUID,
      totalConstructionCost: this.acceptedConstructionCost,
      prefabConnections: prefabPreview.predictedConnections.length,
      quarryToCementConnections:
        quarryToCement.predictedConnections.length,
      cementToPrefabConnections:
        cementToPrefab.predictedConnections.length,
    });
    return this.network;
  }

  purchaseFreightSet(freightSetId: FreightPurchaseSetId): string {
    const before = this.world.trains.length;
    const result = this.purchase.purchase(this.purchase.quote(
      this.purchaseInput(freightSetId),
    ));
    if (result.ok === false) {
      throw new Error(`${freightSetId} purchase failed: ${result.blocker}`);
    }
    if (this.world.trains.length !== before + 1) {
      throw new Error(`${freightSetId} did not add one authoritative train`);
    }
    return result.trainId;
  }

  purchaseInput(
    freightSetId: FreightPurchaseSetId,
  ): FreightPurchaseQuoteInput {
    if (!this.network) throw new Error('Build the supply network first');
    const sourceDefinitionId = freightSetId === AGGREGATE_HOPPER_SET_ID
      ? 'quarry'
      : freightSetId === COVERED_CEMENT_SET_ID
        ? 'cement-works'
        : 'managed-forest';
    const placement = this.endpointInside(sourceDefinitionId);
    return {
      freightSetId,
      trackUUID: placement.trackUUID,
      trackT: placement.trackT,
      x: placement.x,
      y: placement.y,
      topology: this.trackManager.captureTopology(),
    };
  }

  placeAtFacility(trainId: string, definitionId: string): void {
    const train = this.requireLiveTrain(trainId);
    const endpoint = this.endpointInside(definitionId);
    if (!this.trainManager.placeFreightTrain(
      train,
      endpoint.trackUUID,
      endpoint.trackT,
      endpoint.facing,
    )) {
      throw new Error(`Could not place ${trainId} at ${definitionId}`);
    }
  }

  placeAtMidpoint(trainId: string, route: MineralRoute): void {
    if (!this.network) throw new Error('Build the supply network first');
    const trackUUID = route === 'quarry-to-cement'
      ? this.network.quarryToCementTrackId
      : this.network.cementToPrefabTrackId;
    const train = this.requireLiveTrain(trainId);
    if (!this.trainManager.placeFreightTrain(
      train,
      trackUUID,
      0.5,
      1,
    )) {
      throw new Error(`Could not place ${trainId} on ${route}`);
    }
  }

  advanceStoppedTick(): EconomyUpdateResult {
    this.trainManager.stopFreightTrains(
      this.trainManager.trains.map((train) => train.getUUID()),
    );
    return this.advance();
  }

  advanceActiveTick(trainId: string): EconomyUpdateResult {
    this.trainManager.stopFreightTrains(
      this.trainManager.trains.map((train) => train.getUUID()),
    );
    const train = this.requireLiveTrain(trainId);
    train.enginePower = 1;
    const result = this.advance();
    train.enginePower = 0;
    return result;
  }

  derailAndRecover(trainId: string): CementSupplyRecoveryResult {
    const runtimeTrain = this.requireLiveTrain(trainId);
    const authoritativeBefore = this.requireTrainDef(trainId);
    runtimeTrain.derailed = true;
    const derailed = captureTrainRuntime(runtimeTrain);
    if (!this.trainManager.tryRecoverDerailedTrain(runtimeTrain)) {
      throw new Error(`Could not recover ${trainId}`);
    }
    const recovered = captureTrainRuntime(runtimeTrain);
    return {
      authoritativeBefore,
      derailed,
      recovered,
      authoritativeAfter: this.requireTrainDef(trainId),
    };
  }

  saveReload(): CementSupplyCheckpoint {
    if (!WorldManager.save()) throw new Error('Checkpoint save failed');
    const expected = this.world;
    const detached = SaveService.loadWorld(expected.id);
    if (!detached) throw new Error('Detached checkpoint load failed');

    for (const train of [...this.trainManager.trains]) {
      if (!this.trainManager.removeFreightTrain(train.getUUID())) {
        throw new Error(`Could not remove live train ${train.getUUID()}`);
      }
    }
    for (const track of [...this.trackManager.getAllTracks()]) {
      if (!this.trackManager.removeTrack(track.getUUID())) {
        throw new Error(`Could not remove live track ${track.getUUID()}`);
      }
    }

    WorldManager.reset();
    if (!WorldManager.load(expected.id)) {
      throw new Error('Checkpoint authority reload failed');
    }
    this.trackManager = new TrackManager(this.scene);
    this.trainManager = this.createTrainManager();
    new WorldContentLoader(
      this.scene,
      this.trackManager,
      this.trainManager,
    ).load();
    this.constructionService = new ConstructionService(
      this.trackManager,
      this.analyzer,
    );
    this.snapSystem = new SnapSystem(this.trackManager);
    this.economy = new EconomySystem(WorldManager);
    this.purchase = this.createPurchaseService();

    const restoredRuntimeByTrainId = Object.freeze(Object.fromEntries(
      this.trainManager.trains.map((train) => [
        train.getUUID(),
        captureTrainRuntime(train),
      ]),
    ));
    return {
      expected,
      detached: clonePlainData(detached),
      restoredRuntimeByTrainId,
    };
  }

  destroy(): void {
    for (const train of [...this.trainManager.trains]) {
      this.trainManager.removeFreightTrain(train.getUUID());
    }
    for (const track of [...this.trackManager.getAllTracks()]) {
      this.trackManager.removeTrack(track.getUUID());
    }
    WorldManager.reset();
    localStorage.clear();
  }

  private buildTrack(
    startPoint: Readonly<{ x: number; y: number }>,
    endPoint: Readonly<{ x: number; y: number }>,
    trackUUID: string,
  ): ConstructionPreview {
    const start = constructionAnchor(this.snapSystem.snapConstructionPoint(
      startPoint.x,
      startPoint.y,
    ));
    const end = constructionAnchor(this.snapSystem.snapConstructionPoint(
      endPoint.x,
      endPoint.y,
    ));
    const preview = this.constructionService.createPreview(
      start,
      end,
      trackUUID,
    );
    if (!preview?.quote || preview.status !== 'committable') {
      throw new Error(`${trackUUID} is ${preview?.status ?? 'missing'}`);
    }
    const quote = this.constructionService.createQuote(
      start,
      end,
      trackUUID,
    );
    if (!quote
      || quote.totalCost !== preview.quote.totalCost
      || !equalPlainData(quote.proposal, preview.quote.proposal)
      || !equalPlainData(
        quote.predictedConnections,
        preview.predictedConnections,
      )) {
      throw new Error(`${trackUUID} quote drifted`);
    }
    if (!new PlaceTrackCommand(
      this.scene,
      this.trackManager,
      this.constructionService,
      quote,
    ).execute()) {
      throw new Error(`${trackUUID} did not commit`);
    }
    this.acceptedConstructionCost += quote.totalCost;
    return preview;
  }

  private createTrainManager(): TrainManager {
    return new TrainManager(
      this.scene,
      this.trackManager,
      new CameraController(this.scene),
    );
  }

  private createPurchaseService(): FreightPurchaseService {
    const runtime: FreightPurchaseRuntimePort = {
      spawn: (trainId, freightSetId) =>
        this.trainManager.createFreightTrain(trainId, freightSetId),
      place: (train, trackUUID, trackT, facing) =>
        this.trainManager.placeFreightTrain(
          train,
          trackUUID,
          trackT,
          facing,
        ),
      remove: (trainId) => this.trainManager.removeFreightTrain(trainId),
    };
    return new FreightPurchaseService(
      WorldManager,
      runtime,
      () => `cement-supply-train-${this.nextTrainId++}`,
    );
  }

  private requireLiveTrain(trainId: string): Train {
    const train = this.trainManager.trains.find(
      (candidate) => candidate.getUUID() === trainId,
    );
    if (!train) throw new Error(`Missing live train ${trainId}`);
    return train;
  }

  private requireTrainDef(trainId: string): TrainDef {
    const train = this.world.trains.find(({ id }) => id === trainId);
    if (!train) throw new Error(`Missing authoritative train ${trainId}`);
    return clonePlainData(train);
  }

  private requireFacility(definitionId: string) {
    const facility = this.world.economy.facilities.find(
      (candidate) => candidate.definitionId === definitionId,
    );
    if (!facility) throw new Error(`Missing facility ${definitionId}`);
    return facility;
  }

  private endpointInside(definitionId: string): {
    readonly trackUUID: string;
    readonly trackT: 0 | 1;
    readonly facing: 1 | -1;
    readonly x: number;
    readonly y: number;
  } {
    const facility = this.requireFacility(definitionId);
    const candidates = this.world.tracks.flatMap((track) => [
      {
        trackUUID: track.uuid,
        trackT: 0 as const,
        facing: 1 as const,
        x: track.p0.x,
        y: track.p0.y,
      },
      {
        trackUUID: track.uuid,
        trackT: 1 as const,
        facing: -1 as const,
        x: track.p3.x,
        y: track.p3.y,
      },
    ]).filter((candidate) => Math.hypot(
      candidate.x - facility.railAccess.x,
      candidate.y - facility.railAccess.y,
    ) <= facility.railAccess.radius)
      .sort((left, right) => (
        Math.hypot(
          left.x - facility.railAccess.x,
          left.y - facility.railAccess.y,
        ) - Math.hypot(
          right.x - facility.railAccess.x,
          right.y - facility.railAccess.y,
        )
        || left.trackUUID.localeCompare(right.trackUUID)
        || left.trackT - right.trackT
      ));
    const endpoint = candidates[0];
    if (!endpoint) {
      throw new Error(`No track endpoint inside ${definitionId} access`);
    }
    return endpoint;
  }

  private advance(): EconomyUpdateResult {
    const result = this.economy.update(
      ECONOMY_TICK_MS,
      true,
      this.trainManager.trains.map(captureTrainRuntime),
    );
    if (result.ticksAdvanced !== 1 || result.commitRejected) {
      throw new Error('Economy did not commit exactly one tick');
    }
    return result;
  }
}

export const createCementSupplyChainHarness = (
  seed = 'playtest-825',
): CementSupplyChainHarness => new CementSupplyChainHarnessImpl(seed);
