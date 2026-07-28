/**
 * @jest-environment jsdom
 */

import {
  createFirstRouteHarness,
  installFirstFreightRoutePhase,
  type FirstRouteHarness,
} from '../fixtures/FirstFreightRouteFixture';
import type { WorldData } from '../../src/config/WorldData';
import type Train from '../../src/entities/Train';
import {
  FreightPurchaseService,
  type FreightPurchaseQuoteInput,
  type FreightPurchaseRuntimePort,
} from '../../src/freight/FreightPurchaseService';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
import type { TrackTopologySnapshot } from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { SaveService } from '../../src/services/SaveService';
import {
  ECONOMY_TICK_MS,
  EconomySystem,
} from '../../src/economy/EconomySystem';
import {
  getFacilityDefinition,
  getRecipe,
} from '../../src/economy/ProductCatalog';
import { clonePlainData } from '../../src/utils/PlainData';
import {
  countForwardRegionalDevelopmentGrants,
} from '../../src/freight/FreightProgress';

const facility = (
  harness: FirstRouteHarness,
  definitionId: string,
) => {
  const result = harness.world.economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!result) throw new Error(`Missing ${definitionId} fixture facility`);
  return result;
};

const train = (harness: FirstRouteHarness, trainId: string) => {
  const result = harness.world.trains.find(({ id }) => id === trainId);
  if (!result) throw new Error(`Missing ${trainId} fixture train`);
  return result;
};

const categoryTotal = (
  harness: FirstRouteHarness,
  category: string,
): number => harness.world.company.ledger
  .filter((entry) => entry.category === category)
  .reduce((total, entry) => total + Math.abs(entry.amount), 0);

const pointOnTrack = (
  track: WorldData['tracks'][number],
  t: number,
): { x: number; y: number } => {
  const inverse = 1 - t;
  return {
    x: track.p0.x * inverse ** 3
      + 3 * track.p1.x * inverse ** 2 * t
      + 3 * track.p2.x * inverse * t ** 2
      + track.p3.x * t ** 3,
    y: track.p0.y * inverse ** 3
      + 3 * track.p1.y * inverse ** 2 * t
      + 3 * track.p2.y * inverse * t ** 2
      + track.p3.y * t ** 3,
  };
};

const accessRuntime = (
  harness: FirstRouteHarness,
  definitionId: 'managed-forest' | 'sawmill',
): Partial<TrainRuntimeSnapshot> => {
  const world = harness.world;
  const access = facility(harness, definitionId).railAccess;
  const endpoint = world.tracks.flatMap((track) => [
    { track, trackT: 0, point: track.p0 },
    { track, trackT: 1, point: track.p3 },
  ]).sort((left, right) => (
    Math.hypot(left.point.x - access.x, left.point.y - access.y)
    - Math.hypot(right.point.x - access.x, right.point.y - access.y)
  ))[0];
  if (!endpoint) throw new Error(`No route endpoint for ${definitionId}`);
  return {
    trackUUID: endpoint.track.uuid,
    trackT: endpoint.trackT,
    x: endpoint.point.x,
    y: endpoint.point.y,
    speedWorldUnitsPerSecond: 0,
    throttle: 0,
    derailed: false,
  };
};

const midpointRuntime = (
  harness: FirstRouteHarness,
): Partial<TrainRuntimeSnapshot> => {
  const track = harness.world.tracks[0];
  if (!track) throw new Error('No route track for midpoint');
  return {
    trackUUID: track.uuid,
    trackT: 0.5,
    ...pointOnTrack(track, 0.5),
    speedWorldUnitsPerSecond: 12,
    throttle: 1,
    derailed: false,
  };
};

const phaseSnapshot = (
  harness: FirstRouteHarness,
  trainId: string,
) => {
  const world = harness.world;
  const authoritativeTrain = train(harness, trainId);
  return clonePlainData({
    cargo: authoritativeTrain.cargo,
    operations: authoritativeTrain.operations,
    economyTick: world.economy.tick,
    cash: world.company.cash,
    ledger: world.company.ledger,
    facilities: world.economy.facilities,
    trackUUID: authoritativeTrain.trackUUID,
    trackT: authoritativeTrain.trackT,
    facing: authoritativeTrain.facing,
    progress: world.freightProgress,
  });
};

