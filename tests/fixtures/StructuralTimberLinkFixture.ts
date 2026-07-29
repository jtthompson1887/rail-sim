import Phaser from 'phaser';
import {
  createEmptyWorld,
  type TrainDef,
  type WorldData,
} from '../../src/config/WorldData';
import { PlaceTrackCommand } from '../../src/commands/PlaceTrackCommand';
import {
  ECONOMY_TICK_MS,
  EconomySystem,
  type EconomyUpdateResult,
} from '../../src/economy/EconomySystem';
import type {
  FacilityDefinition,
  FacilityEconomyDef,
} from '../../src/economy/EconomyData';
import { getFacilityDefinition } from '../../src/economy/ProductCatalog';
import type Train from '../../src/entities/Train';
import {
  FreightPurchaseService,
  type FreightPurchaseRuntimePort,
} from '../../src/freight/FreightPurchaseService';
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
import { clonePlainData } from '../../src/utils/PlainData';
import { makeStarterOpportunity } from './StarterOpportunityFixture';

const { makeScene } = require('../../__mocks__/phaser');

export type EconomyTickBenchmarkState =
  | 'loading'
  | 'transit'
  | 'unloading'
  | 'idle'
  | 'full-destination'
  | 'contention';

export interface EconomyTickBenchmarkFixture {
  readonly world: WorldData;
  readonly runtime: readonly TrainRuntimeSnapshot[];
  readonly stateByTrainId:
    Readonly<Record<string, EconomyTickBenchmarkState>>;
}

const BENCHMARK_TRACK_ID = 'economy-benchmark-mainline';

const makeBenchmarkFacility = (
  definition: FacilityDefinition,
  x: number,
): FacilityEconomyDef => ({
  id: `benchmark-${definition.id}`,
  definitionId: definition.id,
  name: `Benchmark ${definition.displayName}`,
  x,
  y: 0,
  railAccess: { x, y: 0, radius: 40 },
  inventories: Object.fromEntries(definition.inventory.map((slot) => [
    slot.productId,
    {
      productId: slot.productId,
      quantity: slot.initialQuantity,
      reservedQuantity: 0,
      capacity: slot.capacity,
      recentInflow: 0,
      recentOutflow: 0,
      targetStock: slot.targetStock,
    },
  ])),
  activeRecipeId: definition.recipeIds[0] ?? null,
  recipeProgressTicks: 0,
});

const makeBenchmarkTrain = (
  id: string,
  freightSetId: TrainDef['freightSetId'],
  trackT: number,
  cargo: TrainDef['cargo'],
): TrainDef => ({
  id,
  freightSetId,
  trackUUID: BENCHMARK_TRACK_ID,
  trackT,
  facing: 1,
  cargo,
  operations: {
    currentTripRevenue: 0,
    currentTripRunningCost: 0,
    lastTripRevenue: 0,
    lastTripRunningCost: 0,
    lifetimeDeliveredUnits: 0,
    lifetimeRevenue: 0,
    lifetimeRunningCost: 0,
  },
});

interface BenchmarkTrainInput {
  readonly state: EconomyTickBenchmarkState;
  readonly train: TrainDef;
  readonly runtime: Omit<TrainRuntimeSnapshot, 'trainId'>;
}

