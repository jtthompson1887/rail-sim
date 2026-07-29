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
  type CementSupplyOpportunityWitness,
} from '../../src/economy/CementSupplyOpportunity';
import {
  analyzePrefabricationExtension,
  resolvePrefabricationExtensionStart,
  type PrefabricationExtensionWitness,
} from '../../src/economy/PrefabricationOpportunity';
import {
  createRegionalConstructionOpportunityAnalyzer,
  type RegionalConstructionOpportunityWitness,
} from '../../src/economy/RegionalConstructionOpportunity';
import type { FreightDeliveryEvent } from '../../src/freight/CargoSystem';
import { deriveFreightObjective } from '../../src/freight/FreightObjective';
import {
  FreightPurchaseService,
  type FreightPurchaseQuoteInput,
  type FreightPurchaseRuntimePort,
  type FreightPurchaseSetId,
} from '../../src/freight/FreightPurchaseService';
import {
  AGGREGATE_HOPPER_SET_ID,
  COVERED_CEMENT_SET_ID,
  FLATBED_FREIGHT_SET_ID,
} from '../../src/freight/FreightSetCatalog';
import {
  captureTrainRuntime,
  type TrainRuntimeSnapshot,
} from '../../src/freight/TrainRuntime';
import type Train from '../../src/entities/Train';
import TrackManager, {
  type TrackTopologySnapshot,
} from '../../src/managers/TrackManager';
import { TrainManager } from '../../src/managers/TrainManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { SaveService } from '../../src/services/SaveService';
import { WorldContentLoader } from '../../src/services/WorldContentLoader';
import { CameraController } from '../../src/systems/CameraController';
import {
  ConstructionAnalyzer,
  type ConstructionProposal,
} from '../../src/systems/ConstructionAnalyzer';
import {
  ConstructionService,
  type ConstructionInputAnchor,
  type ConstructionPreview,
} from '../../src/systems/ConstructionService';
import { SnapSystem, type SnapResult } from '../../src/systems/SnapSystem';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import {
  clonePlainData,
  equalPlainData,
} from '../../src/utils/PlainData';

const { makeScene } = require('../../__mocks__/phaser');

export interface CementCompleteResult {
  readonly flatbedTrainId: string;
  readonly totalConstructionCost: number;
  readonly completedDeliveries: readonly FreightDeliveryEvent[];
  readonly batchRevenue: readonly number[];
}

export interface RegionalNetworkResult {
  readonly portTrackId: string;
  readonly townTrackId: string;
  readonly totalConstructionCost: number;
  readonly portConnections: number;
  readonly townConnections: number;
}

export interface RegionalSupplyCheckpoint {
  readonly expected: WorldData;
  readonly detached: WorldData;
  readonly savedAuthorityByTrainId:
    Readonly<Record<string, TrainDef>>;
  readonly restoredAuthorityByTrainId:
    Readonly<Record<string, TrainDef>>;
  readonly savedRuntimeTrainIds: readonly string[];
  readonly restoredRuntimeTrainIds: readonly string[];
  readonly savedRuntimeByTrainId:
    Readonly<Record<string, TrainRuntimeSnapshot>>;
  readonly restoredRuntimeByTrainId:
    Readonly<Record<string, TrainRuntimeSnapshot>>;
  readonly savedTrackIds: readonly string[];
  readonly restoredTrackIds: readonly string[];
  readonly savedTopology: TrackTopologySnapshot;
  readonly restoredTopology: TrackTopologySnapshot;
}

export interface RegionalConstructionSupplyHarness {
  completeCementPrerequisite(): CementCompleteResult;
  buildRegionalExtensions(): RegionalNetworkResult;
  placeAtFacility(trainId: string, definitionId: string): void;
  placeOnRegionalRoute(trainId: string, route: 'steel' | 'modules'): void;
  advanceStoppedTick(): EconomyUpdateResult;
  advanceActiveTick(trainId: string): EconomyUpdateResult;
  saveReload(): RegionalSupplyCheckpoint;
  deriveObjective(): ReturnType<typeof deriveFreightObjective>;
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
  left: ConstructionProposal['geometry'],
  right: ConstructionProposal['geometry'],
): boolean => (
  left.geometryVersion === right.geometryVersion
  && (['p0', 'p1', 'p2', 'p3'] as const).every((point) => (
    left[point].x === right[point].x
      && left[point].y === right[point].y
  ))
);

