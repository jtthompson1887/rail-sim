/**
 * @jest-environment jsdom
 */

import { REGIONAL_DEVELOPMENT_GRANT } from '../../src/config/FreightProgression';
import type { WorldData } from '../../src/config/WorldData';
import type { EconomyUpdateResult } from '../../src/economy/EconomySystem';
import type { FacilityEconomyDef } from '../../src/economy/EconomyData';
import { summariseProfitAndLoss } from '../../src/economy/FinanceLedger';
import type { FreightDeliveryEvent } from '../../src/freight/CargoSystem';
import {
  FLATBED_FREIGHT_SET_ID,
} from '../../src/freight/FreightSetCatalog';
import { WorldManager } from '../../src/managers/WorldManager';
import {
  createRegionalConstructionSupplyHarness,
  type RegionalConstructionSupplyHarness,
} from '../fixtures/RegionalConstructionSupplyFixture';

const PRODUCT_IDS = [
  'logs',
  'structural-timber',
  'limestone-aggregate',
  'cement',
  'steel',
  'building-modules',
] as const;

type ProductId = typeof PRODUCT_IDS[number];
type ProductTotals = Readonly<Record<ProductId, number>>;

const facility = (
  world: WorldData,
  definitionId: string,
): FacilityEconomyDef => {
  const found = world.economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!found) throw new Error(`Missing ${definitionId}`);
  return found;
};

const inventory = (
  world: WorldData,
  definitionId: string,
  productId: ProductId,
) => {
  const slot = facility(world, definitionId).inventories[productId];
  if (!slot) throw new Error(`Missing ${definitionId} ${productId}`);
  return slot;
};

const currentProductTotals = (world: WorldData): ProductTotals =>
  Object.freeze(Object.fromEntries(PRODUCT_IDS.map((productId) => [
    productId,
    world.economy.facilities.reduce(
      (total, candidate) =>
        total + (candidate.inventories[productId]?.quantity ?? 0),
      0,
    ) + world.trains.reduce(
      (total, train) => total
        + (train.cargo?.productId === productId ? train.cargo.units : 0),
      0,
    ),
  ])) as Record<ProductId, number>);

const expectedProductTotals = (
  opening: ProductTotals,
  world: WorldData,
): ProductTotals => Object.freeze({
  logs: opening.logs
    + inventory(world, 'managed-forest', 'logs').recentInflow
    - inventory(world, 'sawmill', 'logs').recentOutflow,
  'structural-timber': opening['structural-timber']
    + inventory(
      world,
      'sawmill',
      'structural-timber',
    ).recentInflow
    - inventory(
      world,
      'prefabrication-plant',
      'structural-timber',
    ).recentOutflow,
  'limestone-aggregate': opening['limestone-aggregate']
    + inventory(
      world,
      'quarry',
      'limestone-aggregate',
    ).recentInflow
    - inventory(
      world,
      'cement-works',
      'limestone-aggregate',
    ).recentOutflow,
  cement: opening.cement
    + inventory(world, 'cement-works', 'cement').recentInflow
    - inventory(
      world,
      'prefabrication-plant',
      'cement',
    ).recentOutflow,
  steel: opening.steel
    - inventory(
      world,
      'prefabrication-plant',
      'steel',
    ).recentOutflow,
  'building-modules': opening['building-modules']
    + inventory(
      world,
      'prefabrication-plant',
      'building-modules',
    ).recentInflow,
});

const expectConserved = (
  opening: ProductTotals,
  world: WorldData,
): void => {
  expect(currentProductTotals(world)).toEqual(
    expectedProductTotals(opening, world),
  );
};

