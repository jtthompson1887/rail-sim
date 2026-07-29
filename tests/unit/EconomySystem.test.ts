/**
 * @jest-environment jsdom
 */

import type { WorldData } from '../../src/config/WorldData';
import { createCompanyState } from '../../src/economy/FinanceLedger';
import { summariseProfitAndLoss } from '../../src/economy/FinanceLedger';
import {
  EconomySystem,
  MAX_ECONOMY_TICKS_PER_FRAME,
} from '../../src/economy/EconomySystem';
import { advanceMarketTick } from '../../src/economy/MarketSystem';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
import { WorldManager } from '../../src/managers/WorldManager';
import type { OperationsDraft } from '../../src/managers/WorldManager';
import { clonePlainData } from '../../src/utils/PlainData';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

const stoppedRuntime = (
  trainId: string,
  overrides: Partial<TrainRuntimeSnapshot> = {},
): TrainRuntimeSnapshot => ({
  trainId,
  trackUUID: 'forest-sawmill-track',
  trackT: 0.1,
  facing: 1,
  x: -500,
  y: 0,
  speedWorldUnitsPerSecond: 0,
  throttle: 0,
  derailed: false,
  ...overrides,
});

const installFirstRoute = (): WorldData => {
  const world = WorldManager.createNew(
    'Orchestrated freight',
    'orchestrated-freight',
  );
  const fixture = makeFirstFreightRouteWorld();
  world.tracks = clonePlainData(fixture.tracks);
  world.economy = clonePlainData(fixture.economy);
  world.trains = clonePlainData(fixture.trains);
  world.freightProgress = clonePlainData(fixture.freightProgress);
  return world;
};

const installMineralDelivery = (
  productId: 'limestone-aggregate' | 'cement',
): {
  world: WorldData;
  destinationId: string;
  runtime: TrainRuntimeSnapshot[];
} => {
  const world = WorldManager.createNew(
    `Orchestrated ${productId}`,
    `orchestrated-${productId}`,
  );
  const fixture = makeFirstFreightRouteWorld();
  world.tracks = clonePlainData(fixture.tracks);
  const limestone = productId === 'limestone-aggregate';
  const destinationDefinitionId = limestone
    ? 'cement-works'
    : 'prefabrication-plant';
  const destination = world.economy.facilities.find(
    ({ definitionId }) => definitionId === destinationDefinitionId,
  );
  if (!destination) throw new Error(`Missing ${destinationDefinitionId}`);
  world.trains = [makeFreightTrainDef({
    id: `${productId}-train`,
    freightSetId: limestone
      ? 'aggregate-hopper-set'
      : 'covered-cement-set',
    cargo: {
      productId,
      units: 10,
      loadedUnits: limestone ? 120 : 80,
      originFacilityId: limestone ? 'quarry' : 'cement-works',
    },
    operations: {
      ...makeFreightTrainDef().operations,
      currentTripRevenue: 5_000,
      currentTripRunningCost: 1_000,
      lifetimeRevenue: 5_000,
      lifetimeRunningCost: 1_000,
    },
  })];
  return {
    world,
    destinationId: destination.id,
    runtime: [stoppedRuntime(`${productId}-train`, {
      x: destination.railAccess.x,
      y: destination.railAccess.y,
      trackT: 0.9,
    })],
  };
};

const facilitySnapshot = (world: WorldData, facilityId: string) =>
  clonePlainData(
    world.economy.facilities.find((facility) => facility.id === facilityId),
  );

const isDeepFrozen = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isDeepFrozen);
};

const updateInGroups = (groups: number[]) => {
  const system = new EconomySystem();
  const results = groups.map(
    (deltaMs) => system.update(deltaMs, true, []),
  );
  return {
    economy: clonePlainData(WorldManager.world!.economy),
    results,
  };
};

