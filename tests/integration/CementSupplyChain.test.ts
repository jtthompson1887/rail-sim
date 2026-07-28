/**
 * @jest-environment jsdom
 */

import type Train from '../../src/entities/Train';
import { quoteLocalProduct } from '../../src/economy/MarketSystem';
import type { EconomyUpdateResult } from '../../src/economy/EconomySystem';
import { summariseProfitAndLoss } from '../../src/economy/FinanceLedger';
import {
  FreightPurchaseService,
  type FreightPurchaseRuntimePort,
} from '../../src/freight/FreightPurchaseService';
import type { FreightDeliveryEvent } from '../../src/freight/CargoSystem';
import {
  AGGREGATE_HOPPER_SET_ID,
  COVERED_CEMENT_SET_ID,
  getFreightSet,
} from '../../src/freight/FreightSetCatalog';
import { WorldManager } from '../../src/managers/WorldManager';
import {
  createCementSupplyChainHarness,
  type CementSupplyChainHarness,
} from '../fixtures/CementSupplyChainFixture';

const facility = (
  harness: CementSupplyChainHarness,
  definitionId: string,
) => {
  const found = harness.world.economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!found) throw new Error(`Missing ${definitionId}`);
  return found;
};

const train = (
  harness: CementSupplyChainHarness,
  trainId: string,
) => {
  const found = harness.world.trains.find(({ id }) => id === trainId);
  if (!found) throw new Error(`Missing ${trainId}`);
  return found;
};

const cargoUnits = (
  harness: CementSupplyChainHarness,
  trainId: string,
  productId: string,
): number => {
  const cargo = train(harness, trainId).cargo;
  return cargo?.productId === productId ? cargo.units : 0;
};

const expectMineralConservation = (
  harness: CementSupplyChainHarness,
  aggregateTrainId: string,
  cementTrainId: string,
): void => {
  const quarry = facility(harness, 'quarry');
  const cementWorks = facility(harness, 'cement-works');
  const prefab = facility(harness, 'prefabrication-plant');
  const quarryLimestone = quarry.inventories['limestone-aggregate'];
  const worksLimestone = cementWorks.inventories['limestone-aggregate'];
  const worksCement = cementWorks.inventories.cement;
  const prefabCement = prefab.inventories.cement;

  expect(75 + quarryLimestone.recentInflow).toBe(
    quarryLimestone.quantity
      + worksLimestone.quantity
      + cargoUnits(harness, aggregateTrainId, 'limestone-aggregate')
      + worksLimestone.recentOutflow,
  );
  expect(worksCement.recentInflow).toBe(
    worksCement.quantity
      + prefabCement.quantity
      + cargoUnits(harness, cementTrainId, 'cement')
      + prefabCement.recentOutflow,
  );
};

const cargoStatus = (
  result: EconomyUpdateResult,
  trainId: string,
) => {
  const found = result.cargoStatuses.find(
    (candidate) => candidate.trainId === trainId,
  );
  if (!found) throw new Error(`Missing cargo status for ${trainId}`);
  return found;
};

const expectCheckpoint = (
  harness: CementSupplyChainHarness,
  trainIds: readonly string[],
): void => {
  const checkpoint = harness.saveReload();
  expect(checkpoint.detached).toEqual(checkpoint.expected);
  expect(harness.world).toEqual(checkpoint.expected);
  expect(Object.keys(checkpoint.restoredRuntimeByTrainId).sort())
    .toEqual([...trainIds].sort());
  trainIds.forEach((trainId) => {
    expect(checkpoint.restoredRuntimeByTrainId[trainId]).toEqual(
      expect.objectContaining({
        trainId,
        trackUUID: train(harness, trainId).trackUUID,
        facing: train(harness, trainId).facing,
        speedWorldUnitsPerSecond: 0,
        throttle: 0,
        derailed: false,
      }),
    );
    expect(checkpoint.restoredRuntimeByTrainId[trainId].trackT)
      .toBeCloseTo(train(harness, trainId).trackT, 3);
  });
};