export const makeEconomyTickBenchmarkFixture =
(): EconomyTickBenchmarkFixture => {
  const world = createEmptyWorld(
    'Economy tick benchmark',
    'economy-tick-benchmark-v1',
    'temperate',
    makeStarterOpportunity('economy-tick-benchmark-v1'),
  );
  world.id = 'economy-tick-benchmark-world';
  world.metadata = {
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
  world.tracks = [{
    geometryVersion: 1,
    uuid: BENCHMARK_TRACK_ID,
    p0: { x: -1_200, y: 0 },
    p1: { x: -400, y: 0 },
    p2: { x: 400, y: 0 },
    p3: { x: 1_200, y: 0 },
    verticalProfile: {
      profileVersion: 1,
      knots: [
        { t: 0, elevation: 0 },
        { t: 1, elevation: 0 },
      ],
    },
    structures: [{
      type: 'surface',
      startT: 0,
      endT: 1,
      startElevation: 0,
      endElevation: 0,
    }],
    paidBuildCost: 50_000,
  }];

  const facilityPositions: ReadonlyArray<readonly [string, number]> = [
    ['managed-forest', -900],
    ['sawmill', -600],
    ['quarry', -300],
    ['cement-works', 0],
    ['port-interchange', 300],
    ['prefabrication-plant', 600],
    ['town-construction-market', 900],
  ];
  world.economy.facilities = facilityPositions.map(([definitionId, x]) => {
    const definition = getFacilityDefinition(definitionId);
    if (!definition) {
      throw new Error(`Missing benchmark facility ${definitionId}`);
    }
    return makeBenchmarkFacility(definition, x);
  });

  const forest = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'managed-forest',
  );
  const sawmill = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'sawmill',
  );
  const quarry = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'quarry',
  );
  const cementWorks = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'cement-works',
  );
  const prefab = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'prefabrication-plant',
  );
  if (!forest || !sawmill || !quarry || !cementWorks || !prefab) {
    throw new Error('Benchmark freight facilities are missing');
  }
  forest.inventories.logs.quantity = 120;
  sawmill.inventories.logs.quantity = 0;
  sawmill.inventories['structural-timber'].quantity = 10;
  quarry.inventories['limestone-aggregate'].quantity = 120;
  cementWorks.inventories['limestone-aggregate'].quantity =
    cementWorks.inventories['limestone-aggregate'].capacity - 10;
  cementWorks.inventories.cement.quantity = 10;
  prefab.inventories['structural-timber'].quantity =
    prefab.inventories['structural-timber'].capacity;
  prefab.inventories.cement.quantity =
    prefab.inventories.cement.capacity - 10;
  prefab.inventories.steel.quantity = 0;

  const stopped = (
    trackT: number,
    x: number,
  ): Omit<TrainRuntimeSnapshot, 'trainId'> => ({
    trackUUID: BENCHMARK_TRACK_ID,
    trackT,
    facing: 1,
    x,
    y: 0,
    speedWorldUnitsPerSecond: 0,
    throttle: 0,
    derailed: false,
  });
  const logs = (
    units: number,
  ): TrainDef['cargo'] => ({
    productId: 'logs',
    units,
    loadedUnits: 60,
    originFacilityId: forest.id,
  });
  const limestoneAggregate = (
    units: number,
  ): TrainDef['cargo'] => ({
    productId: 'limestone-aggregate',
    units,
    loadedUnits: 120,
    originFacilityId: quarry.id,
  });
  const structuralTimber = (): TrainDef['cargo'] => ({
    productId: 'structural-timber',
    units: 20,
    loadedUnits: 60,
    originFacilityId: sawmill.id,
  });
  const cement = (
    units: number,
  ): TrainDef['cargo'] => ({
    productId: 'cement',
    units,
    loadedUnits: 80,
    originFacilityId: cementWorks.id,
  });
  const inputs: BenchmarkTrainInput[] = [
    {
      state: 'loading',
      train: makeBenchmarkTrain(
        'loading-a',
        'flatbed-freight-set',
        0.125,
        null,
      ),
      runtime: stopped(0.125, forest.x),
    },
    {
      state: 'loading',
      train: makeBenchmarkTrain(
        'loading-b',
        'aggregate-hopper-set',
        0.375,
        null,
      ),
      runtime: stopped(0.375, quarry.x),
    },
    {
      state: 'transit',
      train: makeBenchmarkTrain(
        'transit-a',
        'flatbed-freight-set',
        0.42,
        logs(40),
      ),
      runtime: {
        ...stopped(0.42, -192),
        speedWorldUnitsPerSecond: 18,
        throttle: 1,
      },
    },
    {
      state: 'transit',
      train: makeBenchmarkTrain(
        'transit-b',
        'aggregate-hopper-set',
        0.46,
        limestoneAggregate(40),
      ),
      runtime: {
        ...stopped(0.46, -96),
        speedWorldUnitsPerSecond: 18,
        throttle: 1,
      },
    },
    {
      state: 'unloading',
      train: makeBenchmarkTrain(
        'unloading-a',
        'aggregate-hopper-set',
        0.5,
        limestoneAggregate(30),
      ),
      runtime: stopped(0.5, cementWorks.x),
    },
    {
      state: 'unloading',
      train: makeBenchmarkTrain(
        'unloading-b',
        'covered-cement-set',
        0.75,
        cement(30),
      ),
      runtime: stopped(0.75, prefab.x),
    },
    {
      state: 'idle',
      train: makeBenchmarkTrain(
        'idle-a',
        'aggregate-hopper-set',
        1,
        null,
      ),
      runtime: stopped(1, 1_200),
    },
    {
      state: 'idle',
      train: makeBenchmarkTrain(
        'idle-b',
        'covered-cement-set',
        1,
        null,
      ),
      runtime: stopped(1, 1_200),
    },
    {
      state: 'full-destination',
      train: makeBenchmarkTrain(
        'full-destination-a',
        'flatbed-freight-set',
        0.75,
        structuralTimber(),
      ),
      runtime: stopped(0.75, prefab.x),
    },
    {
      state: 'full-destination',
      train: makeBenchmarkTrain(
        'full-destination-b',
        'flatbed-freight-set',
        0.75,
        structuralTimber(),
      ),
      runtime: stopped(0.75, prefab.x),
    },
    {
      state: 'contention',
      train: makeBenchmarkTrain(
        'contention-a',
        'covered-cement-set',
        0.5,
        null,
      ),
      runtime: stopped(0.5, cementWorks.x),
    },
    {
      state: 'contention',
      train: makeBenchmarkTrain(
        'contention-b',
        'covered-cement-set',
        0.5,
        null,
      ),
      runtime: stopped(0.5, cementWorks.x),
    },
  ];
  world.trains = inputs.map(({ train }) => clonePlainData(train));

  return {
    world,
    runtime: inputs.map(({ train, runtime }) => Object.freeze({
      trainId: train.id,
      ...runtime,
    })),
    stateByTrainId: Object.freeze(Object.fromEntries(
      inputs.map(({ state, train }) => [train.id, state]),
    )),
  };
};

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