const train = (
  harness: RegionalConstructionSupplyHarness,
  trainId: string,
) => {
  const found = harness.world.trains.find(({ id }) => id === trainId);
  if (!found) throw new Error(`Missing ${trainId}`);
  return found;
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

const categoryMagnitude = (
  world: WorldData,
  category: WorldData['company']['ledger'][number]['category'],
): number => world.company.ledger
  .filter((entry) => entry.category === category)
  .reduce((total, entry) => total + Math.abs(entry.amount), 0);

describe('Integration: complete regional construction supply', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    WorldManager.reset();
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it('constructs, supplies, persists, and reconciles the complete regional chain', () => {
    const harness = createRegionalConstructionSupplyHarness('playtest-825');
    const completedDeliveries: FreightDeliveryEvent[] = [];
    const batchRevenue: number[] = [];
    try {
      const opening = harness.world;
      const openingCash = opening.company.cash;
      const openingProducts = currentProductTotals(opening);

      const cementComplete = harness.completeCementPrerequisite();
      completedDeliveries.push(...cementComplete.completedDeliveries);
      batchRevenue.push(...cementComplete.batchRevenue);
      expect(harness.world.freightProgress).toEqual({
        progressVersion: 1,
        profitableLogDeliveryCompleted: true,
        developmentGrantAwarded: true,
        profitableStructuralTimberDeliveryCompleted: true,
        profitableLimestoneDeliveryCompleted: true,
        profitableCementDeliveryCompleted: true,
        profitableSteelDeliveryCompleted: false,
        profitableBuildingModuleDeliveryCompleted: false,
      });
      expect(train(harness, cementComplete.flatbedTrainId)).toMatchObject({
        freightSetId: FLATBED_FREIGHT_SET_ID,
        cargo: null,
      });
      expect(inventory(
        harness.world,
        'prefabrication-plant',
        'structural-timber',
      ).quantity).toBeGreaterThanOrEqual(8);
      expect(inventory(
        harness.world,
        'prefabrication-plant',
        'cement',
      ).quantity).toBe(80);
      expectConserved(openingProducts, harness.world);

      const regional = harness.buildRegionalExtensions();
      expect(regional.totalConstructionCost).toBeLessThanOrEqual(60_000);
      expect(regional.portConnections).toBe(1);
      expect(regional.townConnections).toBe(1);
      expectConserved(openingProducts, harness.world);

      const flatbedTrainId = cementComplete.flatbedTrainId;
      harness.placeAtFacility(flatbedTrainId, 'port-interchange');
      for (let batch = 0; batch < 6; batch += 1) {
        const result = harness.advanceStoppedTick();
        expect(cargoStatus(result, flatbedTrainId)).toMatchObject({
          kind: 'loading',
          productId: 'steel',
          batchUnits: 10,
          batchRevenue: 0,
        });
        expectConserved(openingProducts, harness.world);
      }
      expect(train(harness, flatbedTrainId).cargo).toMatchObject({
        productId: 'steel',
        units: 60,
        loadedUnits: 60,
        originFacilityId: facility(
          harness.world,
          'port-interchange',
        ).id,
      });
      expect(inventory(
        harness.world,
        'port-interchange',
        'steel',
      ).quantity).toBe(60);

      harness.placeOnRegionalRoute(flatbedTrainId, 'steel');
      const steelTransit = harness.advanceActiveTick(flatbedTrainId);
      expect(cargoStatus(steelTransit, flatbedTrainId)).toMatchObject({
        kind: 'blocked',
        blocker: 'train-moving',
        batchUnits: 0,
      });

      harness.placeAtFacility(flatbedTrainId, 'prefabrication-plant');
      const timberBeforeSteel = inventory(
        harness.world,
        'prefabrication-plant',
        'structural-timber',
      ).quantity;
      const cementBeforeSteel = inventory(
        harness.world,
        'prefabrication-plant',
        'cement',
      ).quantity;
      let steelDelivery: FreightDeliveryEvent | undefined;
      for (let batch = 1; batch <= 6; batch += 1) {
        const result = harness.advanceStoppedTick();
        const status = cargoStatus(result, flatbedTrainId);
        expect(status).toMatchObject({
          kind: 'unloading',
          productId: 'steel',
          batchUnits: 10,
        });
        batchRevenue.push(status.batchRevenue);
        completedDeliveries.push(...result.completedDeliveries);
        expect(inventory(
          harness.world,
          'prefabrication-plant',
          'steel',
        ).quantity).toBe(batch < 6 ? batch * 10 : 54);
        expect(facility(
          harness.world,
          'prefabrication-plant',
        ).recipeProgressTicks).toBe(batch < 6 ? batch : 0);
        expect(inventory(
          harness.world,
          'prefabrication-plant',
          'building-modules',
        ).quantity).toBe(batch < 6 ? 0 : 4);
        expect(inventory(
          harness.world,
          'prefabrication-plant',
          'structural-timber',
        ).quantity).toBe(
          batch < 6 ? timberBeforeSteel : timberBeforeSteel - 8,
        );
        expect(inventory(
          harness.world,
          'prefabrication-plant',
          'cement',
        ).quantity).toBe(
          batch < 6 ? cementBeforeSteel : cementBeforeSteel - 8,
        );
        expectConserved(openingProducts, harness.world);
        if (batch === 6) {
          [steelDelivery] = result.completedDeliveries;
        }
      }
      expect(steelDelivery).toMatchObject({
        trainId: flatbedTrainId,
        productId: 'steel',
        units: 60,
        destinationFacilityId: facility(
          harness.world,
          'prefabrication-plant',
        ).id,
        runningCost: 20,
      });
      expect(steelDelivery?.operatingProfit).toBeGreaterThan(0);
      expect(harness.world.freightProgress
        .profitableSteelDeliveryCompleted).toBe(true);
      expect(inventory(
        harness.world,
        'prefabrication-plant',
        'steel',
      ).quantity).toBe(54);
      expect(inventory(
        harness.world,
        'prefabrication-plant',
        'building-modules',
      ).quantity).toBe(4);

      harness.placeAtFacility(flatbedTrainId, 'prefabrication-plant');
      const moduleLoad = harness.advanceStoppedTick();
      expect(cargoStatus(moduleLoad, flatbedTrainId)).toMatchObject({
        kind: 'loading',
        productId: 'building-modules',
        batchUnits: 4,
        batchRevenue: 0,
      });
      expect(train(harness, flatbedTrainId).cargo).toMatchObject({
        productId: 'building-modules',
        units: 4,
        loadedUnits: 4,
        originFacilityId: facility(
          harness.world,
          'prefabrication-plant',
        ).id,
      });
      expectConserved(openingProducts, harness.world);

      const checkpoint = harness.saveReload();
      expect(checkpoint.detached).toEqual(checkpoint.expected);
      expect(harness.world).toEqual(checkpoint.expected);
      const expectedTrainIds = checkpoint.expected.trains
        .map(({ id }) => id)
        .sort();
      expect(checkpoint.savedRuntimeTrainIds).toEqual(expectedTrainIds);
      expect(checkpoint.restoredRuntimeTrainIds).toEqual(expectedTrainIds);
      expect(checkpoint.savedRuntimeTrainIds).toHaveLength(
        expectedTrainIds.length,
      );
      expect(checkpoint.restoredRuntimeTrainIds).toHaveLength(
        expectedTrainIds.length,
      );
      expect(new Set(checkpoint.savedRuntimeTrainIds).size)
        .toBe(expectedTrainIds.length);
      expect(new Set(checkpoint.restoredRuntimeTrainIds).size)
        .toBe(expectedTrainIds.length);
      expect(Object.keys(checkpoint.savedRuntimeByTrainId).sort())
        .toEqual(expectedTrainIds);
      expect(Object.keys(checkpoint.restoredRuntimeByTrainId).sort())
        .toEqual(expectedTrainIds);
      expect(Object.keys(checkpoint.savedAuthorityByTrainId).sort())
        .toEqual(expectedTrainIds);
      expect(Object.keys(checkpoint.restoredAuthorityByTrainId).sort())
        .toEqual(expectedTrainIds);
      expect(new Set(expectedTrainIds).size).toBe(expectedTrainIds.length);
      expectedTrainIds.forEach((trainId) => {
        const authority = checkpoint.savedAuthorityByTrainId[trainId];
        expect(checkpoint.restoredAuthorityByTrainId[trainId])
          .toEqual(authority);
        const savedRuntime = checkpoint.savedRuntimeByTrainId[trainId];
        const restoredRuntime = checkpoint.restoredRuntimeByTrainId[trainId];
        expect(savedRuntime).toEqual({
          trainId,
          trackUUID: authority.trackUUID,
          trackT: authority.trackT,
          facing: authority.facing,
          x: savedRuntime.x,
          y: savedRuntime.y,
          speedWorldUnitsPerSecond: 0,
          throttle: 0,
          derailed: false,
        });
        expect(Number.isFinite(savedRuntime.x)).toBe(true);
        expect(Number.isFinite(savedRuntime.y)).toBe(true);
        expect(restoredRuntime).toMatchObject({
          trainId,
          trackUUID: authority.trackUUID,
          facing: authority.facing,
          speedWorldUnitsPerSecond: 0,
          throttle: 0,
          derailed: false,
        });
        expect(restoredRuntime.trackT).toBeCloseTo(authority.trackT, 3);
        expect(Object.keys(restoredRuntime).sort()).toEqual([
          'derailed',
          'facing',
          'speedWorldUnitsPerSecond',
          'throttle',
          'trackT',
          'trackUUID',
          'trainId',
          'x',
          'y',
        ]);
        expect(Math.hypot(
          restoredRuntime.x - savedRuntime.x,
          restoredRuntime.y - savedRuntime.y,
        )).toBeLessThan(0.5);
      });
      expect(checkpoint.savedTrackIds).toEqual(
        checkpoint.expected.tracks.map(({ uuid }) => uuid).sort(),
      );
      expect(checkpoint.restoredTrackIds).toEqual(checkpoint.savedTrackIds);
      expect(checkpoint.restoredTopology).toEqual(checkpoint.savedTopology);
      expectConserved(openingProducts, harness.world);

      harness.placeOnRegionalRoute(flatbedTrainId, 'modules');
      const moduleTransit = harness.advanceActiveTick(flatbedTrainId);
      expect(cargoStatus(moduleTransit, flatbedTrainId)).toMatchObject({
        kind: 'blocked',
        blocker: 'train-moving',
        batchUnits: 0,
      });
      harness.placeAtFacility(
        flatbedTrainId,
        'town-construction-market',
      );
      const moduleUnload = harness.advanceStoppedTick();
      const moduleStatus = cargoStatus(moduleUnload, flatbedTrainId);
      batchRevenue.push(moduleStatus.batchRevenue);
      completedDeliveries.push(...moduleUnload.completedDeliveries);
      expect(moduleStatus).toMatchObject({
        kind: 'unloading',
        productId: 'building-modules',
        batchUnits: 4,
      });
      expect(moduleUnload.completedDeliveries).toEqual([
        expect.objectContaining({
          trainId: flatbedTrainId,
          productId: 'building-modules',
          units: 4,
          destinationFacilityId: facility(
            harness.world,
            'town-construction-market',
          ).id,
          runningCost: 20,
        }),
      ]);
      expect(moduleUnload.completedDeliveries[0].operatingProfit)
        .toBe(moduleUnload.completedDeliveries[0].revenue - 20);
      expect(moduleUnload.completedDeliveries[0].operatingProfit)
        .toBeGreaterThan(0);
      expect(train(harness, flatbedTrainId).cargo).toBeNull();
      expect(inventory(
        harness.world,
        'town-construction-market',
        'building-modules',
      ).quantity).toBe(4);
      expectConserved(openingProducts, harness.world);

      expect(harness.world.freightProgress).toMatchObject({
        profitableSteelDeliveryCompleted: true,
        profitableBuildingModuleDeliveryCompleted: true,
      });
      expect(harness.deriveObjective()).toEqual(expect.objectContaining({
        id: 'regional-construction-supply',
        achieved: true,
        status: 'Regional construction supplied · Network ready to automate',
        steps: [
          expect.objectContaining({ id: 'connect-port', state: 'complete' }),
          expect.objectContaining({
            id: 'deliver-steel-profitably',
            state: 'complete',
          }),
          expect.objectContaining({
            id: 'assemble-building-modules',
            state: 'complete',
          }),
          expect.objectContaining({ id: 'connect-town', state: 'complete' }),
          expect.objectContaining({
            id: 'deliver-building-modules-profitably',
            state: 'complete',
          }),
        ],
      }));

      const achieved = harness.world;
      const expectedConstructionCapex =
        cementComplete.totalConstructionCost
        + regional.totalConstructionCost;
      const expectedVehicleCapex = 90_000 + 110_000 + 105_000;
      const expectedRunningExpense = 142;
      const observedRevenue = batchRevenue.reduce(
        (total, amount) => total + amount,
        0,
      );
      expect(completedDeliveries.reduce(
        (total, delivery) => total + delivery.revenue,
        0,
      )).toBe(observedRevenue);
      expect(categoryMagnitude(achieved, 'construction-capex'))
        .toBe(expectedConstructionCapex);
      expect(categoryMagnitude(achieved, 'vehicle-capex'))
        .toBe(expectedVehicleCapex);
      expect(categoryMagnitude(achieved, 'contract-bonus'))
        .toBe(REGIONAL_DEVELOPMENT_GRANT);
      expect(categoryMagnitude(achieved, 'delivery-revenue'))
        .toBe(observedRevenue);
      expect(categoryMagnitude(achieved, 'train-running-cost'))
        .toBe(expectedRunningExpense);
      expect(achieved.company.cash).toBe(
        openingCash
        - expectedConstructionCapex
        - expectedVehicleCapex
        + observedRevenue
        + REGIONAL_DEVELOPMENT_GRANT
        - expectedRunningExpense,
      );
      expect(achieved.company.cash).toBe(achieved.company.ledger.reduce(
        (total, entry) => total + entry.amount,
        0,
      ));
      expect(summariseProfitAndLoss(
        achieved.company,
        0,
        achieved.economy.tick,
      )).toEqual({
        deliveryRevenue: observedRevenue,
        contractBonuses: REGIONAL_DEVELOPMENT_GRANT,
        operatingExpenses: expectedRunningExpense,
        railwayOperatingProfit: observedRevenue - expectedRunningExpense,
        capitalExpenditure:
          expectedConstructionCapex + expectedVehicleCapex,
        cashFlow: achieved.company.cash,
      });
    } finally {
      harness.destroy();
    }
  });
});