const expectLoading = (
  result: EconomyUpdateResult,
  trainId: string,
  productId: string,
): void => {
  expect(cargoStatus(result, trainId)).toMatchObject({
    trainId,
    kind: 'loading',
    productId,
    batchUnits: 10,
    batchRevenue: 0,
  });
};

const expectUnloadingAtQuotedRevenue = (
  harness: CementSupplyChainHarness,
  result: EconomyUpdateResult,
  trainId: string,
  productId: string,
  expectedBatchRevenue: number,
): void => {
  expect(cargoStatus(result, trainId)).toMatchObject({
    trainId,
    kind: 'unloading',
    productId,
    batchUnits: 10,
    batchRevenue: expectedBatchRevenue,
  });
};

interface RuntimeProbe {
  readonly port: FreightPurchaseRuntimePort;
  readonly liveIds: Set<string>;
  readonly spawnCalls: string[];
  readonly placeCalls: string[];
  readonly removeCalls: string[];
}

const purchaseRuntime = (
  overrides: Partial<FreightPurchaseRuntimePort> = {},
): RuntimeProbe => {
  const liveIds = new Set<string>();
  const spawnCalls: string[] = [];
  const placeCalls: string[] = [];
  const removeCalls: string[] = [];
  const port: FreightPurchaseRuntimePort = {
    spawn: (trainId, freightSetId) => {
      spawnCalls.push(`${trainId}:${freightSetId}`);
      liveIds.add(trainId);
      return { getUUID: () => trainId } as unknown as Train;
    },
    place: (runtimeTrain, trackUUID, trackT, facing) => {
      placeCalls.push(
        `${runtimeTrain.getUUID()}:${trackUUID}:${trackT}:${facing}`,
      );
      return true;
    },
    remove: (trainId) => {
      removeCalls.push(trainId);
      liveIds.delete(trainId);
      return true;
    },
    ...overrides,
  };
  return {
    port,
    liveIds,
    spawnCalls,
    placeCalls,
    removeCalls,
  };
};

