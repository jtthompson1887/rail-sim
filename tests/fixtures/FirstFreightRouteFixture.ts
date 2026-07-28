import {
  createEmptyWorld,
  type TrainDef,
  type WorldData,
} from '../../src/config/WorldData';
import Phaser from 'phaser';
import type Train from '../../src/entities/Train';
import { PlaceTrackCommand } from '../../src/commands/PlaceTrackCommand';
import { GameConfig } from '../../src/config/GameConfig';
import {
  ECONOMY_TICK_MS,
  EconomySystem,
} from '../../src/economy/EconomySystem';
import { createCompanyState } from '../../src/economy/FinanceLedger';
import { getFacilityDefinition } from '../../src/economy/ProductCatalog';
import type {
  FacilityDefinition,
  FacilityEconomyDef,
} from '../../src/economy/EconomyData';
import {
  FreightPurchaseService,
  type FreightPurchaseRuntimePort,
} from '../../src/freight/FreightPurchaseService';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
import TrackManager, {
  type TrackTopologySnapshot,
} from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { SaveService } from '../../src/services/SaveService';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { ConstructionService } from '../../src/systems/ConstructionService';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { clonePlainData } from '../../src/utils/PlainData';
import { makeStarterOpportunity } from './StarterOpportunityFixture';

const { makeScene } = require('../../__mocks__/phaser');

const makeFacility = (
  definition: FacilityDefinition,
  x: number,
): FacilityEconomyDef => ({
  id: definition.id,
  definitionId: definition.id,
  name: definition.displayName,
  x,
  y: 0,
  railAccess: { x, y: 0, radius: 32.5 },
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

export const makeFreightTrainDef = (
  overrides: Partial<TrainDef> = {},
): TrainDef => ({
  id: 'train-1',
  freightSetId: 'flatbed-freight-set',
  trackUUID: 'forest-sawmill-track',
  trackT: 0.1,
  facing: 1,
  cargo: null,
  operations: {
    currentTripRevenue: 0,
    currentTripRunningCost: 0,
    lastTripRevenue: 0,
    lastTripRunningCost: 0,
    lifetimeDeliveredUnits: 0,
    lifetimeRevenue: 0,
    lifetimeRunningCost: 0,
  },
  ...overrides,
});

export const makeFirstFreightRouteWorld = (): WorldData => {
  const world = createEmptyWorld(
    'First freight route',
    'first-freight-route',
    'temperate',
    makeStarterOpportunity('first-freight-route'),
  );
  world.tracks.push({
    geometryVersion: 1,
    uuid: 'forest-sawmill-track',
    p0: { x: -500, y: 0 },
    p1: { x: -167, y: 0 },
    p2: { x: 167, y: 0 },
    p3: { x: 500, y: 0 },
    verticalProfile: {
      profileVersion: 1,
      knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
    },
    structures: [{
      type: 'surface',
      startT: 0,
      endT: 1,
      startElevation: 0,
      endElevation: 0,
    }],
    paidBuildCost: 10_000,
  });

  const forestDefinition = getFacilityDefinition('managed-forest');
  const sawmillDefinition = getFacilityDefinition('sawmill');
  if (!forestDefinition || !sawmillDefinition) {
    throw new Error('First freight route facility definitions are missing');
  }
  world.economy.facilities.push(
    makeFacility(forestDefinition, -500),
    makeFacility(sawmillDefinition, 500),
  );
  world.trains.push(makeFreightTrainDef());
  return world;
};

export interface FirstFreightRoutePhaseOptions {
  readonly cash?: number;
  readonly cargoUnits?: number;
  readonly forestLogs?: number;
  readonly forestReservedLogs?: number;
  readonly sawmillLogs?: number;
}

export const installFirstFreightRoutePhase = (
  options: FirstFreightRoutePhaseOptions = {},
): WorldData => {
  const world = makeFirstFreightRouteWorld();
  if (options.cash !== undefined) {
    world.company = createCompanyState(options.cash);
  }
  const forest = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'managed-forest',
  );
  const sawmill = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'sawmill',
  );
  if (!forest || !sawmill) {
    throw new Error('First route phase facilities are missing');
  }
  if (options.forestLogs !== undefined) {
    forest.inventories.logs.quantity = options.forestLogs;
  }
  if (options.forestReservedLogs !== undefined) {
    forest.inventories.logs.reservedQuantity =
      options.forestReservedLogs;
  }
  if (options.sawmillLogs !== undefined) {
    sawmill.inventories.logs.quantity = options.sawmillLogs;
  }
  if (options.cargoUnits !== undefined) {
    world.trains[0].cargo = {
      productId: 'logs',
      units: options.cargoUnits,
      loadedUnits: options.cargoUnits,
      originFacilityId: forest.id,
    };
  }

  WorldManager.reset();
  if (!SaveService.saveWorld(world)) {
    throw new Error('First route phase fixture did not save');
  }
  const installed = WorldManager.load(world.id);
  if (!installed) throw new Error('First route phase fixture did not load');
  return installed;
};

