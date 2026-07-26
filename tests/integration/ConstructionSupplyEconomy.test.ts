import type {
  CompanyStateDef,
  FacilityDefinition,
  FacilityEconomyDef,
  InventorySlotDef,
  RecipeDefinition,
} from '../../src/economy/EconomyData';
import {
  createCompanyState,
  postLedgerEntry,
  summariseProfitAndLoss,
} from '../../src/economy/FinanceLedger';
import {
  INITIAL_FACILITY_DEFINITIONS,
  INITIAL_RECIPES,
} from '../../src/economy/InitialEconomyContent';
import {
  advanceFacilityRecipe,
  applyFacilityBoundary,
  IndustryTickResult,
} from '../../src/economy/IndustrySystem';
import { transferProduct } from '../../src/economy/Inventory';
import { applyConstructionTransaction } from '../../src/systems/ConstructionEconomy';
import {
  ECONOMY_TICK_MS,
  EconomySystem,
} from '../../src/economy/EconomySystem';
import { WorldManager } from '../../src/managers/WorldManager';
import { installFirstFreightRoutePhase } from '../fixtures/FirstFreightRouteFixture';

const requireDefinition = (id: string): FacilityDefinition => {
  const definition = INITIAL_FACILITY_DEFINITIONS.find(
    (candidate) => candidate.id === id,
  );
  if (definition === undefined) {
    throw new Error(`Missing facility definition ${id}`);
  }
  return definition;
};

const requireRecipe = (id: string): RecipeDefinition => {
  const recipe = INITIAL_RECIPES.find((candidate) => candidate.id === id);
  if (recipe === undefined) {
    throw new Error(`Missing recipe ${id}`);
  }
  return recipe;
};

const createFacility = (
  definition: FacilityDefinition,
): FacilityEconomyDef => {
  const inventories: Record<string, InventorySlotDef> = {};
  definition.inventory.forEach((slot) => {
    inventories[slot.productId] = {
      productId: slot.productId,
      quantity: slot.initialQuantity,
      reservedQuantity: 0,
      capacity: slot.capacity,
      recentInflow: 0,
      recentOutflow: 0,
      targetStock: slot.targetStock,
    };
  });
  return {
    id: definition.id,
    definitionId: definition.id,
    name: definition.displayName,
    x: 0,
    y: 0,
    railAccess: { x: 0, y: 0, radius: 1 },
    inventories,
    activeRecipeId: definition.recipeIds[0] ?? null,
    recipeProgressTicks: 0,
  };
};

const advanceTicks = (
  initial: FacilityEconomyDef,
  recipeId: string,
  ticks: number,
): IndustryTickResult => {
  const recipe = requireRecipe(recipeId);
  let result: IndustryTickResult = {
    facility: initial,
    blocker: 'idle',
    completedBatches: 0,
    productDeltas: [],
    receipts: [],
  };
  for (let tick = 0; tick < ticks; tick += 1) {
    result = advanceFacilityRecipe(result.facility, recipe);
  }
  return result;
};

const totalProduct = (
  facilities: Record<string, FacilityEconomyDef>,
  productId: string,
): number => Object.values(facilities).reduce(
  (total, facility) => total
    + (facility.inventories[productId]?.quantity ?? 0),
  0,
);