const routeTopology = (world: WorldData): TrackTopologySnapshot => (
  [...world.tracks]
    .sort((left, right) => left.uuid.localeCompare(right.uuid))
    .map((track, index, tracks) => ({
      kind: 'track' as const,
      uuid: track.uuid,
      previous: index === 0
        ? null
        : { kind: 'track' as const, uuid: tracks[index - 1].uuid },
      next: index === tracks.length - 1
        ? null
        : { kind: 'track' as const, uuid: tracks[index + 1].uuid },
    }))
);

const purchaseInput = (
  harness: FirstRouteHarness,
): FreightPurchaseQuoteInput => {
  const world = harness.world;
  const forest = facility(harness, 'managed-forest');
  const access = world.tracks.flatMap((track) => [
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
  ))[0];
  if (!access) throw new Error('No forest endpoint for purchase');
  return {
    freightSetId: 'flatbed-freight-set',
    trackUUID: access.track.uuid,
    trackT: access.trackT,
    x: access.point.x,
    y: access.point.y,
    topology: routeTopology(world),
  };
};

interface PurchaseRuntimeProbe {
  readonly port: FreightPurchaseRuntimePort;
  readonly spawnCalls: Array<{
    trainId: string;
    freightSetId: string;
  }>;
  readonly placeCalls: Array<{
    trainId: string;
    trackUUID: string;
    trackT: number;
    facing: 1 | -1;
  }>;
  readonly removeCalls: string[];
  readonly liveIds: Set<string>;
}

const purchaseRuntime = (
  overrides: Partial<FreightPurchaseRuntimePort> = {},
): PurchaseRuntimeProbe => {
  const spawnCalls: PurchaseRuntimeProbe['spawnCalls'] = [];
  const placeCalls: PurchaseRuntimeProbe['placeCalls'] = [];
  const removeCalls: string[] = [];
  const liveIds = new Set<string>();
  const port: FreightPurchaseRuntimePort = {
    spawn: (trainId, freightSetId) => {
      spawnCalls.push({ trainId, freightSetId });
      const spawned = overrides.spawn
        ? overrides.spawn(trainId, freightSetId)
        : ({
          getUUID: () => trainId,
        } as unknown as Train);
      if (spawned) liveIds.add(trainId);
      return spawned;
    },
    place: (runtimeTrain, trackUUID, trackT, facing) => {
      placeCalls.push({
        trainId: runtimeTrain.getUUID(),
        trackUUID,
        trackT,
        facing,
      });
      return overrides.place
        ? overrides.place(runtimeTrain, trackUUID, trackT, facing)
        : true;
    },
    remove: (trainId) => {
      removeCalls.push(trainId);
      liveIds.delete(trainId);
      overrides.remove?.(trainId);
    },
  };
  return {
    port,
    spawnCalls,
    placeCalls,
    removeCalls,
    liveIds,
  };
};

const fixedRuntime = (
  overrides: Partial<TrainRuntimeSnapshot> = {},
): TrainRuntimeSnapshot => ({
  trainId: 'train-1',
  trackUUID: 'forest-sawmill-track',
  trackT: 0.5,
  facing: 1,
  x: 0,
  y: 0,
  speedWorldUnitsPerSecond: 0,
  throttle: 0,
  derailed: false,
  ...overrides,
});

