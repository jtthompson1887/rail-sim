/**
 * @jest-environment jsdom
 */

import { REGIONAL_DEVELOPMENT_GRANT } from '../../src/config/FreightProgression';
import type { EconomyUpdateResult } from '../../src/economy/EconomySystem';
import type { FreightDeliveryEvent } from '../../src/freight/CargoSystem';
import {
  createStructuralTimberLinkHarness,
  type StructuralTimberLinkHarness,
} from '../fixtures/StructuralTimberLinkFixture';

const facility = (
  harness: StructuralTimberLinkHarness,
  definitionId: string,
) => {
  const result = harness.world.economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!result) throw new Error(`Missing ${definitionId}`);
  return result;
};

const train = (
  harness: StructuralTimberLinkHarness,
  trainId: string,
) => {
  const result = harness.world.trains.find(
    (candidate) => candidate.id === trainId,
  );
  if (!result) throw new Error(`Missing ${trainId}`);
  return result;
};

const assertCheckpoint = (
  harness: StructuralTimberLinkHarness,
  trainId: string,
): void => {
  const checkpoint = harness.saveReload();
  expect(checkpoint.detached).toEqual(checkpoint.expected);
  expect(harness.world).toEqual(checkpoint.expected);
  expect(checkpoint.restoredRuntime).toEqual(expect.objectContaining({
    trainId,
    trackUUID: train(harness, trainId).trackUUID,
    facing: train(harness, trainId).facing,
    speedWorldUnitsPerSecond: 0,
    throttle: 0,
    derailed: false,
  }));
  expect(checkpoint.restoredRuntime.trackT)
    .toBeCloseTo(train(harness, trainId).trackT, 3);
};

const expectLoadingBatch = (
  result: EconomyUpdateResult,
  trainId: string,
  productId: 'logs' | 'structural-timber',
): void => {
  expect(result.cargoStatuses).toEqual([
    expect.objectContaining({
      trainId,
      kind: 'loading',
      productId,
      batchUnits: 10,
    }),
  ]);
};