export interface FirstRouteHarness {
  buildConnectedRoute(): void;
  purchaseTimberSet(): string;
  setRuntime(
    trainId: string,
    snapshot: Partial<TrainRuntimeSnapshot>,
  ): void;
  runtimeSnapshot(trainId: string): TrainRuntimeSnapshot;
  advanceTicks(count: number): void;
  saveReload(): void;
  readonly world: WorldData;
  destroy(): void;
}

const pointOnTrack = (
  track: WorldData['tracks'][number],
  t: number,
): { x: number; y: number } => {
  const inverse = 1 - t;
  return {
    x: track.p0.x * inverse * inverse * inverse
      + 3 * track.p1.x * inverse * inverse * t
      + 3 * track.p2.x * inverse * t * t
      + track.p3.x * t * t * t,
    y: track.p0.y * inverse * inverse * inverse
      + 3 * track.p1.y * inverse * inverse * t
      + 3 * track.p2.y * inverse * t * t
      + track.p3.y * t * t * t,
  };
};

const runtimeFromTrain = (
  world: WorldData,
  train: TrainDef,
): TrainRuntimeSnapshot => {
  const track = world.tracks.find(({ uuid }) => uuid === train.trackUUID);
  if (!track) throw new Error(`Missing runtime track ${train.trackUUID}`);
  const point = pointOnTrack(track, train.trackT);
  return {
    trainId: train.id,
    trackUUID: train.trackUUID,
    trackT: train.trackT,
    facing: train.facing,
    x: point.x,
    y: point.y,
    speedWorldUnitsPerSecond: 0,
    throttle: 0,
    derailed: false,
  };
};

class FirstRouteHarnessImpl implements FirstRouteHarness {
  private readonly runtimeByTrainId =
    new Map<string, TrainRuntimeSnapshot>();
  private topology: TrackTopologySnapshot | null = null;
  private readonly scene: Phaser.Scene;
  private readonly trackManager: TrackManager;
  private readonly constructionService: ConstructionService;
  private readonly purchase: FreightPurchaseService;
  private readonly economy = new EconomySystem(WorldManager);