describe('Integration: first profitable timber freight route', () => {
  let harness: FirstRouteHarness;

  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
    harness = createFirstRouteHarness('task-13-complete-route');
  });

  afterEach(() => {
    harness.destroy();
    jest.restoreAllMocks();
  });

  it('builds, buys, loads, moves, unloads, processes, and reconciles one real route', () => {
    const opening = harness.world;
    const openingCash = opening.company.cash;
    const initialLogs = facility(harness, 'managed-forest')
      .inventories.logs.quantity;
    const initialSawmill = facility(harness, 'sawmill');
    const sawmillDefinition = getFacilityDefinition(
      initialSawmill.definitionId,
    );
    if (!sawmillDefinition) throw new Error('Missing Sawmill definition');
    const activeRecipeId = initialSawmill.activeRecipeId;
    if (!activeRecipeId) throw new Error('Missing active Sawmill recipe');
    const activeRecipe = getRecipe(activeRecipeId);
    if (!activeRecipe) throw new Error('Missing active recipe definition');

    expect(sawmillDefinition).toEqual(expect.objectContaining({
      id: 'sawmill',
      recipeIds: ['sawmill-cut'],
    }));
    expect(activeRecipeId).toBe('sawmill-cut');
    expect(activeRecipe).toEqual({
      id: 'sawmill-cut',
      kind: 'processing',
      cycleTicks: 3,
      inputs: [{ productId: 'logs', quantity: 10 }],
      outputs: [{ productId: 'structural-timber', quantity: 8 }],
    });

    expect(opening.schemaVersion).toBe(9);
    expect(opening.tracks).toEqual([]);
    expect(opening.junctions).toEqual([]);
    expect(opening.stations).toEqual([]);
    expect(opening.trains).toEqual([]);

    harness.buildConnectedRoute();

    const built = harness.world;
    const constructionEntries = built.company.ledger.filter(
      ({ category }) => category === 'construction-capex',
    );
    expect(constructionEntries).toHaveLength(built.tracks.length);
    expect(built.company.cash).toBeGreaterThanOrEqual(110_000);

    const constructionCapex = categoryTotal(
      harness,
      'construction-capex',
    );
    const trainId = harness.purchaseTimberSet();
    expect(harness.world.trains).toHaveLength(1);
    expect(categoryTotal(harness, 'vehicle-capex')).toBe(90_000);
    expect(harness.world.company.cash).toBeGreaterThanOrEqual(110_000);

    harness.advanceTicks(6);
    expect(train(harness, trainId).cargo).toEqual({
      productId: 'logs',
      units: 60,
      loadedUnits: 60,
      originFacilityId: facility(harness, 'managed-forest').id,
    });

    const outside = { x: 0, y: 0 };
    harness.setRuntime(trainId, outside);
    const cargoBeforeOutside = train(harness, trainId).cargo;
    harness.advanceTicks(1);
    expect(train(harness, trainId).cargo).toEqual(cargoBeforeOutside);

    harness.setRuntime(trainId, {
      ...outside,
      speedWorldUnitsPerSecond: 12,
      throttle: 1,
    });
    harness.advanceTicks(1);
    expect(train(harness, trainId).cargo?.units).toBe(60);

    harness.setRuntime(trainId, {
      ...accessRuntime(harness, 'sawmill'),
    });
    const beforeProcessing = clonePlainData(
      facility(harness, 'sawmill'),
    );
    const deliveryStartTick = harness.world.economy.tick;
    const processingEvidence: Array<{
      tick: number;
      deliveredUnits: number;
      progressBefore: number;
      progressAfter: number;
    }> = [];
    for (let deliveryTick = 0; deliveryTick < 6; deliveryTick += 1) {
      const cargoBefore = train(harness, trainId).cargo?.units ?? 0;
      const progressBefore = facility(harness, 'sawmill')
        .recipeProgressTicks;
      harness.advanceTicks(1);
      const cargoAfter = train(harness, trainId).cargo?.units ?? 0;
      processingEvidence.push({
        tick: harness.world.economy.tick,
        deliveredUnits: cargoBefore - cargoAfter,
        progressBefore,
        progressAfter: facility(harness, 'sawmill').recipeProgressTicks,
      });
    }

    const completed = harness.world;
    const completedTrain = train(harness, trainId);
    const completedForest = facility(harness, 'managed-forest');
    const completedSawmill = facility(harness, 'sawmill');
    const deliveryRevenue = categoryTotal(harness, 'delivery-revenue');
    const contractBonuses = categoryTotal(harness, 'contract-bonus');
    const runningCost = categoryTotal(harness, 'train-running-cost');
    const vehicleCapex = categoryTotal(harness, 'vehicle-capex');
    const forestProduction = completedForest.inventories.logs.recentInflow;
    const consumedLogs = completedSawmill.inventories.logs.recentOutflow;
    const deliveredLogs = processingEvidence.reduce(
      (total, evidence) => total + evidence.deliveredUnits,
      0,
    );
    const completedRecipeCycles = processingEvidence.filter(
      (evidence) => evidence.deliveredUnits > 0
        && evidence.progressBefore === activeRecipe.cycleTicks - 1
        && evidence.progressAfter === 0,
    ).length;
    const recipeInput = activeRecipe.inputs[0];
    const recipeOutput = activeRecipe.outputs[0];
    if (!recipeInput || !recipeOutput) {
      throw new Error('Incomplete active Sawmill recipe');
    }

    expect(completedTrain.cargo).toBeNull();
    expect(completedTrain.operations.lastTripRevenue)
      .toBeGreaterThan(completedTrain.operations.lastTripRunningCost);
    expect(completed.freightProgress.profitableLogDeliveryCompleted)
      .toBe(true);
    expect(completed.freightProgress.developmentGrantAwarded).toBe(true);
    expect(completed.company.ledger.filter(
      ({ category }) => category === 'contract-bonus',
    )).toEqual([
      expect.objectContaining({
        ledgerClass: 'revenue',
        amount: 250_000,
        referenceId: 'regional-development-grant:v1',
      }),
    ]);
    expect(contractBonuses).toBe(250_000);
    expect(processingEvidence.map(
      ({ tick }) => tick - deliveryStartTick,
    )).toEqual([1, 2, 3, 4, 5, 6]);
    expect(processingEvidence.map(
      ({ deliveredUnits }) => deliveredUnits,
    )).toEqual([10, 10, 10, 10, 10, 10]);
    expect(processingEvidence.map(
      ({ progressBefore, progressAfter }) => [
        progressBefore,
        progressAfter,
      ],
    )).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
    expect(deliveredLogs).toBe(60);
    expect(completedRecipeCycles).toBe(2);
    expect(completedSawmill.inventories.logs).toEqual(expect.objectContaining({
      quantity: beforeProcessing.inventories.logs.quantity
        + deliveredLogs
        - recipeInput.quantity * completedRecipeCycles,
      recentInflow: beforeProcessing.inventories.logs.recentInflow
        + deliveredLogs,
      recentOutflow: beforeProcessing.inventories.logs.recentOutflow
        + recipeInput.quantity * completedRecipeCycles,
    }));
    expect(completedSawmill.inventories['structural-timber'])
      .toEqual(expect.objectContaining({
        quantity: beforeProcessing.inventories['structural-timber'].quantity
          + recipeOutput.quantity * completedRecipeCycles,
        recentInflow: beforeProcessing
          .inventories['structural-timber'].recentInflow
          + recipeOutput.quantity * completedRecipeCycles,
        recentOutflow: beforeProcessing
          .inventories['structural-timber'].recentOutflow,
      }));
    expect(completedSawmill.recipeProgressTicks).toBe(0);
    expect(
      initialLogs + forestProduction,
    ).toBe(
      completedForest.inventories.logs.quantity
      + (completedTrain.cargo?.units ?? 0)
      + completedSawmill.inventories.logs.quantity
      + consumedLogs,
    );
    expect(completed.company.cash).toBe(
      openingCash
      - constructionCapex
      - vehicleCapex
      - runningCost
      + deliveryRevenue
      + contractBonuses,
    );
  });

  it('round-trips every authoritative phase and rebuilds stopped runtime from TrainDefs', () => {
    harness.buildConnectedRoute();
    const trainId = harness.purchaseTimberSet();

    harness.advanceTicks(3);
    expect(train(harness, trainId).cargo?.units).toBe(30);
    let expected = phaseSnapshot(harness, trainId);
    harness.saveReload();
    expect(phaseSnapshot(harness, trainId)).toEqual(expected);

    harness.advanceTicks(3);
    expect(train(harness, trainId).cargo?.units).toBe(60);
    harness.setRuntime(trainId, midpointRuntime(harness));
    harness.advanceTicks(1);
    expect(harness.runtimeSnapshot(trainId)).toEqual(expect.objectContaining({
      speedWorldUnitsPerSecond: 12,
      throttle: 1,
    }));
    expected = phaseSnapshot(harness, trainId);
    expect(expected.trackT).toBe(0.5);
    expect(expected.operations.currentTripRunningCost).toBe(20);
    harness.saveReload();
    expect(phaseSnapshot(harness, trainId)).toEqual(expected);
    expect(harness.runtimeSnapshot(trainId)).toEqual(expect.objectContaining({
      trackUUID: expected.trackUUID,
      trackT: expected.trackT,
      facing: expected.facing,
      speedWorldUnitsPerSecond: 0,
      throttle: 0,
      derailed: false,
    }));
    harness.advanceTicks(1);
    expect(train(harness, trainId).cargo?.units).toBe(60);
    expect(train(harness, trainId).operations.currentTripRunningCost).toBe(20);

    harness.setRuntime(trainId, accessRuntime(harness, 'sawmill'));
    harness.advanceTicks(3);
    expect(train(harness, trainId).cargo?.units).toBe(30);
    expected = phaseSnapshot(harness, trainId);
    harness.saveReload();
    expect(phaseSnapshot(harness, trainId)).toEqual(expected);

    harness.advanceTicks(3);
    expect(train(harness, trainId).cargo).toBeNull();
    expect(harness.world.freightProgress.profitableLogDeliveryCompleted)
      .toBe(true);
    expected = phaseSnapshot(harness, trainId);
    harness.saveReload();
    expect(phaseSnapshot(harness, trainId)).toEqual(expected);

    harness.setRuntime(trainId, accessRuntime(harness, 'managed-forest'));
    harness.advanceTicks(1);
    expect(train(harness, trainId).cargo?.units).toBe(10);
    const beforeDerail = phaseSnapshot(harness, trainId);
    harness.setRuntime(trainId, {
      trackUUID: null,
      trackT: null,
      speedWorldUnitsPerSecond: 0,
      throttle: 0,
      derailed: true,
    });
    harness.advanceTicks(1);
    expect(train(harness, trainId).cargo?.units).toBe(10);
    expect(train(harness, trainId).trackUUID).toBe(beforeDerail.trackUUID);
    expected = phaseSnapshot(harness, trainId);
    harness.saveReload();
    expect(phaseSnapshot(harness, trainId)).toEqual(expected);

    harness.advanceTicks(1);
    expect(train(harness, trainId).cargo?.units).toBe(20);
  });

  it('runs three cycles without quantity drift or duplicate transfer and cost entries', () => {
    harness.buildConnectedRoute();
    const trainId = harness.purchaseTimberSet();
    let priorLifetimeRevenue = 0;

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      harness.setRuntime(trainId, {
        ...midpointRuntime(harness),
        speedWorldUnitsPerSecond: 0,
        throttle: 0,
      });
      let replenishmentTicks = 0;
      while (facility(
        harness,
        'managed-forest',
      ).inventories.logs.quantity < 60) {
        harness.advanceTicks(1);
        replenishmentTicks += 1;
        if (replenishmentTicks > 40) {
          throw new Error('Managed Forest did not replenish one train load');
        }
      }
      harness.setRuntime(trainId, accessRuntime(harness, 'managed-forest'));
      for (let batch = 1; batch <= 6; batch += 1) {
        const beforeUnits = train(harness, trainId).cargo?.units ?? 0;
        harness.advanceTicks(1);
        expect(train(harness, trainId).cargo?.units).toBe(
          beforeUnits + 10,
        );
      }

      harness.setRuntime(trainId, midpointRuntime(harness));
      harness.advanceTicks(1);
      expect(train(harness, trainId).cargo?.units).toBe(60);

      harness.setRuntime(trainId, accessRuntime(harness, 'sawmill'));
      for (let batch = 1; batch <= 6; batch += 1) {
        const beforeUnits = train(harness, trainId).cargo?.units ?? 0;
        harness.advanceTicks(1);
        expect(train(harness, trainId).cargo?.units ?? 0).toBe(
          beforeUnits - 10,
        );
      }

      const completedTrain = train(harness, trainId);
      expect(completedTrain.cargo).toBeNull();
      expect(completedTrain.operations.lifetimeDeliveredUnits)
        .toBe(cycle * 60);
      expect(completedTrain.operations.lifetimeRunningCost)
        .toBe(cycle * 20);
      expect(completedTrain.operations.lifetimeRevenue)
        .toBeGreaterThan(priorLifetimeRevenue);
      priorLifetimeRevenue = completedTrain.operations.lifetimeRevenue;
      harness.saveReload();
    }

    const world = harness.world;
    const finalForest = facility(harness, 'managed-forest');
    const finalSawmill = facility(harness, 'sawmill');
    expect(
      60 + finalForest.inventories.logs.recentInflow,
    ).toBe(
      finalForest.inventories.logs.quantity
      + finalSawmill.inventories.logs.quantity
      + finalSawmill.inventories.logs.recentOutflow
      + (train(harness, trainId).cargo?.units ?? 0),
    );
    const costEntries = world.company.ledger.filter(
      ({ category }) => category === 'train-running-cost',
    );
    const deliveryEntries = world.company.ledger.filter(
      ({ category }) => category === 'delivery-revenue',
    );
    expect(costEntries).toHaveLength(3);
    expect(new Set(costEntries.map(({ tick }) => tick)).size).toBe(3);
    expect(costEntries.map(({ referenceId, tick }) => referenceId))
      .toEqual(costEntries.map(({ tick }) => `active-trains:${tick}`));
    expect(deliveryEntries).toHaveLength(18);
    expect(new Set(deliveryEntries.map(
      ({ referenceId }) => referenceId,
    )).size).toBe(18);
    expect(train(harness, trainId).operations.lifetimeDeliveredUnits)
      .toBe(180);
    expect(countForwardRegionalDevelopmentGrants(world.company)).toBe(1);
    expect(world.freightProgress.developmentGrantAwarded).toBe(true);
  });

  it('rejects stale, duplicate-ID, live, and install purchase failures atomically', () => {
    harness.buildConnectedRoute();
    let nextId = 1;
    const serviceProbe = purchaseRuntime();
    const service = new FreightPurchaseService(
      WorldManager,
      serviceProbe.port,
      () => `failure-matrix-${nextId++}`,
    );
    const staleQuote = service.quote(purchaseInput(harness));
    harness.advanceTicks(1);
    let before = JSON.stringify(harness.world);
    expect(service.purchase(staleQuote)).toEqual({
      ok: false,
      blocker: 'stale-revision',
    });
    expect(JSON.stringify(harness.world)).toBe(before);

    const firstQuote = service.quote(purchaseInput(harness));
    const first = service.purchase(firstQuote);
    expect(first.ok).toBe(true);
    if (first.ok === false) throw new Error(first.blocker);
    expect(serviceProbe.spawnCalls).toEqual([{
      trainId: first.trainId,
      freightSetId: 'flatbed-freight-set',
    }]);
    expect(serviceProbe.placeCalls).toEqual([{
      trainId: first.trainId,
      trackUUID: firstQuote.trackUUID,
      trackT: firstQuote.trackT,
      facing: firstQuote.facing,
    }]);
    expect(serviceProbe.removeCalls).toEqual([]);
    expect([...serviceProbe.liveIds]).toEqual([first.trainId]);

    const duplicateProbe = purchaseRuntime();
    const duplicateService = new FreightPurchaseService(
      WorldManager,
      duplicateProbe.port,
      () => first.trainId,
    );
    before = JSON.stringify(harness.world);
    expect(duplicateService.purchase(
      duplicateService.quote(purchaseInput(harness)),
    )).toEqual({
      ok: false,
      blocker: 'duplicate-train-id',
    });
    expect(duplicateProbe.spawnCalls).toEqual([]);
    expect(duplicateProbe.placeCalls).toEqual([]);
    expect(duplicateProbe.removeCalls).toEqual([]);
    expect([...duplicateProbe.liveIds]).toEqual([]);
    expect(JSON.stringify(harness.world)).toBe(before);

    const liveFailures: Array<{
      blocker: 'live-spawn-failed' | 'live-placement-failed';
      probe: PurchaseRuntimeProbe;
    }> = [
      {
        blocker: 'live-spawn-failed',
        probe: purchaseRuntime({ spawn: () => null }),
      },
      {
        blocker: 'live-placement-failed',
        probe: purchaseRuntime({ place: () => false }),
      },
    ];
    liveFailures.forEach(({ blocker, probe }, index) => {
      const trainId = `live-failure-${index}`;
      const failed = new FreightPurchaseService(
        WorldManager,
        probe.port,
        () => trainId,
      );
      const quote = failed.quote(purchaseInput(harness));
      before = JSON.stringify(harness.world);
      expect(failed.purchase(quote)).toEqual({
        ok: false,
        blocker,
      });
      expect(probe.spawnCalls).toEqual([{
        trainId,
        freightSetId: 'flatbed-freight-set',
      }]);
      expect(probe.placeCalls).toEqual(index === 0 ? [] : [{
        trainId,
        trackUUID: quote.trackUUID,
        trackT: quote.trackT,
        facing: quote.facing,
      }]);
      expect(probe.removeCalls).toEqual([trainId]);
      expect([...probe.liveIds]).toEqual([]);
      expect(JSON.stringify(harness.world)).toBe(before);
    });

    const installProbe = purchaseRuntime();
    const install = new FreightPurchaseService(
      WorldManager,
      installProbe.port,
      () => 'install-failure',
    );
    const apply = jest.spyOn(WorldManager, 'applyOperationsBatch')
      .mockReturnValue(false);
    const installQuote = install.quote(purchaseInput(harness));
    before = JSON.stringify(harness.world);
    expect(install.purchase(installQuote)).toEqual({
      ok: false,
      blocker: 'world-install-failed',
    });
    apply.mockRestore();
    expect(installProbe.spawnCalls).toEqual([{
      trainId: 'install-failure',
      freightSetId: 'flatbed-freight-set',
    }]);
    expect(installProbe.placeCalls).toEqual([{
      trainId: 'install-failure',
      trackUUID: installQuote.trackUUID,
      trackT: installQuote.trackT,
      facing: installQuote.facing,
    }]);
    expect(installProbe.removeCalls).toEqual(['install-failure']);
    expect([...installProbe.liveIds]).toEqual([]);
    expect(JSON.stringify(harness.world)).toBe(before);
  });

  it('keeps a committed purchase on save failure, retries exactly, and rejects unaffordable purchase', () => {
    harness.buildConnectedRoute();
    let nextId = 1;
    const successfulProbe = purchaseRuntime();
    const service = new FreightPurchaseService(
      WorldManager,
      successfulProbe.port,
      () => `affordability-${nextId++}`,
    );
    const save = jest.spyOn(WorldManager, 'save').mockReturnValueOnce(false);
    const first = service.purchase(service.quote(purchaseInput(harness)));
    expect(first).toEqual({
      ok: true,
      trainId: 'affordability-1',
      saved: false,
      saveState: 'unsaved',
    });
    const committed = harness.world;
    save.mockRestore();
    expect(WorldManager.save()).toBe(true);
    const retried = harness.world;
    expect({
      ...retried,
      metadata: committed.metadata,
    }).toEqual(committed);
    expect(retried.metadata.updatedAt)
      .toBeGreaterThanOrEqual(committed.metadata.updatedAt);
    const persisted = clonePlainData(retried);
    expect(SaveService.loadWorld(persisted.id)).toEqual(persisted);
    WorldManager.reset();
    expect(WorldManager.load(persisted.id)).toEqual(persisted);

    while (harness.world.company.cash >= 90_000) {
      const result = service.purchase(service.quote(purchaseInput(harness)));
      expect(result.ok).toBe(true);
    }
    const unaffordableProbe = purchaseRuntime();
    const unaffordableService = new FreightPurchaseService(
      WorldManager,
      unaffordableProbe.port,
      () => 'unaffordable-preflight',
    );
    const unaffordableQuote = unaffordableService.quote(
      purchaseInput(harness),
    );
    expect(unaffordableQuote).toEqual(expect.objectContaining({
      affordable: false,
      valid: false,
      blocker: 'insufficient-cash',
    }));
    const before = JSON.stringify(harness.world);
    expect(unaffordableService.purchase(unaffordableQuote)).toEqual({
      ok: false,
      blocker: 'insufficient-cash',
    });
    expect(unaffordableProbe.spawnCalls).toEqual([]);
    expect(unaffordableProbe.placeCalls).toEqual([]);
    expect(unaffordableProbe.removeCalls).toEqual([]);
    expect([...unaffordableProbe.liveIds]).toEqual([]);
    expect(JSON.stringify(harness.world)).toBe(before);
  });

  it('clamps partial destination space and reserved source stock through EconomySystem', () => {
    harness.destroy();
    installFirstFreightRoutePhase({
      cargoUnits: 60,
      sawmillLogs: 196,
    });
    let economy = new EconomySystem(WorldManager);
    let result = economy.update(ECONOMY_TICK_MS, true, [
      fixedRuntime({ trackT: 1, x: 500 }),
    ]);
    expect(result.ticksAdvanced).toBe(1);
    expect(result.cargoStatuses).toEqual([
      expect.objectContaining({
        kind: 'unloading',
        batchUnits: 4,
        cargoUnits: 56,
      }),
    ]);
    expect(WorldManager.world?.trains[0].cargo?.units).toBe(56);
    expect(WorldManager.world?.economy.facilities.find(
      ({ definitionId }) => definitionId === 'sawmill',
    )?.inventories.logs.quantity).toBe(200);
    expect(WorldManager.world?.company.ledger.filter(
      ({ category }) => category === 'delivery-revenue',
    )).toHaveLength(1);

    installFirstFreightRoutePhase({
      forestLogs: 20,
      forestReservedLogs: 16,
    });
    economy = new EconomySystem(WorldManager);
    result = economy.update(ECONOMY_TICK_MS, true, [
      fixedRuntime({ trackT: 0, x: -500 }),
    ]);
    expect(result.cargoStatuses).toEqual([
      expect.objectContaining({
        kind: 'loading',
        batchUnits: 4,
        cargoUnits: 4,
      }),
    ]);
    expect(WorldManager.world?.trains[0].cargo?.units).toBe(4);
    expect(WorldManager.world?.economy.facilities.find(
      ({ definitionId }) => definitionId === 'managed-forest',
    )?.inventories.logs).toEqual(expect.objectContaining({
      quantity: 16,
      reservedQuantity: 16,
    }));
  });

  it('retains cargo through movement and derailment, then re-rails for free', () => {
    harness.destroy();
    installFirstFreightRoutePhase({ cargoUnits: 10 });
    let economy = new EconomySystem(WorldManager);
    const beforeMoveCargo = clonePlainData(
      WorldManager.world?.trains[0].cargo,
    );
    const moving = economy.update(ECONOMY_TICK_MS, true, [
      fixedRuntime({
        trackT: 1,
        x: 500,
        speedWorldUnitsPerSecond: 12,
        throttle: 1,
      }),
    ]);
    expect(moving.cargoStatuses).toEqual([
      expect.objectContaining({
        kind: 'blocked',
        blocker: 'train-moving',
        batchUnits: 0,
      }),
    ]);
    expect(WorldManager.world?.trains[0].cargo).toEqual(beforeMoveCargo);
    expect(WorldManager.world?.company.ledger.filter(
      ({ category }) => category === 'train-running-cost',
    )).toHaveLength(1);

    installFirstFreightRoutePhase({ cargoUnits: 10 });
    economy = new EconomySystem(WorldManager);
    const derailed = economy.update(ECONOMY_TICK_MS, true, [
      fixedRuntime({
        trackUUID: null,
        trackT: null,
        x: 500,
        derailed: true,
      }),
    ]);
    expect(derailed.cargoStatuses).toEqual([
      expect.objectContaining({
        blocker: 'derailed',
        batchUnits: 0,
      }),
    ]);
    expect(WorldManager.world?.trains[0].cargo?.units).toBe(10);
    expect(WorldManager.world?.company.ledger.filter(
      ({ category }) => category === 'train-running-cost',
    )).toHaveLength(0);

    const recovered = economy.update(ECONOMY_TICK_MS, true, [
      fixedRuntime({ trackT: 1, x: 500 }),
    ]);
    expect(recovered.cargoStatuses).toEqual([
      expect.objectContaining({
        kind: 'unloading',
        batchUnits: 10,
        cargoUnits: 0,
      }),
    ]);
    expect(WorldManager.world?.trains[0].cargo).toBeNull();
  });

  it('stops running-cost insolvency without partial cash, ledger, or lifetime mutation', () => {
    harness.destroy();
    installFirstFreightRoutePhase({ cash: 19, cargoUnits: 10 });
    const economy = new EconomySystem(WorldManager);
    const before = clonePlainData({
      company: WorldManager.world?.company,
      operations: WorldManager.world?.trains[0].operations,
      cargo: WorldManager.world?.trains[0].cargo,
    });

    const result = economy.update(ECONOMY_TICK_MS, true, [
      fixedRuntime({
        speedWorldUnitsPerSecond: 12,
        throttle: 1,
      }),
    ]);

    expect(result.runningCostBlockerByTrainId).toEqual({
      'train-1': 'insufficient-running-cash',
    });
    expect(result.stopTrainIds).toEqual(['train-1']);
    expect({
      company: WorldManager.world?.company,
      operations: WorldManager.world?.trains[0].operations,
      cargo: WorldManager.world?.trains[0].cargo,
    }).toEqual(before);
  });
});