describe('Integration: generated cement supply chain', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    WorldManager.reset();
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it('conserves minerals, finance, progress, and persistence through both profitable trips', () => {
    const harness = createCementSupplyChainHarness('playtest-825');
    const completedDeliveries: FreightDeliveryEvent[] = [];
    const observedBatchRevenue: number[] = [];
    try {
      const openingCash = harness.world.company.cash;
      const network = harness.buildSupplyNetwork();
      expect(network.starterTrackIds.length).toBeGreaterThan(0);
      expect(new Set([
        ...network.starterTrackIds,
        network.prefabTrackId,
        network.quarryToCementTrackId,
        network.cementToPrefabTrackId,
      ]).size).toBe(harness.world.tracks.length);
      expect(network.prefabConnections).toBe(1);
      expect(network.quarryToCementConnections).toBe(0);
      expect(network.cementToPrefabConnections).toBe(2);
      const aggregateSet = getFreightSet(AGGREGATE_HOPPER_SET_ID);
      const cementSet = getFreightSet(COVERED_CEMENT_SET_ID);
      if (!aggregateSet || !cementSet) {
        throw new Error('Mineral freight sets are missing from the catalogue');
      }
      const expectedCapitalExpenditure = network.totalConstructionCost
        + aggregateSet.purchasePrice
        + cementSet.purchasePrice;

      for (let tick = 0; tick < 20; tick += 1) {
        harness.advanceStoppedTick();
      }
      expect(facility(harness, 'quarry').inventories[
        'limestone-aggregate'
      ]).toMatchObject({
        quantity: 125,
        recentInflow: 50,
      });

      const aggregateTrainId = harness.purchaseFreightSet(
        AGGREGATE_HOPPER_SET_ID,
      );
      const cementTrainId = harness.purchaseFreightSet(
        COVERED_CEMENT_SET_ID,
      );
      expect(aggregateTrainId).not.toBe(cementTrainId);
      expect(train(harness, aggregateTrainId).freightSetId)
        .toBe(AGGREGATE_HOPPER_SET_ID);
      expect(train(harness, cementTrainId).freightSetId)
        .toBe(COVERED_CEMENT_SET_ID);
      harness.placeAtMidpoint(cementTrainId, 'cement-to-prefab');
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );

      harness.placeAtFacility(aggregateTrainId, 'quarry');
      for (let batch = 0; batch < 6; batch += 1) {
        expectLoading(
          harness.advanceStoppedTick(),
          aggregateTrainId,
          'limestone-aggregate',
        );
      }
      expect(train(harness, aggregateTrainId).cargo).toMatchObject({
        productId: 'limestone-aggregate',
        units: 60,
        loadedUnits: 60,
      });
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );
      expectCheckpoint(harness, [aggregateTrainId, cementTrainId]);

      harness.placeAtFacility(aggregateTrainId, 'quarry');
      harness.placeAtMidpoint(cementTrainId, 'cement-to-prefab');
      for (let batch = 0; batch < 6; batch += 1) {
        expectLoading(
          harness.advanceStoppedTick(),
          aggregateTrainId,
          'limestone-aggregate',
        );
      }
      expect(train(harness, aggregateTrainId).cargo).toMatchObject({
        productId: 'limestone-aggregate',
        units: 120,
        loadedUnits: 120,
      });
      expect(facility(harness, 'quarry').inventories[
        'limestone-aggregate'
      ].quantity).toBe(35);
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );

      harness.placeAtMidpoint(aggregateTrainId, 'quarry-to-cement');
      const aggregateTransit = harness.advanceActiveTick(aggregateTrainId);
      expect(cargoStatus(aggregateTransit, aggregateTrainId)).toMatchObject({
        blocker: 'train-moving',
        batchUnits: 0,
      });
      expect(train(
        harness,
        aggregateTrainId,
      ).operations.currentTripRunningCost).toBe(20);
      const recovery = harness.derailAndRecover(aggregateTrainId);
      expect(recovery.derailed).toMatchObject({
        trainId: aggregateTrainId,
        derailed: true,
      });
      expect(recovery.recovered).toMatchObject({
        trainId: aggregateTrainId,
        derailed: false,
        throttle: 0,
      });
      expect(recovery.authoritativeAfter).toEqual(
        recovery.authoritativeBefore,
      );
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );
      expectCheckpoint(harness, [aggregateTrainId, cementTrainId]);

      harness.placeAtFacility(aggregateTrainId, 'cement-works');
      harness.placeAtMidpoint(cementTrainId, 'cement-to-prefab');
      for (let batch = 0; batch < 12; batch += 1) {
        const before = harness.world;
        const destination = facility(harness, 'cement-works');
        const quote = quoteLocalProduct(
          'limestone-aggregate',
          before.economy.market,
          destination.inventories['limestone-aggregate'],
        );
        expect(quote.ok).toBe(true);
        if (quote.ok === false) throw new Error(quote.code);
        const result = harness.advanceStoppedTick();
        const expectedBatchRevenue = quote.unitPrice * 10;
        observedBatchRevenue.push(expectedBatchRevenue);
        expectUnloadingAtQuotedRevenue(
          harness,
          result,
          aggregateTrainId,
          'limestone-aggregate',
          expectedBatchRevenue,
        );
        completedDeliveries.push(...result.completedDeliveries);
      }
      expect(completedDeliveries).toHaveLength(1);
      expect(completedDeliveries[0]).toMatchObject({
        trainId: aggregateTrainId,
        productId: 'limestone-aggregate',
        units: 120,
        destinationFacilityId: 'cement-works',
        runningCost: 20,
      });
      expect(completedDeliveries[0].operatingProfit).toBeGreaterThan(0);
      expect(harness.world.freightProgress
        .profitableLimestoneDeliveryCompleted).toBe(true);
      expect(facility(harness, 'cement-works')).toMatchObject({
        recipeProgressTicks: 3,
        inventories: {
          'limestone-aggregate': { quantity: 96 },
          cement: { quantity: 16 },
        },
      });
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );

      harness.placeAtMidpoint(aggregateTrainId, 'quarry-to-cement');
      for (let tick = 0; tick < 16; tick += 1) {
        harness.advanceStoppedTick();
      }
      expect(facility(harness, 'cement-works')).toMatchObject({
        recipeProgressTicks: 3,
        inventories: {
          'limestone-aggregate': { quantity: 48 },
          cement: { quantity: 48 },
        },
      });
      expectCheckpoint(harness, [aggregateTrainId, cementTrainId]);
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );

      harness.placeAtMidpoint(aggregateTrainId, 'quarry-to-cement');
      harness.placeAtMidpoint(cementTrainId, 'cement-to-prefab');
      for (let tick = 0; tick < 24; tick += 1) {
        harness.advanceStoppedTick();
      }
      expect(facility(harness, 'cement-works')).toMatchObject({
        recipeProgressTicks: 0,
        inventories: {
          'limestone-aggregate': { quantity: 0 },
          cement: { quantity: 80 },
        },
      });
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );

      harness.placeAtFacility(cementTrainId, 'cement-works');
      for (let batch = 0; batch < 8; batch += 1) {
        expectLoading(
          harness.advanceStoppedTick(),
          cementTrainId,
          'cement',
        );
      }
      expect(train(harness, cementTrainId).cargo).toMatchObject({
        productId: 'cement',
        units: 80,
        loadedUnits: 80,
      });
      expect(facility(harness, 'cement-works').inventories.cement.quantity)
        .toBe(0);
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );

      harness.placeAtMidpoint(cementTrainId, 'cement-to-prefab');
      const cementTransit = harness.advanceActiveTick(cementTrainId);
      expect(cargoStatus(cementTransit, cementTrainId)).toMatchObject({
        blocker: 'train-moving',
        batchUnits: 0,
      });
      expect(train(
        harness,
        cementTrainId,
      ).operations.currentTripRunningCost).toBe(22);
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );

      harness.placeAtFacility(cementTrainId, 'prefabrication-plant');
      for (let batch = 0; batch < 4; batch += 1) {
        const before = harness.world;
        const destination = facility(harness, 'prefabrication-plant');
        const quote = quoteLocalProduct(
          'cement',
          before.economy.market,
          destination.inventories.cement,
        );
        expect(quote.ok).toBe(true);
        if (quote.ok === false) throw new Error(quote.code);
        const result = harness.advanceStoppedTick();
        const expectedBatchRevenue = quote.unitPrice * 10;
        observedBatchRevenue.push(expectedBatchRevenue);
        expectUnloadingAtQuotedRevenue(
          harness,
          result,
          cementTrainId,
          'cement',
          expectedBatchRevenue,
        );
        completedDeliveries.push(...result.completedDeliveries);
      }
      expect(facility(
        harness,
        'prefabrication-plant',
      ).inventories.cement.quantity).toBe(40);
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );
      expectCheckpoint(harness, [aggregateTrainId, cementTrainId]);

      harness.placeAtFacility(cementTrainId, 'prefabrication-plant');
      for (let batch = 0; batch < 4; batch += 1) {
        const before = harness.world;
        const destination = facility(harness, 'prefabrication-plant');
        const quote = quoteLocalProduct(
          'cement',
          before.economy.market,
          destination.inventories.cement,
        );
        expect(quote.ok).toBe(true);
        if (quote.ok === false) throw new Error(quote.code);
        const result = harness.advanceStoppedTick();
        const expectedBatchRevenue = quote.unitPrice * 10;
        observedBatchRevenue.push(expectedBatchRevenue);
        expectUnloadingAtQuotedRevenue(
          harness,
          result,
          cementTrainId,
          'cement',
          expectedBatchRevenue,
        );
        completedDeliveries.push(...result.completedDeliveries);
      }
      expect(completedDeliveries).toHaveLength(2);
      expect(completedDeliveries[1]).toMatchObject({
        trainId: cementTrainId,
        productId: 'cement',
        units: 80,
        destinationFacilityId: 'prefabrication-plant',
        runningCost: 22,
      });
      expect(completedDeliveries[1].operatingProfit).toBeGreaterThan(0);
      expectCheckpoint(harness, [aggregateTrainId, cementTrainId]);

      const achieved = harness.world;
      const prefab = facility(harness, 'prefabrication-plant');
      const deliveryEntries = achieved.company.ledger.filter(
        ({ category }) => category === 'delivery-revenue',
      );
      const runningEntries = achieved.company.ledger.filter(
        ({ category }) => category === 'train-running-cost',
      );
      const deliveryRevenue = deliveryEntries.reduce(
        (total, entry) => total + entry.amount,
        0,
      );
      const runningExpense = runningEntries.reduce(
        (total, entry) => total - entry.amount,
        0,
      );

      expect(deliveryEntries).toHaveLength(20);
      expect(new Set(
        deliveryEntries.map(({ referenceId }) => referenceId),
      ).size).toBe(20);
      expect(deliveryRevenue).toBe(observedBatchRevenue.reduce(
        (total, revenue) => total + revenue,
        0,
      ));
      expect(runningEntries.map(({ amount }) => amount).sort(
        (left, right) => left - right,
      )).toEqual([-22, -20]);
      expect(runningExpense).toBe(42);
      expect(achieved.company.cash).toBe(achieved.company.ledger.reduce(
        (total, entry) => total + entry.amount,
        0,
      ));
      expect(achieved.company.cash).toBe(
        openingCash
          - expectedCapitalExpenditure
          + deliveryRevenue
          - runningExpense,
      );
      expect(summariseProfitAndLoss(
        achieved.company,
        0,
        achieved.economy.tick,
      )).toEqual({
        deliveryRevenue,
        contractBonuses: 0,
        operatingExpenses: 42,
        railwayOperatingProfit: deliveryRevenue - 42,
        capitalExpenditure: expectedCapitalExpenditure,
        cashFlow: achieved.company.cash,
      });
      expect(completedDeliveries.map((delivery) => (
        delivery.operatingProfit
      ))).toEqual(completedDeliveries.map(
        ({ revenue, runningCost }) => revenue - runningCost,
      ));
      expect(completedDeliveries.every(
        ({ operatingProfit }) => operatingProfit > 0,
      )).toBe(true);
      expect(achieved.freightProgress).toMatchObject({
        profitableLimestoneDeliveryCompleted: true,
        profitableCementDeliveryCompleted: true,
      });
      expect(prefab).toMatchObject({
        recipeProgressTicks: 0,
        inventories: {
          cement: { quantity: 80, recentInflow: 80 },
          steel: { quantity: 0 },
          'building-modules': { quantity: 0 },
        },
      });
      expect(train(harness, aggregateTrainId).operations).toMatchObject({
        lifetimeDeliveredUnits: 120,
        lifetimeRunningCost: 20,
        lastTripRunningCost: 20,
        currentTripRevenue: 0,
        currentTripRunningCost: 0,
      });
      expect(train(harness, cementTrainId).operations).toMatchObject({
        lifetimeDeliveredUnits: 80,
        lifetimeRunningCost: 22,
        lastTripRunningCost: 22,
        currentTripRevenue: 0,
        currentTripRunningCost: 0,
      });
      expectMineralConservation(
        harness,
        aggregateTrainId,
        cementTrainId,
      );
    } finally {
      harness.destroy();
    }
  });

  it('keeps stale, live, install, and save failures exact-once and atomic', () => {
    const harness = createCementSupplyChainHarness('playtest-825');
    try {
      harness.buildSupplyNetwork();

      const staleProbe = purchaseRuntime();
      const staleService = new FreightPurchaseService(
        WorldManager,
        staleProbe.port,
        () => 'stale-aggregate',
      );
      const staleQuote = staleService.quote(
        harness.purchaseInput(AGGREGATE_HOPPER_SET_ID),
      );
      harness.advanceStoppedTick();
      let before = JSON.stringify(harness.world);
      expect(staleService.purchase(staleQuote)).toEqual({
        ok: false,
        blocker: 'stale-revision',
      });
      expect(JSON.stringify(harness.world)).toBe(before);
      expect(staleProbe.liveIds.size).toBe(0);

      const spawnProbe = purchaseRuntime({ spawn: () => null });
      const spawnService = new FreightPurchaseService(
        WorldManager,
        spawnProbe.port,
        () => 'spawn-failure',
      );
      before = JSON.stringify(harness.world);
      expect(spawnService.purchase(spawnService.quote(
        harness.purchaseInput(AGGREGATE_HOPPER_SET_ID),
      ))).toEqual({
        ok: false,
        blocker: 'live-spawn-failed',
      });
      expect(JSON.stringify(harness.world)).toBe(before);
      expect(spawnProbe.liveIds.size).toBe(0);

      const placementProbe = purchaseRuntime({ place: () => false });
      const placementService = new FreightPurchaseService(
        WorldManager,
        placementProbe.port,
        () => 'placement-failure',
      );
      before = JSON.stringify(harness.world);
      expect(placementService.purchase(placementService.quote(
        harness.purchaseInput(AGGREGATE_HOPPER_SET_ID),
      ))).toEqual({
        ok: false,
        blocker: 'live-placement-failed',
      });
      expect(JSON.stringify(harness.world)).toBe(before);
      expect(placementProbe.liveIds.size).toBe(0);
      expect(placementProbe.removeCalls).toEqual(['placement-failure']);

      const installProbe = purchaseRuntime();
      const installService = new FreightPurchaseService(
        WorldManager,
        installProbe.port,
        () => 'install-failure',
      );
      const apply = jest.spyOn(WorldManager, 'applyOperationsBatch')
        .mockReturnValueOnce(false);
      before = JSON.stringify(harness.world);
      expect(installService.purchase(installService.quote(
        harness.purchaseInput(AGGREGATE_HOPPER_SET_ID),
      ))).toEqual({
        ok: false,
        blocker: 'world-install-failed',
      });
      apply.mockRestore();
      expect(JSON.stringify(harness.world)).toBe(before);
      expect(installProbe.liveIds.size).toBe(0);
      expect(installProbe.removeCalls).toEqual(['install-failure']);

      const saveProbe = purchaseRuntime();
      const saveService = new FreightPurchaseService(
        WorldManager,
        saveProbe.port,
        () => 'save-failure',
      );
      const save = jest.spyOn(WorldManager, 'save').mockReturnValueOnce(false);
      const saveQuote = saveService.quote(
        harness.purchaseInput(AGGREGATE_HOPPER_SET_ID),
      );
      expect(saveService.purchase(saveQuote)).toEqual({
        ok: true,
        trainId: 'save-failure',
        saved: false,
        saveState: 'unsaved',
      });
      const committed = harness.world;
      expect(committed.trains.filter(
        ({ id }) => id === 'save-failure',
      )).toHaveLength(1);
      expect(saveProbe.liveIds).toEqual(new Set(['save-failure']));
      expect(committed.company.ledger.filter(
        ({ category, referenceId }) => category === 'vehicle-capex'
          && referenceId === AGGREGATE_HOPPER_SET_ID,
      )).toHaveLength(1);
      expect(saveService.purchase(saveQuote)).toEqual({
        ok: false,
        blocker: 'stale-revision',
      });
      expect(harness.world).toEqual(committed);
      save.mockRestore();
      expect(WorldManager.save()).toBe(true);
      expect(harness.world.trains.filter(
        ({ id }) => id === 'save-failure',
      )).toHaveLength(1);
      expect(harness.world.company.ledger.filter(
        ({ category, referenceId }) => category === 'vehicle-capex'
          && referenceId === AGGREGATE_HOPPER_SET_ID,
      )).toHaveLength(1);
    } finally {
      harness.destroy();
    }
  });
});