export interface StructuralTimberLinkHarness {
  buildStarterRoute(): void;
  previewPrefabExtension(): ConstructionPreview;
  buildPrefabExtension(): ConstructionPreview;
  purchaseFlatbed(): string;
  placeAtFacility(trainId: string, definitionId: string): void;
  placeAtMidpoint(
    trainId: string,
    route: 'starter' | 'extension',
  ): void;
  advanceStoppedTick(): EconomyUpdateResult;
  advanceActiveTick(trainId: string): EconomyUpdateResult;
  saveReload(): {
    readonly expected: WorldData;
    readonly detached: WorldData;
    readonly restoredRuntime: ReturnType<typeof captureTrainRuntime>;
  };
  readonly world: WorldData;
  destroy(): void;
}

class StructuralTimberLinkHarnessImpl
implements StructuralTimberLinkHarness {
  private readonly scene: Phaser.Scene;
  private trackManager: TrackManager;
  private trainManager: TrainManager;
  private constructionService: ConstructionService;
  private snapSystem: SnapSystem;
  private economy: EconomySystem;
  private purchase: FreightPurchaseService;
  private starterTrackIds: string[] = [];
  private extensionTrackId: string | null = null;
  private nextTrainId = 1;

  constructor(private readonly seed: string) {
    WorldManager.reset();
    const creation = WorldManager.tryCreateNew(
      'Structural timber integration',
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
    this.trackManager = new TrackManager(this.scene);
    this.trainManager = new TrainManager(
      this.scene,
      this.trackManager,
      new CameraController(this.scene),
    );
    new WorldContentLoader(
      this.scene,
      this.trackManager,
      this.trainManager,
    ).load();
    this.constructionService = new ConstructionService(
      this.trackManager,
      new ConstructionAnalyzer(new TerrainGenerator(seed)),
    );
    this.snapSystem = new SnapSystem(this.trackManager);
    this.economy = new EconomySystem(WorldManager);
    this.purchase = this.createPurchaseService();
  }

  get world(): WorldData {
    const snapshot = WorldManager.snapshot();
    if (!snapshot) throw new Error('Structural timber world is not loaded');
    return clonePlainData(snapshot);
  }

  buildStarterRoute(): void {
    const world = this.world;
    const corridor = [...world.starterOpportunity.corridors].sort(
      (left, right) => (
        left.estimatedCost - right.estimatedCost
        || left.id.localeCompare(right.id)
      ),
    )[0];
    if (!corridor) throw new Error('Generated world has no starter corridor');

    corridor.feasibilityWitness.segments.forEach((segment, index) => {
      const start = constructionAnchor(this.snapSystem.snapConstructionPoint(
        segment.geometry.p0.x,
        segment.geometry.p0.y,
      ));
      const end = constructionAnchor(this.snapSystem.snapConstructionPoint(
        segment.geometry.p3.x,
        segment.geometry.p3.y,
      ));
      const preview = this.constructionService.createPreview(
        start,
        end,
        `structural-starter-${index + 1}`,
      );
      if (!preview?.quote || preview.status !== 'committable') {
        throw new Error(
          `Starter segment ${index + 1} is ${preview?.status ?? 'missing'}`,
        );
      }
      const quote = this.constructionService.createQuote(
        start,
        end,
        `structural-starter-${index + 1}`,
      );
      if (!quote
        || quote.totalCost !== preview.quote.totalCost
        || quote.predictedConnections.length
          !== preview.predictedConnections.length) {
        throw new Error(`Starter segment ${index + 1} quote drifted`);
      }
      const command = new PlaceTrackCommand(
        this.scene,
        this.trackManager,
        this.constructionService,
        quote,
      );
      if (!command.execute()) {
        throw new Error(`Starter segment ${index + 1} did not commit`);
      }
      this.starterTrackIds.push(quote.newTrackUUID);
    });
  }

  previewPrefabExtension(): ConstructionPreview {
    const world = this.world;
    const sawmill = world.economy.facilities.find(
      ({ definitionId }) => definitionId === 'sawmill',
    );
    const prefab = world.economy.facilities.find(
      ({ definitionId }) => definitionId === 'prefabrication-plant',
    );
    if (!sawmill || !prefab) {
      throw new Error('Generated structural timber facilities are missing');
    }

    const endpoints = world.tracks.flatMap((track) => [
      { point: track.p0 },
      { point: track.p3 },
    ]).sort((left, right) => (
      Math.hypot(
        left.point.x - sawmill.railAccess.x,
        left.point.y - sawmill.railAccess.y,
      ) - Math.hypot(
        right.point.x - sawmill.railAccess.x,
        right.point.y - sawmill.railAccess.y,
      )
    ));
    const sawmillEndpoint = endpoints[0];
    if (!sawmillEndpoint) throw new Error('Starter route has no endpoint');

    const start = constructionAnchor(this.snapSystem.snapConstructionPoint(
      sawmillEndpoint.point.x,
      sawmillEndpoint.point.y,
    ));
    const end = constructionAnchor(this.snapSystem.snapConstructionPoint(
      prefab.railAccess.x,
      prefab.railAccess.y,
    ));
    const preview = this.constructionService.createPreview(
      start,
      end,
      'structural-prefab-extension',
    );
    if (!preview) throw new Error('Prefab extension preview is missing');
    return preview;
  }

  buildPrefabExtension(): ConstructionPreview {
    const preview = this.previewPrefabExtension();
    if (!preview.quote || preview.status !== 'committable') {
      throw new Error(`Prefab extension is ${preview.status}`);
    }
    const command = new PlaceTrackCommand(
      this.scene,
      this.trackManager,
      this.constructionService,
      preview.quote,
    );
    if (!command.execute()) {
      throw new Error('Prefab extension did not commit');
    }
    this.extensionTrackId = preview.quote.newTrackUUID;
    return preview;
  }

  purchaseFlatbed(): string {
    const world = this.world;
    const forest = this.requireFacility('managed-forest');
    const placement = this.endpointInside(forest.definitionId);
    const quote = this.purchase.quote({
      freightSetId: 'flatbed-freight-set',
      trackUUID: placement.trackUUID,
      trackT: placement.trackT,
      x: placement.x,
      y: placement.y,
      topology: this.trackManager.captureTopology(),
    });
    if (!quote.valid) {
      throw new Error(`Flatbed quote failed: ${quote.blocker}`);
    }
    const result = this.purchase.purchase(quote);
    if (result.ok === false) {
      throw new Error(`Flatbed purchase failed: ${result.blocker}`);
    }
    if (this.world.trains.length !== world.trains.length + 1) {
      throw new Error('Flatbed purchase did not add one authoritative train');
    }
    return result.trainId;
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

  placeAtMidpoint(
    trainId: string,
    route: 'starter' | 'extension',
  ): void {
    const train = this.requireLiveTrain(trainId);
    const trackUUID = route === 'extension'
      ? this.extensionTrackId
      : this.starterTrackIds[0];
    if (!trackUUID) throw new Error(`Missing ${route} route`);
    if (!this.trainManager.placeFreightTrain(train, trackUUID, 0.5, 1)) {
      throw new Error(`Could not place ${trainId} on ${route} midpoint`);
    }
  }

  advanceStoppedTick(): EconomyUpdateResult {
    for (const train of this.trainManager.trains) train.enginePower = 0;
    return this.advance();
  }

  advanceActiveTick(trainId: string): EconomyUpdateResult {
    const train = this.requireLiveTrain(trainId);
    train.enginePower = 1;
    const result = this.advance();
    train.enginePower = 0;
    return result;
  }

  saveReload(): {
    readonly expected: WorldData;
    readonly detached: WorldData;
    readonly restoredRuntime: ReturnType<typeof captureTrainRuntime>;
  } {
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
    const restored = WorldManager.load(expected.id);
    if (!restored) throw new Error('Checkpoint authority reload failed');
    this.trackManager = new TrackManager(this.scene);
    this.trainManager = new TrainManager(
      this.scene,
      this.trackManager,
      new CameraController(this.scene),
    );
    new WorldContentLoader(
      this.scene,
      this.trackManager,
      this.trainManager,
    ).load();
    this.constructionService = new ConstructionService(
      this.trackManager,
      new ConstructionAnalyzer(new TerrainGenerator(this.seed)),
    );
    this.snapSystem = new SnapSystem(this.trackManager);
    this.economy = new EconomySystem(WorldManager);
    this.purchase = this.createPurchaseService();

    const liveTrain = this.trainManager.trains[0];
    if (!liveTrain) throw new Error('Checkpoint restored no live train');
    return {
      expected,
      detached: clonePlainData(detached),
      restoredRuntime: captureTrainRuntime(liveTrain),
    };
  }

  destroy(): void {
    for (const train of [...this.trainManager.trains]) {
      this.trainManager.removeFreightTrain(train.getUUID());
    }
    for (const track of this.trackManager.getAllTracks()) {
      this.trackManager.removeTrack(track.getUUID());
    }
    WorldManager.reset();
    localStorage.clear();
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
      () => `structural-flatbed-${this.nextTrainId++}`,
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

export const createStructuralTimberLinkHarness = (
  seed = 'playtest-753',
): StructuralTimberLinkHarness => new StructuralTimberLinkHarnessImpl(seed);