class RegionalConstructionSupplyHarnessImpl
implements RegionalConstructionSupplyHarness {
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
  private cementComplete: CementCompleteResult | null = null;
  private regionalNetwork: RegionalNetworkResult | null = null;
  private regionalWitness: RegionalConstructionOpportunityWitness | null =
    null;
  private starterTrackIds: string[] = [];
  private prefabTrackId: string | null = null;
  private quarryToCementTrackId: string | null = null;
  private cementToPrefabTrackId: string | null = null;

  constructor(private readonly seed: string) {
    WorldManager.reset();
    const creation = WorldManager.tryCreateNew(
      'Regional construction supply integration',
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
    if (!snapshot) throw new Error('Regional supply world is not loaded');
    return clonePlainData(snapshot);
  }

  completeCementPrerequisite(): CementCompleteResult {
    if (this.cementComplete) return this.cementComplete;
    const generated = this.world;
    const corridor = [...generated.starterOpportunity.corridors].sort(
      (left, right) => left.estimatedCost - right.estimatedCost
        || left.id.localeCompare(right.id),
    )[0];
    if (!corridor) throw new Error('Generated world has no starter corridor');

    const extensionStart = resolvePrefabricationExtensionStart(
      generated.starterOpportunity,
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
    const quarry = this.requireFacility('quarry');
    const cementWorks = this.requireFacility('cement-works');
    const cementWitness = analyzeCementSupplyOpportunity(
      this.analyzer,
      generated.starterOpportunity,
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
    this.regionalWitness = this.requireRegionalWitness(
      generated,
      prefabWitness,
      cementWitness,
    );

    const completedDeliveries: FreightDeliveryEvent[] = [];
    const batchRevenue: number[] = [];
    const constructionOpening = this.acceptedConstructionCost;

    this.starterTrackIds = corridor.feasibilityWitness.segments.map(
      (segment, index) => this.buildTrack(
        segment.geometry.p0,
        segment.geometry.p3,
        `regional-starter-${index + 1}`,
        segment.geometry,
      ).quote!.newTrackUUID,
    );

    const flatbedTrainId = this.purchaseFreightSet(FLATBED_FREIGHT_SET_ID);
    for (let delivery = 0; delivery < 2; delivery += 1) {
      this.parkAtTrackMidpoint(flatbedTrainId, this.starterTrackIds[0]);
      this.waitForInventory('managed-forest', 'logs', 60);
      this.placeAtFacility(flatbedTrainId, 'managed-forest');
      this.runTransferTicks(
        flatbedTrainId,
        6,
        'loading',
        'logs',
        completedDeliveries,
        batchRevenue,
      );
      this.parkAtTrackMidpoint(flatbedTrainId, this.starterTrackIds[0]);
      this.advanceActiveTick(flatbedTrainId);
      this.placeAtFacility(flatbedTrainId, 'sawmill');
      this.runTransferTicks(
        flatbedTrainId,
        6,
        'unloading',
        'logs',
        completedDeliveries,
        batchRevenue,
      );
    }

    this.parkAtTrackMidpoint(flatbedTrainId, this.starterTrackIds[0]);
    this.waitForInventory('sawmill', 'structural-timber', 60);
    const prefabPreview = this.buildTrack(
      extensionStart.point,
      prefab.railAccess,
      'regional-prefab-extension',
      prefabWitness.proposal.geometry,
    );
    this.prefabTrackId = prefabPreview.quote!.newTrackUUID;
    this.placeAtFacility(flatbedTrainId, 'sawmill');
    this.runTransferTicks(
      flatbedTrainId,
      6,
      'loading',
      'structural-timber',
      completedDeliveries,
      batchRevenue,
    );
    this.parkAtTrackMidpoint(flatbedTrainId, this.prefabTrackId);
    this.advanceActiveTick(flatbedTrainId);
    this.placeAtFacility(flatbedTrainId, 'prefabrication-plant');
    this.runTransferTicks(
      flatbedTrainId,
      6,
      'unloading',
      'structural-timber',
      completedDeliveries,
      batchRevenue,
    );

    const quarryToCement = this.buildTrack(
      quarry.railAccess,
      cementWorks.railAccess,
      'regional-quarry-to-cement',
      cementWitness.quarryToCement.proposal.geometry,
    );
    this.quarryToCementTrackId =
      quarryToCement.quote!.newTrackUUID;
    const cementToPrefab = this.buildTrack(
      cementWorks.railAccess,
      prefab.railAccess,
      'regional-cement-to-prefab',
      cementWitness.cementToPrefabrication.proposal.geometry,
    );
    this.cementToPrefabTrackId = cementToPrefab.quote!.newTrackUUID;

    this.parkAtTrackMidpoint(flatbedTrainId, this.prefabTrackId);
    this.waitForInventory('quarry', 'limestone-aggregate', 120);
    const aggregateTrainId = this.purchaseFreightSet(
      AGGREGATE_HOPPER_SET_ID,
    );
    this.placeAtFacility(aggregateTrainId, 'quarry');
    this.runTransferTicks(
      aggregateTrainId,
      12,
      'loading',
      'limestone-aggregate',
      completedDeliveries,
      batchRevenue,
    );
    this.parkAtTrackMidpoint(
      aggregateTrainId,
      this.quarryToCementTrackId,
    );
    this.advanceActiveTick(aggregateTrainId);
    this.placeAtFacility(aggregateTrainId, 'cement-works');
    this.runTransferTicks(
      aggregateTrainId,
      12,
      'unloading',
      'limestone-aggregate',
      completedDeliveries,
      batchRevenue,
    );

    this.parkAtTrackMidpoint(
      aggregateTrainId,
      this.quarryToCementTrackId,
    );
    this.waitForInventory('cement-works', 'cement', 80);
    const cementTrainId = this.purchaseFreightSet(COVERED_CEMENT_SET_ID);
    this.placeAtFacility(cementTrainId, 'cement-works');
    this.runTransferTicks(
      cementTrainId,
      8,
      'loading',
      'cement',
      completedDeliveries,
      batchRevenue,
    );
    this.parkAtTrackMidpoint(cementTrainId, this.cementToPrefabTrackId);
    this.advanceActiveTick(cementTrainId);
    this.placeAtFacility(cementTrainId, 'prefabrication-plant');
    this.runTransferTicks(
      cementTrainId,
      8,
      'unloading',
      'cement',
      completedDeliveries,
      batchRevenue,
    );

    this.cementComplete = Object.freeze({
      flatbedTrainId,
      totalConstructionCost:
        this.acceptedConstructionCost - constructionOpening,
      completedDeliveries: Object.freeze(clonePlainData(completedDeliveries)),
      batchRevenue: Object.freeze([...batchRevenue]),
    });
    return this.cementComplete;
  }

  buildRegionalExtensions(): RegionalNetworkResult {
    if (this.regionalNetwork) return this.regionalNetwork;
    if (!this.cementComplete || !this.regionalWitness) {
      throw new Error('Complete the cement prerequisite first');
    }
    const constructionOpening = this.acceptedConstructionCost;
    const port = this.buildTrack(
      this.regionalWitness.portExtension.proposal.geometry.p0,
      this.regionalWitness.portExtension.proposal.geometry.p3,
      'regional-port-extension',
      this.regionalWitness.portExtension.proposal.geometry,
    );
    const town = this.buildTrack(
      this.regionalWitness.townExtension.proposal.geometry.p0,
      this.regionalWitness.townExtension.proposal.geometry.p3,
      'regional-town-extension',
      this.regionalWitness.townExtension.proposal.geometry,
    );
    const totalConstructionCost =
      this.acceptedConstructionCost - constructionOpening;
    if (totalConstructionCost !== this.regionalWitness.totalCost) {
      throw new Error('Committed regional construction cost drifted');
    }
    this.regionalNetwork = Object.freeze({
      portTrackId: port.quote!.newTrackUUID,
      townTrackId: town.quote!.newTrackUUID,
      totalConstructionCost,
      portConnections: port.predictedConnections.length,
      townConnections: town.predictedConnections.length,
    });
    return this.regionalNetwork;
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

  placeOnRegionalRoute(
    trainId: string,
    route: 'steel' | 'modules',
  ): void {
    if (!this.regionalNetwork) {
      throw new Error('Build the regional extensions first');
    }
    this.parkAtTrackMidpoint(
      trainId,
      route === 'steel'
        ? this.regionalNetwork.portTrackId
        : this.regionalNetwork.townTrackId,
    );
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

  saveReload(): RegionalSupplyCheckpoint {
    if (!WorldManager.save()) throw new Error('Checkpoint save failed');
    const expected = this.world;
    const detached = SaveService.loadWorld(expected.id);
    if (!detached) throw new Error('Detached checkpoint load failed');
    const savedAuthorityByTrainId = Object.freeze(Object.fromEntries(
      expected.trains.map((train) => [train.id, clonePlainData(train)]),
    ));
    const savedRuntimeTrainIds = Object.freeze(
      this.trainManager.trains.map((train) => train.getUUID()).sort(),
    );
    const savedRuntimeByTrainId = Object.freeze(Object.fromEntries(
      this.trainManager.trains.map((train) => [
        train.getUUID(),
        captureTrainRuntime(train),
      ]),
    ));
    const savedTrackIds = Object.freeze(
      this.trackManager.getAllTracks()
        .map((track) => track.getUUID())
        .sort(),
    );
    const savedTopology = clonePlainData(
      this.trackManager.captureTopology(),
    );

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
    const restored = this.world;
    const restoredAuthorityByTrainId = Object.freeze(Object.fromEntries(
      restored.trains.map((train) => [train.id, clonePlainData(train)]),
    ));
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

    const restoredRuntimeTrainIds = Object.freeze(
      this.trainManager.trains.map((train) => train.getUUID()).sort(),
    );
    const restoredRuntimeByTrainId = Object.freeze(Object.fromEntries(
      this.trainManager.trains.map((train) => [
        train.getUUID(),
        captureTrainRuntime(train),
      ]),
    ));
    const restoredTrackIds = Object.freeze(
      this.trackManager.getAllTracks()
        .map((track) => track.getUUID())
        .sort(),
    );
    const restoredTopology = clonePlainData(
      this.trackManager.captureTopology(),
    );
    return {
      expected,
      detached: clonePlainData(detached),
      savedAuthorityByTrainId,
      restoredAuthorityByTrainId,
      savedRuntimeTrainIds,
      restoredRuntimeTrainIds,
      savedRuntimeByTrainId,
      restoredRuntimeByTrainId,
      savedTrackIds,
      restoredTrackIds,
      savedTopology,
      restoredTopology,
    };
  }

  deriveObjective(): ReturnType<typeof deriveFreightObjective> {
    return deriveFreightObjective(
      this.world,
      this.trackManager.captureTopology(),
    );
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

  private requireRegionalWitness(
    world: WorldData,
    prefabWitness: PrefabricationExtensionWitness,
    cementWitness: CementSupplyOpportunityWitness,
  ): RegionalConstructionOpportunityWitness {
    const analyze = createRegionalConstructionOpportunityAnalyzer(
      this.analyzer,
      world.starterOpportunity,
      prefabWitness,
      cementWitness,
    );
    if (!analyze) {
      throw new Error('Generated world has no regional analyzer');
    }
    const port = this.requireFacility('port-interchange');
    const town = this.requireFacility('town-construction-market');
    const witness = analyze({
      portInterchange: {
        x: port.railAccess.x,
        y: port.railAccess.y,
      },
      townConstructionMarket: {
        x: town.railAccess.x,
        y: town.railAccess.y,
      },
    });
    if (!witness) {
      throw new Error('Generated world has no regional construction witness');
    }
    return witness;
  }

  private buildTrack(
    startPoint: Readonly<{ x: number; y: number }>,
    endPoint: Readonly<{ x: number; y: number }>,
    trackUUID: string,
    expectedGeometry: ConstructionProposal['geometry'],
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
    if (!sameCurveCoordinates(preview.proposal.geometry, expectedGeometry)) {
      throw new Error(`${trackUUID} drifted from generated witness`);
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

  private purchaseFreightSet(
    freightSetId: FreightPurchaseSetId,
  ): string {
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

  private purchaseInput(
    freightSetId: FreightPurchaseSetId,
  ): FreightPurchaseQuoteInput {
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

  private runTransferTicks(
    trainId: string,
    count: number,
    kind: 'loading' | 'unloading',
    productId: string,
    completedDeliveries: FreightDeliveryEvent[],
    batchRevenue: number[],
  ): void {
    for (let batch = 0; batch < count; batch += 1) {
      const result = this.advanceStoppedTick();
      const status = result.cargoStatuses.find(
        (candidate) => candidate.trainId === trainId,
      );
      if (!status
        || status.kind !== kind
        || status.productId !== productId) {
        throw new Error(`${trainId} did not ${kind} ${productId}`);
      }
      if (kind === 'unloading') batchRevenue.push(status.batchRevenue);
      completedDeliveries.push(...result.completedDeliveries);
    }
  }

  private waitForInventory(
    definitionId: string,
    productId: string,
    minimum: number,
  ): void {
    let ticks = 0;
    while (this.requireFacility(definitionId)
      .inventories[productId].quantity < minimum) {
      this.advanceStoppedTick();
      ticks += 1;
      if (ticks > 160) {
        throw new Error(`${definitionId} did not produce ${minimum} ${productId}`);
      }
    }
  }

  private parkAtTrackMidpoint(trainId: string, trackUUID: string | null): void {
    if (!trackUUID) throw new Error(`Missing parking track for ${trainId}`);
    if (!this.trainManager.placeFreightTrain(
      this.requireLiveTrain(trainId),
      trackUUID,
      0.5,
      1,
    )) {
      throw new Error(`Could not park ${trainId} on ${trackUUID}`);
    }
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
      () => `regional-supply-train-${this.nextTrainId++}`,
    );
  }

  private requireLiveTrain(trainId: string): Train {
    const train = this.trainManager.trains.find(
      (candidate) => candidate.getUUID() === trainId,
    );
    if (!train) throw new Error(`Missing live train ${trainId}`);
    return train;
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

export const createRegionalConstructionSupplyHarness = (
  seed = 'playtest-825',
): RegionalConstructionSupplyHarness =>
  new RegionalConstructionSupplyHarnessImpl(seed);