  constructor(seed: string) {
    WorldManager.reset();
    const creation = WorldManager.tryCreateNew(
      'Task 13 first freight route',
      seed,
      'temperate',
    );
    if (creation.ok === false) {
      throw new Error(`Could not generate harness world: ${creation.error.code}`);
    }
    const worldId = creation.world.id;
    if (!SaveService.loadWorld(worldId)) {
      throw new Error('Generated harness world was not persisted');
    }
    WorldManager.reset();
    if (!WorldManager.load(worldId)) {
      throw new Error('Generated harness world could not be loaded');
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
    const terrain = new TerrainGenerator(seed);
    this.constructionService = new ConstructionService(
      this.trackManager,
      new ConstructionAnalyzer(terrain),
    );

    const runtimePort: FreightPurchaseRuntimePort = {
      spawn: (trainId) => {
        this.runtimeByTrainId.set(trainId, {
          trainId,
          trackUUID: null,
          trackT: null,
          facing: 1,
          x: 0,
          y: 0,
          speedWorldUnitsPerSecond: 0,
          throttle: 0,
          derailed: true,
        });
        return {
          getUUID: () => trainId,
        } as unknown as Train;
      },
      place: (train, trackUUID, trackT, facing) => {
        const authoritative = WorldManager.world;
        const track = authoritative?.tracks.find(
          ({ uuid }) => uuid === trackUUID,
        );
        if (!track) return false;
        const point = pointOnTrack(track, trackT);
        this.runtimeByTrainId.set(train.getUUID(), {
          trainId: train.getUUID(),
          trackUUID,
          trackT,
          facing,
          x: point.x,
          y: point.y,
          speedWorldUnitsPerSecond: 0,
          throttle: 0,
          derailed: false,
        });
        return true;
      },
      remove: (trainId) => {
        this.runtimeByTrainId.delete(trainId);
      },
    };
    this.purchase = new FreightPurchaseService(
      WorldManager,
      runtimePort,
      () => 'task-13-timber-train',
    );
  }

  get world(): WorldData {
    if (!WorldManager.world) throw new Error('Harness world is not loaded');
    return clonePlainData(WorldManager.world);
  }

  buildConnectedRoute(): void {
    const authority = WorldManager.world;
    if (!authority) throw new Error('Harness world is not loaded');
    const corridor = [...authority.starterOpportunity.corridors]
      .sort((left, right) => left.estimatedCost - right.estimatedCost)[0];
    const openingCash = authority.company.cash;
    const openingEntries = authority.company.ledger.length;

    corridor.feasibilityWitness.segments.forEach((segment, index) => {
      const quote = this.constructionService.createQuote(
        segment.geometry.p0,
        segment.geometry.p3,
        `task-13-route-${index + 1}`,
      );
      if (!quote) throw new Error(`Missing quote for route segment ${index + 1}`);
      const command = new PlaceTrackCommand(
        this.scene,
        this.trackManager,
        this.constructionService,
        quote,
      );
      if (!command.execute()) {
        throw new Error(`Route segment ${index + 1} did not commit`);
      }
    });

    const built = WorldManager.world;
    if (!built) throw new Error('Harness world was unloaded during construction');
    const constructionEntries = built.company.ledger.slice(openingEntries)
      .filter(({ category }) => category === 'construction-capex');
    if (constructionEntries.length
      !== corridor.feasibilityWitness.segments.length) {
      throw new Error('Construction did not post one capex entry per segment');
    }
    const chargedCapex = constructionEntries.reduce(
      (total, entry) => total - entry.amount,
      0,
    );
    if (built.company.cash !== openingCash - chargedCapex) {
      throw new Error('Construction cash does not equal committed capex');
    }
    this.topology = this.trackManager.captureTopology();
  }

  purchaseTimberSet(): string {
    if (!this.topology) throw new Error('Build the connected route first');
    const world = WorldManager.world;
    if (!world) throw new Error('Harness world is not loaded');
    const forest = world.economy.facilities.find(
      ({ definitionId }) => definitionId === 'managed-forest',
    );
    if (!forest) throw new Error('Harness forest is missing');
    const endpoints = world.tracks.flatMap((track) => [
      { track, trackT: 0, point: track.p0 },
      { track, trackT: 1, point: track.p3 },
    ]).sort((left, right) => (
      Math.hypot(
        left.point.x - forest.railAccess.x,
        left.point.y - forest.railAccess.y,
      ) - Math.hypot(
        right.point.x - forest.railAccess.x,
        right.point.y - forest.railAccess.y,
      )
    ));
    const access = endpoints[0];
    if (!access) throw new Error('Harness route has no forest endpoint');
    const quote = this.purchase.quote({
      freightSetId: 'flatbed-freight-set',
      trackUUID: access.track.uuid,
      trackT: access.trackT,
      x: access.point.x,
      y: access.point.y,
      topology: this.topology,
    });
    const result = this.purchase.purchase(quote);
    if (result.ok === false) {
      throw new Error(`Flatbed purchase failed: ${result.blocker}`);
    }
    return result.trainId;
  }

  setRuntime(
    trainId: string,
    snapshot: Partial<TrainRuntimeSnapshot>,
  ): void {
    const current = this.runtimeByTrainId.get(trainId);
    if (!current) throw new Error(`Missing runtime train ${trainId}`);
    if (snapshot.trainId !== undefined && snapshot.trainId !== trainId) {
      throw new Error('Runtime snapshot train ID cannot change');
    }
    this.runtimeByTrainId.set(trainId, {
      ...current,
      ...clonePlainData(snapshot),
      trainId,
    });
  }

  runtimeSnapshot(trainId: string): TrainRuntimeSnapshot {
    const runtime = this.runtimeByTrainId.get(trainId);
    if (!runtime) throw new Error(`Missing runtime train ${trainId}`);
    return clonePlainData(runtime);
  }

  advanceTicks(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('Tick count must be a non-negative safe integer');
    }
    for (let tick = 0; tick < count; tick += 1) {
      const result = this.economy.update(
        ECONOMY_TICK_MS,
        true,
        [...this.runtimeByTrainId.values()],
      );
      if (result.ticksAdvanced !== 1) {
        throw new Error('Harness economy did not advance exactly one tick');
      }
    }
  }

  saveReload(): void {
    if (!WorldManager.save()) throw new Error('Harness save failed');
    const expected = this.world;
    const worldId = expected.id;
    WorldManager.reset();
    const reloaded = WorldManager.load(worldId);
    if (!reloaded) throw new Error('Harness reload failed');
    if (JSON.stringify(reloaded) !== JSON.stringify(expected)) {
      throw new Error('Reloaded authority differs from saved authority');
    }
    this.runtimeByTrainId.clear();
    reloaded.trains.forEach((train) => {
      this.runtimeByTrainId.set(
        train.id,
        runtimeFromTrain(reloaded, train),
      );
    });
  }

  destroy(): void {
    [...this.trackManager.getAllTracks()].forEach((track) => {
      this.trackManager.removeTrack(track.getUUID());
    });
    WorldManager.reset();
    localStorage.removeItem(GameConfig.WORLD.WORLDS_SAVE_KEY);
    localStorage.removeItem(GameConfig.SAVE_KEY);
  }
}

export const createFirstRouteHarness = (
  seed: string,
): FirstRouteHarness => new FirstRouteHarnessImpl(seed);