describe('Integration: generated structural timber link', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('anchors a connected affordable Sawmill-to-Prefab extension on the real starter route', () => {
    const harness = createStructuralTimberLinkHarness('playtest-753');
    try {
      expect(harness.world).toMatchObject({
        schemaVersion: 8,
        tracks: [],
        junctions: [],
        stations: [],
        trains: [],
      });

      harness.buildStarterRoute();
      const preview = harness.previewPrefabExtension();
      const sawmill = facility(harness, 'sawmill');
      const anchoredEndpoint = preview.startAnchor.endpoint;

      expect(preview.status).toBe('committable');
      expect(preview.quote).not.toBeNull();
      expect(anchoredEndpoint).toMatchObject({
        open: true,
      });
      expect(Math.hypot(
        preview.startAnchor.x - sawmill.railAccess.x,
        preview.startAnchor.y - sawmill.railAccess.y,
      )).toBeLessThanOrEqual(sawmill.railAccess.radius);
      expect(preview.predictedConnections).toHaveLength(1);
      expect(preview.predictedConnections[0]).toMatchObject({
        existingTrackUUID: anchoredEndpoint?.trackUUID,
        existingEndpoint: anchoredEndpoint?.endpoint,
        newEndpoint: 'start',
      });
      expect(preview.totalCost + 20_000)
        .toBeLessThanOrEqual(REGIONAL_DEVELOPMENT_GRANT);
    } finally {
      harness.destroy();
    }
  });

  it('conserves goods, finance, progress, and placement through the complete persisted chain', () => {
    const harness = createStructuralTimberLinkHarness('playtest-753');
    const completedDeliveries: FreightDeliveryEvent[] = [];
    const unloadingBatchRevenue: number[] = [];
    try {
      const opening = harness.world;
      const openingCash = opening.company.cash;
      const openingForestLogs = facility(
        harness,
        'managed-forest',
      ).inventories.logs.quantity;
      const openingTimber = facility(
        harness,
        'sawmill',
      ).inventories['structural-timber'].quantity;

      harness.buildStarterRoute();
      const trainId = harness.purchaseFlatbed();
      harness.placeAtFacility(trainId, 'managed-forest');

      for (let batch = 0; batch < 3; batch += 1) {
        const result = harness.advanceStoppedTick();
        expectLoadingBatch(result, trainId, 'logs');
      }
      expect(train(harness, trainId).cargo).toMatchObject({
        productId: 'logs',
        units: 30,
        loadedUnits: 30,
      });
      assertCheckpoint(harness, trainId);

      harness.placeAtFacility(trainId, 'managed-forest');
      for (let batch = 0; batch < 3; batch += 1) {
        expectLoadingBatch(
          harness.advanceStoppedTick(),
          trainId,
          'logs',
        );
      }
      expect(train(harness, trainId).cargo?.units).toBe(60);

      harness.placeAtMidpoint(trainId, 'starter');
      expect(harness.advanceActiveTick(trainId).cargoStatuses).toEqual([
        expect.objectContaining({
          trainId,
          kind: 'blocked',
          blocker: 'train-moving',
        }),
      ]);
      assertCheckpoint(harness, trainId);

      harness.placeAtFacility(trainId, 'sawmill');
      for (let batch = 0; batch < 6; batch += 1) {
        const result = harness.advanceStoppedTick();
        expect(result.cargoStatuses[0]).toMatchObject({
          trainId,
          kind: 'unloading',
          productId: 'logs',
          batchUnits: 10,
        });
        unloadingBatchRevenue.push(result.cargoStatuses[0].batchRevenue);
        completedDeliveries.push(...result.completedDeliveries);
      }
      expect(completedDeliveries).toHaveLength(1);
      expect(completedDeliveries[0]).toMatchObject({
        trainId,
        productId: 'logs',
        units: 60,
        destinationFacilityId: 'sawmill',
        runningCost: 20,
      });
      expect(completedDeliveries[0].operatingProfit).toBeGreaterThan(0);
      expect(harness.world.freightProgress).toMatchObject({
        profitableLogDeliveryCompleted: true,
        developmentGrantAwarded: true,
        profitableStructuralTimberDeliveryCompleted: false,
      });
      expect(harness.world.company.ledger.filter(
        ({ referenceId }) =>
          referenceId === 'regional-development-grant:v1',
      )).toHaveLength(1);

      harness.placeAtMidpoint(trainId, 'starter');
      harness.advanceActiveTick(trainId);
      expect(facility(harness, 'sawmill').recipeProgressTicks)
        .toBeGreaterThan(0);
      assertCheckpoint(harness, trainId);

      harness.placeAtMidpoint(trainId, 'starter');
      let forestWaitTicks = 0;
      while (facility(
        harness,
        'managed-forest',
      ).inventories.logs.quantity < 60) {
        harness.advanceStoppedTick();
        forestWaitTicks += 1;
        if (forestWaitTicks > 80) {
          throw new Error('Managed Forest did not replenish 60 logs');
        }
      }

      harness.placeAtFacility(trainId, 'managed-forest');
      for (let batch = 0; batch < 6; batch += 1) {
        expectLoadingBatch(
          harness.advanceStoppedTick(),
          trainId,
          'logs',
        );
      }
      expect(train(harness, trainId).cargo).toMatchObject({
        productId: 'logs',
        units: 60,
        loadedUnits: 60,
      });

      harness.placeAtMidpoint(trainId, 'starter');
      harness.advanceActiveTick(trainId);
      harness.placeAtFacility(trainId, 'sawmill');
      for (let batch = 0; batch < 6; batch += 1) {
        const result = harness.advanceStoppedTick();
        expect(result.cargoStatuses[0]).toMatchObject({
          kind: 'unloading',
          productId: 'logs',
          batchUnits: 10,
        });
        unloadingBatchRevenue.push(result.cargoStatuses[0].batchRevenue);
        completedDeliveries.push(...result.completedDeliveries);
      }
      expect(completedDeliveries).toHaveLength(2);
      expect(completedDeliveries[1]).toMatchObject({
        trainId,
        productId: 'logs',
        units: 60,
        destinationFacilityId: 'sawmill',
        runningCost: 40,
      });
      expect(harness.world.company.ledger.filter(
        ({ referenceId }) =>
          referenceId === 'regional-development-grant:v1',
      )).toHaveLength(1);

      harness.placeAtMidpoint(trainId, 'starter');
      let processingTicks = 0;
      while (facility(
        harness,
        'sawmill',
      ).inventories['structural-timber'].quantity < 60) {
        harness.advanceStoppedTick();
        processingTicks += 1;
        if (processingTicks > 80) {
          throw new Error('Sawmill did not produce 60 structural timber');
        }
      }

      const extension = harness.buildPrefabExtension();
      expect(extension.predictedConnections).toHaveLength(1);
      harness.placeAtFacility(trainId, 'sawmill');
      for (let batch = 0; batch < 3; batch += 1) {
        expectLoadingBatch(
          harness.advanceStoppedTick(),
          trainId,
          'structural-timber',
        );
      }
      expect(train(harness, trainId).cargo).toMatchObject({
        productId: 'structural-timber',
        units: 30,
        loadedUnits: 30,
      });
      assertCheckpoint(harness, trainId);

      harness.placeAtFacility(trainId, 'sawmill');
      for (let batch = 0; batch < 3; batch += 1) {
        expectLoadingBatch(
          harness.advanceStoppedTick(),
          trainId,
          'structural-timber',
        );
      }
      expect(train(harness, trainId).cargo?.units).toBe(60);
      harness.placeAtMidpoint(trainId, 'extension');
      harness.advanceActiveTick(trainId);
      harness.placeAtFacility(trainId, 'prefabrication-plant');
      for (let batch = 0; batch < 3; batch += 1) {
        const result = harness.advanceStoppedTick();
        expect(result.cargoStatuses[0]).toMatchObject({
          kind: 'unloading',
          productId: 'structural-timber',
          batchUnits: 10,
        });
        unloadingBatchRevenue.push(result.cargoStatuses[0].batchRevenue);
        completedDeliveries.push(...result.completedDeliveries);
      }

      const waitingPrefab = facility(
        harness,
        'prefabrication-plant',
      );
      expect(waitingPrefab.inventories['structural-timber'].quantity)
        .toBe(30);
      expect(waitingPrefab.inventories.cement.quantity).toBe(0);
      expect(waitingPrefab.inventories.steel.quantity).toBe(0);
      expect(waitingPrefab.recipeProgressTicks).toBe(0);
      assertCheckpoint(harness, trainId);

      harness.placeAtFacility(trainId, 'prefabrication-plant');
      for (let batch = 0; batch < 3; batch += 1) {
        const result = harness.advanceStoppedTick();
        expect(result.cargoStatuses[0]).toMatchObject({
          kind: 'unloading',
          productId: 'structural-timber',
          batchUnits: 10,
        });
        unloadingBatchRevenue.push(result.cargoStatuses[0].batchRevenue);
        completedDeliveries.push(...result.completedDeliveries);
      }
      expect(completedDeliveries).toHaveLength(3);
      expect(completedDeliveries.map(({ productId, units }) => ({
        productId,
        units,
      }))).toEqual([
        { productId: 'logs', units: 60 },
        { productId: 'logs', units: 60 },
        { productId: 'structural-timber', units: 60 },
      ]);
      const observedDeliveryRevenue = [0, 1, 2].map((deliveryIndex) =>
        unloadingBatchRevenue
          .slice(deliveryIndex * 6, deliveryIndex * 6 + 6)
          .reduce((total, revenue) => total + revenue, 0));
      expect(unloadingBatchRevenue).toHaveLength(18);
      expect(observedDeliveryRevenue).toEqual(
        completedDeliveries.map(({ revenue }) => revenue),
      );
      const timberDelivery = completedDeliveries[2];
      expect(timberDelivery).toMatchObject({
        trainId,
        destinationFacilityId: 'prefabrication-plant',
        runningCost: 20,
      });
      expect(timberDelivery.operatingProfit).toBeGreaterThan(0);
      assertCheckpoint(harness, trainId);

      const achieved = harness.world;
      const achievedTrain = train(harness, trainId);
      const forest = facility(harness, 'managed-forest');
      const sawmill = facility(harness, 'sawmill');
      const prefab = facility(harness, 'prefabrication-plant');
      const deliveryEntries = achieved.company.ledger.filter(
        ({ category }) => category === 'delivery-revenue',
      );
      const runningEntries = achieved.company.ledger.filter(
        ({ category }) => category === 'train-running-cost',
      );
      const grants = achieved.company.ledger.filter(
        ({ category, referenceId }) => category === 'contract-bonus'
          && referenceId === 'regional-development-grant:v1',
      );
      const capex = achieved.company.ledger.filter(
        ({ category }) => category === 'construction-capex'
          || category === 'vehicle-capex',
      ).reduce((total, entry) => total - entry.amount, 0);
      const deliveryRevenue = deliveryEntries.reduce(
        (total, entry) => total + entry.amount,
        0,
      );
      const observedRevenueTotal = unloadingBatchRevenue.reduce(
        (total, revenue) => total + revenue,
        0,
      );
      const runningExpense = runningEntries.reduce(
        (total, entry) => total - entry.amount,
        0,
      );

      expect(deliveryEntries).toHaveLength(18);
      expect(new Set(
        deliveryEntries.map(({ referenceId }) => referenceId),
      ).size)
        .toBe(18);
      expect(runningEntries).toHaveLength(4);
      expect(runningExpense).toBe(80);
      expect(grants).toEqual([
        expect.objectContaining({
          amount: REGIONAL_DEVELOPMENT_GRANT,
          referenceId: 'regional-development-grant:v1',
        }),
      ]);
      expect(achieved.freightProgress).toEqual({
        progressVersion: 1,
        profitableLogDeliveryCompleted: true,
        developmentGrantAwarded: true,
        profitableStructuralTimberDeliveryCompleted: true,
      });
      expect(achievedTrain.operations).toMatchObject({
        lifetimeDeliveredUnits: 180,
        lifetimeRevenue: observedRevenueTotal,
        lifetimeRunningCost: runningExpense,
        lastTripRevenue: timberDelivery.revenue,
        lastTripRunningCost: timberDelivery.runningCost,
        currentTripRevenue: 0,
        currentTripRunningCost: 0,
      });
      expect(deliveryRevenue).toBe(observedRevenueTotal);
      expect(achieved.company.cash).toBe(achieved.company.ledger.reduce(
        (total, entry) => total + entry.amount,
        0,
      ));
      expect(achieved.company.cash).toBe(
        openingCash
        - capex
        + observedRevenueTotal
        + REGIONAL_DEVELOPMENT_GRANT
        - runningExpense,
      );

      expect(forest.inventories.logs.recentOutflow).toBe(120);
      expect(sawmill.inventories.logs.recentInflow).toBe(120);
      expect(sawmill.inventories['structural-timber'].recentOutflow).toBe(60);
      expect(prefab.inventories['structural-timber'].recentInflow).toBe(60);
      expect(
        openingForestLogs + forest.inventories.logs.recentInflow,
      ).toBe(
        forest.inventories.logs.quantity
        + sawmill.inventories.logs.quantity
        + (achievedTrain.cargo?.productId === 'logs'
          ? achievedTrain.cargo.units
          : 0)
        + sawmill.inventories.logs.recentOutflow,
      );
      expect(
        openingTimber
        + sawmill.inventories['structural-timber'].recentInflow,
      ).toBe(
        sawmill.inventories['structural-timber'].quantity
        + (achievedTrain.cargo?.productId === 'structural-timber'
          ? achievedTrain.cargo.units
          : 0)
        + prefab.inventories['structural-timber'].quantity
        + prefab.inventories['structural-timber'].recentOutflow,
      );
      expect(prefab.inventories.cement.quantity).toBe(0);
      expect(prefab.inventories.steel.quantity).toBe(0);
      expect(prefab.recipeProgressTicks).toBe(0);
    } finally {
      harness.destroy();
    }
  });
});