describe('Integration: complete construction-supply economy', () => {
  it('reconciles all six products through extraction, processing, import, transfer, and consumption', () => {
    const facilities = Object.fromEntries(
      INITIAL_FACILITY_DEFINITIONS.map((definition) => [
        definition.id,
        createFacility(definition),
      ]),
    ) as Record<string, FacilityEconomyDef>;

    const transfer = (
      sourceId: string,
      destinationId: string,
      productId: string,
      requestedUnits: number,
    ): void => {
      const result = transferProduct(
        facilities[sourceId].inventories[productId],
        facilities[destinationId].inventories[productId],
        requestedUnits,
      );
      expect(result).toMatchObject({
        movedUnits: requestedUnits,
        reason: 'moved',
      });
      if (result.reason !== 'moved') {
        throw new Error(
          `Transfer ${productId} from ${sourceId} to ${destinationId} failed`,
        );
      }
      facilities[sourceId] = {
        ...facilities[sourceId],
        inventories: {
          ...facilities[sourceId].inventories,
          [productId]: result.source,
        },
      };
      facilities[destinationId] = {
        ...facilities[destinationId],
        inventories: {
          ...facilities[destinationId].inventories,
          [productId]: result.destination,
        },
      };
    };

    const forestBeforeCompletion = advanceTicks(
      facilities['managed-forest'],
      'forest-harvest',
      3,
    );
    expect(forestBeforeCompletion).toMatchObject({
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility: {
        recipeProgressTicks: 3,
        inventories: { logs: { quantity: 60 } },
      },
    });
    const forestCompletion = advanceTicks(
      forestBeforeCompletion.facility,
      'forest-harvest',
      1,
    );
    expect(forestCompletion).toMatchObject({
      completedBatches: 1,
      productDeltas: [{ productId: 'logs', units: 8 }],
      receipts: [{
        facilityId: 'managed-forest',
        productId: 'logs',
        units: 8,
        kind: 'resource-extraction',
      }],
    });
    facilities['managed-forest'] = forestCompletion.facility;

    const quarryCompletion = advanceTicks(
      facilities.quarry,
      'quarry-extraction',
      4,
    );
    expect(quarryCompletion).toMatchObject({
      completedBatches: 1,
      productDeltas: [{ productId: 'limestone-aggregate', units: 10 }],
      receipts: [{
        facilityId: 'quarry',
        productId: 'limestone-aggregate',
        units: 10,
        kind: 'resource-extraction',
      }],
    });
    facilities.quarry = quarryCompletion.facility;

    const steelImport = applyFacilityBoundary(
      facilities['port-interchange'],
      requireDefinition('port-interchange'),
      'steel',
      6,
      'import',
    );
    expect(steelImport).toMatchObject({
      acceptedUnits: 6,
      kind: 'import',
      receipt: {
        facilityId: 'port-interchange',
        productId: 'steel',
        units: 6,
        kind: 'import',
      },
    });
    facilities['port-interchange'] = steelImport.facility;

    transfer('managed-forest', 'sawmill', 'logs', 10);
    const sawmillCompletion = advanceTicks(
      facilities.sawmill,
      'sawmill-cut',
      3,
    );
    expect(sawmillCompletion).toMatchObject({
      completedBatches: 1,
      productDeltas: [
        { productId: 'logs', units: -10 },
        { productId: 'structural-timber', units: 8 },
      ],
      receipts: [],
    });
    facilities.sawmill = sawmillCompletion.facility;
    transfer('sawmill', 'prefabrication-plant', 'structural-timber', 8);

    transfer('quarry', 'cement-works', 'limestone-aggregate', 12);
    const cementCompletion = advanceTicks(
      facilities['cement-works'],
      'cement-kiln',
      4,
    );
    expect(cementCompletion).toMatchObject({
      completedBatches: 1,
      productDeltas: [
        { productId: 'limestone-aggregate', units: -12 },
        { productId: 'cement', units: 8 },
      ],
      receipts: [],
    });
    facilities['cement-works'] = cementCompletion.facility;
    transfer('cement-works', 'prefabrication-plant', 'cement', 8);

    transfer('port-interchange', 'prefabrication-plant', 'steel', 6);
    const moduleCompletion = advanceTicks(
      facilities['prefabrication-plant'],
      'module-assembly',
      6,
    );
    expect(moduleCompletion).toMatchObject({
      completedBatches: 1,
      productDeltas: [
        { productId: 'structural-timber', units: -8 },
        { productId: 'cement', units: -8 },
        { productId: 'steel', units: -6 },
        { productId: 'building-modules', units: 4 },
      ],
      receipts: [],
    });
    facilities['prefabrication-plant'] = moduleCompletion.facility;

    transfer(
      'prefabrication-plant',
      'town-construction-market',
      'building-modules',
      4,
    );
    const consumption = applyFacilityBoundary(
      facilities['town-construction-market'],
      requireDefinition('town-construction-market'),
      'building-modules',
      4,
      'consumption',
    );
    expect(consumption).toMatchObject({
      acceptedUnits: 4,
      kind: 'consumption',
      receipt: {
        facilityId: 'town-construction-market',
        productId: 'building-modules',
        units: 4,
        kind: 'consumption',
      },
    });
    facilities['town-construction-market'] = consumption.facility;

    expect({
      logs: totalProduct(facilities, 'logs'),
      'structural-timber': totalProduct(facilities, 'structural-timber'),
      'limestone-aggregate': totalProduct(
        facilities,
        'limestone-aggregate',
      ),
      cement: totalProduct(facilities, 'cement'),
      steel: totalProduct(facilities, 'steel'),
      'building-modules': totalProduct(facilities, 'building-modules'),
    }).toEqual({
      logs: 58,
      'structural-timber': 0,
      'limestone-aggregate': 73,
      cement: 0,
      steel: 120,
      'building-modules': 0,
    });

    const reconciliation = [
      {
        productId: 'logs',
        opening: 60,
        boundaryInflow: 8,
        processingOutput: 0,
        processingInput: 10,
        boundaryOutflow: 0,
        closing: 58,
      },
      {
        productId: 'structural-timber',
        opening: 0,
        boundaryInflow: 0,
        processingOutput: 8,
        processingInput: 8,
        boundaryOutflow: 0,
        closing: 0,
      },
      {
        productId: 'limestone-aggregate',
        opening: 75,
        boundaryInflow: 10,
        processingOutput: 0,
        processingInput: 12,
        boundaryOutflow: 0,
        closing: 73,
      },
      {
        productId: 'cement',
        opening: 0,
        boundaryInflow: 0,
        processingOutput: 8,
        processingInput: 8,
        boundaryOutflow: 0,
        closing: 0,
      },
      {
        productId: 'steel',
        opening: 120,
        boundaryInflow: 6,
        processingOutput: 0,
        processingInput: 6,
        boundaryOutflow: 0,
        closing: 120,
      },
      {
        productId: 'building-modules',
        opening: 0,
        boundaryInflow: 0,
        processingOutput: 4,
        processingInput: 0,
        boundaryOutflow: 4,
        closing: 0,
      },
    ];
    reconciliation.forEach((row) => {
      expect(
        row.opening
          + row.boundaryInflow
          + row.processingOutput
          - row.processingInput
          - row.boundaryOutflow,
      ).toBe(row.closing);
    });
  });

  it('reconciles every company cash mutation to the ledger while separating operating P&L from construction capex', () => {
    const opening = createCompanyState(500_000);
    const construction = applyConstructionTransaction(opening, {
      kind: 'purchase',
      magnitude: 20_000,
      referenceId: 'full-chain-test-track',
      direction: 'forward',
    }, 1);
    expect(construction.ok).toBe(true);
    if (construction.ok === false) {
      throw new Error(`Construction posting failed: ${construction.code}`);
    }
    expect(construction.entry.amount).toBe(-20_000);
    expect(construction.company.cash - opening.cash)
      .toBe(construction.entry.amount);

    const delivery = postLedgerEntry(construction.company, {
      category: 'delivery-revenue',
      magnitude: 1_200,
      tick: 2,
      referenceId: 'full-chain-test-delivery',
      direction: 'forward',
    });
    expect(delivery.ok).toBe(true);
    if (delivery.ok === false) {
      throw new Error(`Delivery posting failed: ${delivery.code}`);
    }
    expect(delivery.entry.amount).toBe(1_200);
    expect(delivery.company.cash - construction.company.cash)
      .toBe(delivery.entry.amount);

    const runningCost = postLedgerEntry(delivery.company, {
      category: 'train-running-cost',
      magnitude: 300,
      tick: 3,
      referenceId: 'full-chain-test-running-cost',
      direction: 'forward',
    });
    expect(runningCost.ok).toBe(true);
    if (runningCost.ok === false) {
      throw new Error(`Running-cost posting failed: ${runningCost.code}`);
    }
    expect(runningCost.entry.amount).toBe(-300);
    expect(runningCost.company.cash - delivery.company.cash)
      .toBe(runningCost.entry.amount);

    const finalCompany: CompanyStateDef = runningCost.company;
    expect(finalCompany.ledger.map((entry) => entry.amount))
      .toEqual([500_000, -20_000, 1_200, -300]);
    expect(finalCompany.ledger.reduce(
      (cash, entry) => cash + entry.amount,
      0,
    )).toBe(finalCompany.cash);
    expect(finalCompany.cash).toBe(480_900);
    expect(summariseProfitAndLoss(finalCompany, 1, 3)).toEqual({
      revenue: 1_200,
      operatingExpenses: 300,
      operatingProfit: 900,
      capitalExpenditure: 20_000,
      cashFlow: -19_100,
    });
  });

  it('posts exactly one aggregate running-cost entry per tick and preserves lifetime attribution', () => {
    localStorage.clear();
    const world = installFirstFreightRoutePhase({ cash: 1_000 });
    const economy = new EconomySystem(WorldManager);
    const runtime = [{
      trainId: 'train-1',
      trackUUID: 'forest-sawmill-track',
      trackT: 0.5,
      facing: 1 as const,
      x: 0,
      y: 0,
      speedWorldUnitsPerSecond: 12,
      throttle: 1 as const,
      derailed: false,
    }];

    for (let tick = 1; tick <= 3; tick += 1) {
      expect(economy.update(
        ECONOMY_TICK_MS,
        true,
        runtime,
      ).ticksAdvanced).toBe(1);
      expect(world.trains[0].operations.lifetimeRunningCost).toBe(tick * 20);
    }

    expect(world.company.cash).toBe(940);
    expect(world.company.ledger.filter(
      ({ category }) => category === 'train-running-cost',
    )).toEqual([
      expect.objectContaining({
        tick: 1,
        amount: -20,
        referenceId: 'active-trains:1',
      }),
      expect.objectContaining({
        tick: 2,
        amount: -20,
        referenceId: 'active-trains:2',
      }),
      expect.objectContaining({
        tick: 3,
        amount: -20,
        referenceId: 'active-trains:3',
      }),
    ]);
    WorldManager.reset();
    localStorage.clear();
  });
});