describe('EconomySystem', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    WorldManager.reset();
    localStorage.clear();
  });

  it('makes four 250 ms updates identical to one 1,000 ms update', () => {
    WorldManager.createNew('Split ticks', 'economy-tick-split');
    const split = updateInGroups([250, 250, 250, 250]);

    WorldManager.reset();
    WorldManager.createNew('Single tick', 'economy-tick-split');
    const single = updateInGroups([1_000]);

    expect(split.economy).toEqual(single.economy);
    expect(split.results.map((result) => result.ticksAdvanced))
      .toEqual([0, 0, 0, 1]);
    expect(single.results[0].ticksAdvanced).toBe(1);
  });

  it('does not accumulate or advance time outside operating play', () => {
    const world = WorldManager.createNew(
      'Stopped economy',
      'economy-tick-stopped',
    );
    const before = clonePlainData(world);
    const system = new EconomySystem();

    expect(system.update(8_000, false, [])).toEqual({
      ticksAdvanced: 0,
      changedFacilityIds: [],
      cargoStatuses: [],
      completedDeliveries: [],
      runningCostBlockerByTrainId: {},
      stopTrainIds: [],
      commitRejected: false,
      authoritativeChanged: false,
    });
    expect(world).toEqual(before);

    expect(system.update(999, true, []).ticksAdvanced).toBe(0);
    expect(world.economy.tick).toBe(0);
  });

  it('catches up at most four ticks per call and retains remaining backlog', () => {
    const world = WorldManager.createNew(
      'Catch-up economy',
      'economy-tick-catchup',
    );
    const system = new EconomySystem();

    const result = system.update(10_250, true, []);

    expect(result.ticksAdvanced).toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(world.economy.tick).toBe(4);
    expect(world.operationsRevision).toBe(4);

    expect(system.update(0, true, []).ticksAdvanced)
      .toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(world.economy.tick).toBe(8);
    expect(system.update(0, true, []).ticksAdvanced).toBe(2);
    expect(world.economy.tick).toBe(10);
    expect(system.update(749, true, []).ticksAdvanced).toBe(0);
    expect(system.update(1, true, []).ticksAdvanced).toBe(1);
    expect(world.economy.tick).toBe(11);
  });

  it('eventually matches ten regular ticks while every catch-up call stays bounded', () => {
    WorldManager.createNew(
      'Backlogged economy',
      'economy-tick-eventual-equivalence',
    );
    const backloggedSystem = new EconomySystem();
    const backloggedTicks = [
      backloggedSystem.update(10_000, true, []).ticksAdvanced,
      backloggedSystem.update(0, true, []).ticksAdvanced,
      backloggedSystem.update(0, true, []).ticksAdvanced,
    ];
    const backloggedEconomy = clonePlainData(
      WorldManager.world!.economy,
    );

    expect(backloggedTicks).toEqual([4, 4, 2]);
    expect(backloggedTicks.every(
      (ticks) => ticks <= MAX_ECONOMY_TICKS_PER_FRAME,
    )).toBe(true);

    WorldManager.reset();
    WorldManager.createNew(
      'Regular economy',
      'economy-tick-eventual-equivalence',
    );
    const regularSystem = new EconomySystem();
    const regularTicks = Array.from({ length: 10 }, () => (
      regularSystem.update(1_000, true, []).ticksAdvanced
    ));

    expect(regularTicks).toEqual(Array(10).fill(1));
    expect(WorldManager.world!.economy).toEqual(backloggedEconomy);
  });

  it('ignores invalid deltas but allows zero to drain operating backlog', () => {
    const world = WorldManager.createNew(
      'Validated delta economy',
      'economy-tick-validated-delta',
    );
    const system = new EconomySystem();

    expect(system.update(5_000, true, []).ticksAdvanced).toBe(4);
    expect(system.update(-1, true, []).ticksAdvanced).toBe(0);
    expect(system.update(Number.NaN, true, []).ticksAdvanced).toBe(0);
    expect(system.update(Number.POSITIVE_INFINITY, true, []).ticksAdvanced)
      .toBe(0);
    expect(world.economy.tick).toBe(4);

    expect(system.update(0, false, []).ticksAdvanced).toBe(0);
    expect(system.update(0, true, []).ticksAdvanced).toBe(1);
    expect(world.economy.tick).toBe(5);
  });

  it('advances root and economy revisions once per committed tick only', () => {
    const world = WorldManager.createNew(
      'Revision economy',
      'economy-tick-revisions',
    );
    const constructionRevision = world.constructionRevision;
    const system = new EconomySystem();

    const result = system.update(3_000, true, []);

    expect(result.ticksAdvanced).toBe(3);
    expect(world.economy.tick).toBe(3);
    expect(world.revision).toBe(3);
    expect(world.operationsRevision).toBe(3);
    expect(world.constructionRevision).toBe(constructionRevision);
  });

  it('advances facilities in stable id order and returns their sorted changed union', () => {
    const world = WorldManager.createNew(
      'Ordered economy',
      'economy-tick-order',
    );
    world.economy.facilities.reverse();
    const system = new EconomySystem();

    const result = system.update(1_000, true, []);

    expect(result.changedFacilityIds).toEqual([
      'managed-forest',
      'quarry',
    ]);
  });

  it('advances the market using the newly committed tick', () => {
    const world = WorldManager.createNew(
      'Market cadence',
      'economy-tick-market',
    );
    world.economy.tick = 23;
    const initialMarket = clonePlainData(world.economy.market);
    const expectedMarket = advanceMarketTick(
      initialMarket,
      world.generationConfig.seed,
      24,
    );

    const result = new EconomySystem().update(1_000, true, []);

    expect(result.ticksAdvanced).toBe(1);
    expect(world.economy.tick).toBe(24);
    expect(world.economy.market).toEqual(expectedMarket);
  });

  it('increments before ledgers, transfers cargo before recipes, then charges later active trips', () => {
    const world = installFirstRoute();
    const train = world.trains[0];
    train.cargo = {
      productId: 'logs',
      units: 10,
      loadedUnits: 60,
      originFacilityId: 'managed-forest',
    };
    train.operations.currentTripRevenue = 5_000;
    train.operations.currentTripRunningCost = 40;
    train.operations.lifetimeDeliveredUnits = 50;
    train.operations.lifetimeRevenue = 5_000;
    train.operations.lifetimeRunningCost = 40;
    const sawmill = world.economy.facilities.find(
      ({ id }) => id === 'sawmill',
    )!;
    sawmill.recipeProgressTicks = 2;
    const initialMarket = clonePlainData(world.economy.market);
    const system = new EconomySystem();

    const delivery = system.update(1_000, true, [
      stoppedRuntime(train.id, {
        trackT: 0.9,
        facing: -1,
        x: 500,
      }),
    ]);

    expect(delivery.ticksAdvanced).toBe(1);
    expect(delivery.authoritativeChanged).toBe(true);
    expect(delivery.commitRejected).toBe(false);
    expect(delivery.completedDeliveries).toEqual([expect.objectContaining({
      trainId: train.id,
      productId: 'logs',
      units: 60,
      destinationFacilityId: 'sawmill',
      tick: 1,
      runningCost: 40,
    })]);
    expect(delivery.completedDeliveries[0].revenue).toBeGreaterThan(5_000);
    expect(delivery.completedDeliveries[0].operatingProfit).toBe(
      delivery.completedDeliveries[0].revenue - 40,
    );
    expect(world.company.ledger.filter(
      ({ category }) => category === 'train-running-cost',
    )).toEqual([]);
    expect(world.company.ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({
      category: 'delivery-revenue',
      tick: 1,
      }),
      expect.objectContaining({
        category: 'contract-bonus',
        ledgerClass: 'revenue',
        amount: 250_000,
        tick: 1,
        referenceId: 'regional-development-grant:v1',
      }),
    ]));
    expect(world.freightProgress).toEqual({
      progressVersion: 1,
      profitableLogDeliveryCompleted: true,
      developmentGrantAwarded: true,
      profitableStructuralTimberDeliveryCompleted: false,
      profitableLimestoneDeliveryCompleted: false,
      profitableCementDeliveryCompleted: false,
    });
    const committedSawmill = world.economy.facilities.find(
      ({ id }) => id === 'sawmill',
    )!;
    expect(committedSawmill.inventories.logs.quantity).toBe(0);
    expect(committedSawmill.inventories['structural-timber'].quantity)
      .toBe(8);
    expect(committedSawmill.recipeProgressTicks).toBe(0);
    expect(world.economy.market).toEqual(advanceMarketTick(
      initialMarket,
      world.generationConfig.seed,
      1,
    ));
    expect(world.trains[0]).toMatchObject({
      trackUUID: 'forest-sawmill-track',
      trackT: 0.9,
      facing: -1,
      cargo: null,
      operations: {
        currentTripRevenue: 0,
        currentTripRunningCost: 0,
        lastTripRunningCost: 40,
      },
    });

    const active = system.update(1_000, true, [
      stoppedRuntime(train.id, {
        trackT: 0.5,
        x: 0,
        throttle: 1,
      }),
    ]);

    expect(active.completedDeliveries).toEqual([]);
    expect(world.company.ledger.at(-1)).toEqual(expect.objectContaining({
      category: 'train-running-cost',
      tick: 2,
      amount: -20,
    }));
    expect(world.trains[0].operations.currentTripRunningCost).toBe(20);
    expect(world.trains[0].operations.lifetimeRunningCost).toBe(60);
  });

  it('commits and retains a profitable mineral completion across catch-up ticks', () => {
    const {
      world,
      destinationId,
      runtime,
    } = installMineralDelivery('limestone-aggregate');
    const beforeCash = world.company.cash;

    const result = new EconomySystem().update(4_000, true, runtime);

    expect(result.ticksAdvanced).toBe(4);
    expect(result.commitRejected).toBe(false);
    expect(result.completedDeliveries).toEqual([
      expect.objectContaining({
        trainId: 'limestone-aggregate-train',
        productId: 'limestone-aggregate',
        units: 120,
        destinationFacilityId: destinationId,
        tick: 1,
        runningCost: 1_000,
      }),
    ]);
    expect(result.completedDeliveries[0].operatingProfit).toBeGreaterThan(0);
    expect(world.freightProgress).toEqual({
      progressVersion: 1,
      profitableLogDeliveryCompleted: false,
      developmentGrantAwarded: false,
      profitableStructuralTimberDeliveryCompleted: false,
      profitableLimestoneDeliveryCompleted: true,
      profitableCementDeliveryCompleted: false,
    });
    expect(world.trains[0]).toMatchObject({
      cargo: null,
      operations: {
        currentTripRevenue: 0,
        currentTripRunningCost: 0,
        lastTripRunningCost: 1_000,
      },
    });
    const deliveryEntries = world.company.ledger.filter(
      ({ category }) => category === 'delivery-revenue',
    );
    expect(deliveryEntries).toHaveLength(1);
    expect(world.company.cash).toBe(
      beforeCash + deliveryEntries[0].amount,
    );
    expect(world.company.ledger.filter(
      ({ category }) => category === 'train-running-cost',
    )).toEqual([]);
    expect(world.economy.tick).toBe(4);
    expect(world.operationsRevision).toBe(4);
  });

  it('labels 24 active-tick costs 1 through 24 in the inclusive P&L window', () => {
    const world = installFirstRoute();
    const runtime = [
      stoppedRuntime(world.trains[0].id, {
        trackT: 0.5,
        x: 0,
        throttle: 1,
      }),
    ];
    const system = new EconomySystem();

    const ticks = Array.from(
      { length: 6 },
      () => system.update(4_000, true, runtime).ticksAdvanced,
    );

    const costs = world.company.ledger.filter(
      ({ category }) => category === 'train-running-cost',
    );
    expect(ticks).toEqual([4, 4, 4, 4, 4, 4]);
    expect(costs.map(({ tick }) => tick)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
    expect(summariseProfitAndLoss(world.company, 1, 24)).toMatchObject({
      operatingExpenses: 480,
      railwayOperatingProfit: -480,
      cashFlow: -480,
    });
    expect(world.revision).toBe(24);
    expect(world.operationsRevision).toBe(24);
  });

  it('commits four of five catch-up ticks, transfers once per tick, and retains the fifth', () => {
    const world = installFirstRoute();
    const runtime = [stoppedRuntime(world.trains[0].id)];
    const system = new EconomySystem();

    const first = system.update(5_000, true, runtime);

    expect(first.ticksAdvanced).toBe(4);
    expect(first.cargoStatuses).toEqual([expect.objectContaining({
      trainId: world.trains[0].id,
      kind: 'loading',
      batchUnits: 10,
      cargoUnits: 40,
    })]);
    expect(world.trains[0].cargo?.units).toBe(40);
    expect(world.revision).toBe(4);
    expect(world.operationsRevision).toBe(4);

    const second = system.update(0, true, runtime);

    expect(second.ticksAdvanced).toBe(1);
    expect(world.economy.tick).toBe(5);
    expect(world.trains[0].cargo?.units).toBe(50);
    expect(world.revision).toBe(5);
    expect(world.operationsRevision).toBe(5);
  });

  it('retains early catch-up deliveries and non-null running-cost blockers', () => {
    const deliveryWorld = installFirstRoute();
    deliveryWorld.trains[0].cargo = {
      productId: 'logs',
      units: 10,
      loadedUnits: 10,
      originFacilityId: 'managed-forest',
    };
    const deliveryResult = new EconomySystem().update(4_000, true, [
      stoppedRuntime(deliveryWorld.trains[0].id, {
        trackT: 0.9,
        x: 500,
      }),
    ]);

    expect(deliveryResult.completedDeliveries).toHaveLength(1);
    expect(deliveryResult.completedDeliveries[0].tick).toBe(1);
    expect(deliveryResult.ticksAdvanced).toBe(4);

    WorldManager.reset();
    const blockedWorld = installFirstRoute();
    blockedWorld.company = createCompanyState(10);
    const trainId = blockedWorld.trains[0].id;
    const blockedResult = new EconomySystem().update(4_000, true, [
      stoppedRuntime(trainId, {
        trackT: 0.5,
        x: 0,
        throttle: 1,
      }),
    ]);

    expect(blockedResult.ticksAdvanced).toBe(4);
    expect(blockedResult.runningCostBlockerByTrainId).toEqual({
      [trainId]: 'insufficient-running-cash',
    });
    expect(blockedResult.stopTrainIds).toEqual([trainId]);
    expect(blockedWorld.company.ledger).toHaveLength(1);
  });

  it('retains a rejected cargo tick without exposing its events or duplicating its retry', () => {
    const world = installFirstRoute();
    world.trains[0].cargo = {
      productId: 'logs',
      units: 10,
      loadedUnits: 10,
      originFacilityId: 'managed-forest',
    };
    const runtime = [stoppedRuntime(world.trains[0].id, {
      trackT: 0.9,
      facing: -1,
      x: 500,
    })];
    const before = clonePlainData(world);
    let rejectNext = true;
    const rejectingPort = {
      get world(): WorldData {
        return world;
      },
      applyOperationsBatch(
        expectedRevision: number,
        mutate: (draft: OperationsDraft) => boolean,
      ): boolean {
        if (rejectNext) {
          rejectNext = false;
          const detachedDraft: OperationsDraft = clonePlainData({
            company: world.company,
            economy: world.economy,
            trains: world.trains,
            freightProgress: world.freightProgress,
          });
          expect(mutate(detachedDraft)).toBe(true);
          expect(detachedDraft.trains[0].cargo).toBeNull();
          expect(detachedDraft.company.cash).toBeGreaterThan(
            world.company.cash,
          );
          return false;
        }
        return WorldManager.applyOperationsBatch(
          expectedRevision,
          mutate,
        );
      },
    };
    const system = new EconomySystem(rejectingPort);

    expect(system.update(1_000, true, runtime)).toEqual({
      ticksAdvanced: 0,
      changedFacilityIds: [],
      cargoStatuses: [],
      completedDeliveries: [],
      runningCostBlockerByTrainId: {},
      stopTrainIds: [],
      commitRejected: true,
      authoritativeChanged: false,
    });
    expect(world).toEqual(before);

    const retry = system.update(0, true, runtime);

    expect(retry.ticksAdvanced).toBe(1);
    expect(retry.commitRejected).toBe(false);
    expect(retry.cargoStatuses).toEqual([expect.objectContaining({
      trainId: world.trains[0].id,
      facilityId: 'sawmill',
      productId: 'logs',
      kind: 'unloading',
      batchUnits: 10,
    })]);
    expect(retry.completedDeliveries).toEqual([expect.objectContaining({
      trainId: world.trains[0].id,
      productId: 'logs',
      units: 10,
      destinationFacilityId: 'sawmill',
    })]);
    expect(isDeepFrozen(retry)).toBe(true);
    expect(world.trains[0].cargo).toBeNull();
    expect(world.economy.tick).toBe(1);
    expect(world.operationsRevision).toBe(1);
  });

  it('rejects a mineral latch atomically and commits it exactly once on retry', () => {
    const { world, runtime } = installMineralDelivery('cement');
    const before = clonePlainData(world);
    let rejectNext = true;
    const rejectingPort = {
      get world(): WorldData {
        return world;
      },
      applyOperationsBatch(
        expectedRevision: number,
        mutate: (draft: OperationsDraft) => boolean,
      ): boolean {
        if (rejectNext) {
          rejectNext = false;
          const detachedDraft: OperationsDraft = clonePlainData({
            company: world.company,
            economy: world.economy,
            trains: world.trains,
            freightProgress: world.freightProgress,
          });
          expect(mutate(detachedDraft)).toBe(true);
          expect(
            detachedDraft.freightProgress.profitableCementDeliveryCompleted,
          ).toBe(true);
          expect(detachedDraft.trains[0].cargo).toBeNull();
          return false;
        }
        return WorldManager.applyOperationsBatch(expectedRevision, mutate);
      },
    };
    const system = new EconomySystem(rejectingPort);

    expect(system.update(1_000, true, runtime)).toEqual({
      ticksAdvanced: 0,
      changedFacilityIds: [],
      cargoStatuses: [],
      completedDeliveries: [],
      runningCostBlockerByTrainId: {},
      stopTrainIds: [],
      commitRejected: true,
      authoritativeChanged: false,
    });
    expect(world).toEqual(before);

    const retry = system.update(0, true, runtime);

    expect(retry.ticksAdvanced).toBe(1);
    expect(retry.commitRejected).toBe(false);
    expect(retry.completedDeliveries).toEqual([
      expect.objectContaining({
        productId: 'cement',
        units: 80,
      }),
    ]);
    expect(world.freightProgress.profitableCementDeliveryCompleted).toBe(true);
    expect(world.company.ledger.filter(
      ({ category }) => category === 'delivery-revenue',
    )).toHaveLength(1);
    expect(world.trains[0].cargo).toBeNull();
    expect(world.operationsRevision).toBe(1);
  });

  it('keeps all facility, market, tick, and revision state atomic when the cursor loses', () => {
    const world = WorldManager.createNew(
      'Rejected economy',
      'economy-tick-rejected',
    );
    const before = clonePlainData(world);
    const rejectingPort = {
      get world(): WorldData {
        return world;
      },
      applyOperationsBatch(
        _expectedRevision: number,
        mutate: (draft: OperationsDraft) => boolean,
      ): boolean {
        const detachedDraft: OperationsDraft = clonePlainData({
          company: world.company,
          economy: world.economy,
          trains: world.trains,
          freightProgress: world.freightProgress,
        });
        expect(mutate(detachedDraft)).toBe(true);
        expect(detachedDraft.economy).not.toEqual(world.economy);
        return false;
      },
    };

    const result = new EconomySystem(rejectingPort).update(
      1_000,
      true,
      [],
    );

    expect(result).toEqual({
      ticksAdvanced: 0,
      changedFacilityIds: [],
      cargoStatuses: [],
      completedDeliveries: [],
      runningCostBlockerByTrainId: {},
      stopTrainIds: [],
      commitRejected: true,
      authoritativeChanged: false,
    });
    expect(world).toEqual(before);
  });

  it('reports a saturated economy tick as a rejected atomic commit', () => {
    const world = WorldManager.createNew(
      'Saturated economy',
      'economy-tick-saturated',
    );
    world.economy.tick = Number.MAX_SAFE_INTEGER;
    const before = clonePlainData(world);

    const result = new EconomySystem().update(1_000, true, []);

    expect(result).toEqual({
      ticksAdvanced: 0,
      changedFacilityIds: [],
      cargoStatuses: [],
      completedDeliveries: [],
      runningCostBlockerByTrainId: {},
      stopTrainIds: [],
      commitRejected: true,
      authoritativeChanged: false,
    });
    expect(world).toEqual(before);
  });

  it('retains a large frame backlog until four ticks actually commit', () => {
    const world = WorldManager.createNew(
      'Retried backlog',
      'economy-tick-retried-backlog',
    );
    let batchAttempt = 0;
    const intermittentlyRejectingPort = {
      get world(): WorldData {
        return world;
      },
      applyOperationsBatch(
        expectedRevision: number,
        mutate: (draft: OperationsDraft) => boolean,
      ): boolean {
        batchAttempt += 1;
        if (batchAttempt === 1 || batchAttempt === 3) {
          const detachedDraft: OperationsDraft = clonePlainData({
            company: world.company,
            economy: world.economy,
            trains: world.trains,
            freightProgress: world.freightProgress,
          });
          expect(mutate(detachedDraft)).toBe(true);
          return false;
        }
        return WorldManager.applyOperationsBatch(
          expectedRevision,
          mutate,
        );
      },
    };
    const system = new EconomySystem(intermittentlyRejectingPort);

    expect(system.update(10_250, true, []).ticksAdvanced).toBe(0);
    expect(system.update(1, true, [])).toMatchObject({
      ticksAdvanced: 1,
      commitRejected: true,
    });

    expect(system.update(1, true, []).ticksAdvanced)
      .toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(world.economy.tick).toBe(5);
  });

  it('keeps accumulator arithmetic finite across extreme frame deltas', () => {
    const world = WorldManager.createNew(
      'Finite backlog',
      'economy-tick-finite-backlog',
    );
    let rejectNext = true;
    const rejectOncePort = {
      get world(): WorldData {
        return world;
      },
      applyOperationsBatch(
        expectedRevision: number,
        mutate: (draft: OperationsDraft) => boolean,
      ): boolean {
        if (rejectNext) {
          rejectNext = false;
          const detachedDraft: OperationsDraft = clonePlainData({
            company: world.company,
            economy: world.economy,
            trains: world.trains,
            freightProgress: world.freightProgress,
          });
          expect(mutate(detachedDraft)).toBe(true);
          return false;
        }
        return WorldManager.applyOperationsBatch(
          expectedRevision,
          mutate,
        );
      },
    };
    const system = new EconomySystem(rejectOncePort);

    expect(system.update(Number.MAX_VALUE, true, []).ticksAdvanced).toBe(0);
    expect(system.update(Number.MAX_VALUE, true, []).ticksAdvanced)
      .toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(system.update(0, true, []).ticksAdvanced)
      .toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(world.economy.tick).toBe(8);
  });

  it('produces identical industry and market state for equivalent elapsed ticks', () => {
    WorldManager.createNew('Chunked economy', 'economy-tick-equivalent');
    const chunked = updateInGroups([1_500, 500, 2_000]).economy;

    WorldManager.reset();
    WorldManager.createNew('Batched economy', 'economy-tick-equivalent');
    const batched = updateInGroups([4_000]).economy;

    expect(chunked).toEqual(batched);
    expect(facilitySnapshot(
      { ...WorldManager.world!, economy: chunked },
      'managed-forest',
    )).toEqual(facilitySnapshot(WorldManager.world!, 'managed-forest'));
  });
});
