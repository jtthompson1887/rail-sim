import {
  FacilityDefinition,
  FacilityEconomyDef,
  InventorySlotDef,
  RecipeDefinition,
} from '../../src/economy/EconomyData';
import {
  INITIAL_FACILITY_DEFINITIONS,
  INITIAL_RECIPES,
} from '../../src/economy/InitialEconomyContent';
import {
  advanceFacilityRecipe,
  applyFacilityBoundary,
} from '../../src/economy/IndustrySystem';

const makeSlot = (
  productId: string,
  overrides: Partial<InventorySlotDef> = {},
): InventorySlotDef => ({
  productId,
  quantity: 0,
  reservedQuantity: 0,
  capacity: 100,
  recentInflow: 0,
  recentOutflow: 0,
  targetStock: 50,
  ...overrides,
});

const makeFacility = (
  definitionId: string,
  activeRecipeId: string | null,
  inventories: Record<string, InventorySlotDef>,
  overrides: Partial<FacilityEconomyDef> = {},
): FacilityEconomyDef => ({
  id: `${definitionId}-1`,
  definitionId,
  name: definitionId,
  x: 100,
  y: 200,
  railAccess: { x: 110, y: 210, radius: 40 },
  inventories,
  activeRecipeId,
  recipeProgressTicks: 0,
  ...overrides,
});

const getRecipe = (id: string): RecipeDefinition =>
  INITIAL_RECIPES.find((recipe) => recipe.id === id);

const getDefinition = (id: string): FacilityDefinition =>
  INITIAL_FACILITY_DEFINITIONS.find((definition) => definition.id === id);

const advanceTicks = (
  initial: FacilityEconomyDef,
  recipe: RecipeDefinition,
  groupSizes: number[],
): FacilityEconomyDef => {
  let facility = initial;
  groupSizes.forEach((groupSize) => {
    for (let tick = 0; tick < groupSize; tick += 1) {
      facility = advanceFacilityRecipe(facility, recipe).facility;
    }
  });
  return facility;
};

describe('advanceFacilityRecipe', () => {
  it('completes forest extraction only on the fourth tick with a receipt', () => {
    const recipe = getRecipe('forest-harvest');
    let facility = makeFacility(
      'managed-forest',
      recipe.id,
      { logs: makeSlot('logs', { capacity: 8, targetStock: 4 }) },
    );

    for (let tick = 1; tick <= 3; tick += 1) {
      const result = advanceFacilityRecipe(facility, recipe);
      expect(result).toMatchObject({
        blocker: 'working',
        completedBatches: 0,
        productDeltas: [],
        receipts: [],
        facility: { recipeProgressTicks: tick },
      });
      facility = result.facility;
    }

    const completion = advanceFacilityRecipe(facility, recipe);

    expect(completion).toEqual({
      blocker: 'working',
      completedBatches: 1,
      productDeltas: [{ productId: 'logs', units: 8 }],
      receipts: [{
        facilityId: 'managed-forest-1',
        productId: 'logs',
        units: 8,
        kind: 'resource-extraction',
      }],
      facility: {
        ...facility,
        recipeProgressTicks: 0,
        inventories: {
          logs: makeSlot('logs', {
            quantity: 8,
            capacity: 8,
            targetStock: 4,
            recentInflow: 8,
          }),
        },
      },
    });

    const blocked = advanceFacilityRecipe(completion.facility, recipe);
    expect(blocked).toMatchObject({
      blocker: 'output-full',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility: { recipeProgressTicks: 0 },
    });
    expect(blocked.facility).toEqual(completion.facility);
  });

  it('waits for all required unreserved input before starting work', () => {
    const recipe = getRecipe('sawmill-cut');
    const facility = makeFacility('sawmill', recipe.id, {
      logs: makeSlot('logs', {
        quantity: 10,
        reservedQuantity: 1,
      }),
      'structural-timber': makeSlot('structural-timber'),
    });

    const result = advanceFacilityRecipe(facility, recipe);

    expect(result).toEqual({
      blocker: 'waiting-input',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility,
    });
    expect(result.facility).not.toBe(facility);
    expect(result.facility.inventories.logs)
      .not.toBe(facility.inventories.logs);
  });

  it('treats an invalid or missing input slot as waiting without throwing', () => {
    const recipe = getRecipe('sawmill-cut');
    const invalidSlotFacility = makeFacility('sawmill', recipe.id, {
      logs: makeSlot('logs', { quantity: -1 }),
      'structural-timber': makeSlot('structural-timber'),
    });
    const missingSlotFacility = makeFacility('sawmill', recipe.id, {
      'structural-timber': makeSlot('structural-timber'),
    });

    expect(advanceFacilityRecipe(invalidSlotFacility, recipe)).toEqual({
      blocker: 'waiting-input',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility: invalidSlotFacility,
    });
    expect(advanceFacilityRecipe(missingSlotFacility, recipe)).toEqual({
      blocker: 'waiting-input',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility: missingSlotFacility,
    });
  });

  it('treats a null runtime input slot as waiting without throwing', () => {
    const recipe = getRecipe('sawmill-cut');
    const facility = makeFacility('sawmill', recipe.id, {
      logs: null as any,
      'structural-timber': makeSlot('structural-timber'),
    });

    expect(advanceFacilityRecipe(facility, recipe)).toEqual({
      blocker: 'waiting-input',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility,
    });
  });

  it('treats a malformed runtime inventory collection as waiting', () => {
    const recipe = getRecipe('sawmill-cut');
    const facility = makeFacility('sawmill', recipe.id, null as any);

    expect(advanceFacilityRecipe(facility, recipe)).toEqual({
      blocker: 'waiting-input',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility,
    });
  });

  it('does not consume input when the complete output batch will not fit', () => {
    const recipe = getRecipe('sawmill-cut');
    const facility = makeFacility(
      'sawmill',
      recipe.id,
      {
        logs: makeSlot('logs', { quantity: 20 }),
        'structural-timber': makeSlot('structural-timber', {
          quantity: 95,
          capacity: 100,
        }),
      },
      { recipeProgressTicks: 2 },
    );

    const result = advanceFacilityRecipe(facility, recipe);

    expect(result).toEqual({
      blocker: 'output-full',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility,
    });
    expect(facility.inventories.logs.quantity).toBe(20);
  });

  it('atomically consumes ten logs and creates eight timber on completion', () => {
    const recipe = getRecipe('sawmill-cut');
    const facility = makeFacility(
      'sawmill',
      recipe.id,
      {
        logs: makeSlot('logs', { quantity: 20 }),
        'structural-timber': makeSlot('structural-timber', { quantity: 5 }),
      },
      { recipeProgressTicks: 2 },
    );

    const result = advanceFacilityRecipe(facility, recipe);

    expect(result).toEqual({
      blocker: 'working',
      completedBatches: 1,
      productDeltas: [
        { productId: 'logs', units: -10 },
        { productId: 'structural-timber', units: 8 },
      ],
      receipts: [],
      facility: {
        ...facility,
        recipeProgressTicks: 0,
        inventories: {
          logs: makeSlot('logs', {
            quantity: 10,
            recentOutflow: 10,
          }),
          'structural-timber': makeSlot('structural-timber', {
            quantity: 13,
            recentInflow: 8,
          }),
        },
      },
    });
    expect(facility.inventories.logs.quantity).toBe(20);
    expect(facility.inventories['structural-timber'].quantity).toBe(5);
  });

  it('consumes every prefab input atomically', () => {
    const recipe = getRecipe('module-assembly');
    const facility = makeFacility(
      'prefabrication-plant',
      recipe.id,
      {
        'structural-timber': makeSlot('structural-timber', { quantity: 8 }),
        cement: makeSlot('cement', { quantity: 8 }),
        steel: makeSlot('steel', { quantity: 6 }),
        'building-modules': makeSlot('building-modules'),
      },
      { recipeProgressTicks: 5 },
    );

    const result = advanceFacilityRecipe(facility, recipe);

    expect(result.completedBatches).toBe(1);
    expect(result.productDeltas).toEqual([
      { productId: 'structural-timber', units: -8 },
      { productId: 'cement', units: -8 },
      { productId: 'steel', units: -6 },
      { productId: 'building-modules', units: 4 },
    ]);
    expect(result.receipts).toEqual([]);
    expect(result.facility.inventories).toEqual({
      'structural-timber': makeSlot('structural-timber', {
        recentOutflow: 8,
      }),
      cement: makeSlot('cement', { recentOutflow: 8 }),
      steel: makeSlot('steel', { recentOutflow: 6 }),
      'building-modules': makeSlot('building-modules', {
        quantity: 4,
        recentInflow: 4,
      }),
    });
  });

  it('does not partially consume prefab inputs when one input is short', () => {
    const recipe = getRecipe('module-assembly');
    const facility = makeFacility(
      'prefabrication-plant',
      recipe.id,
      {
        'structural-timber': makeSlot('structural-timber', { quantity: 8 }),
        cement: makeSlot('cement', { quantity: 8 }),
        steel: makeSlot('steel', { quantity: 5 }),
        'building-modules': makeSlot('building-modules'),
      },
      { recipeProgressTicks: 5 },
    );

    expect(advanceFacilityRecipe(facility, recipe)).toEqual({
      blocker: 'waiting-input',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility,
    });
  });

  it('aggregates duplicate input entries before deciding a batch can start', () => {
    const recipe: RecipeDefinition = {
      id: 'duplicate-inputs',
      kind: 'processing',
      cycleTicks: 1,
      inputs: [
        { productId: 'logs', quantity: 6 },
        { productId: 'logs', quantity: 6 },
      ],
      outputs: [{ productId: 'structural-timber', quantity: 1 }],
    };
    const facility = makeFacility('sawmill', recipe.id, {
      logs: makeSlot('logs', { quantity: 10 }),
      'structural-timber': makeSlot('structural-timber'),
    });

    expect(advanceFacilityRecipe(facility, recipe)).toEqual({
      blocker: 'waiting-input',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility,
    });
    expect(facility.inventories.logs.quantity).toBe(10);
  });

  it('aggregates duplicate output entries before consuming any input', () => {
    const recipe: RecipeDefinition = {
      id: 'duplicate-outputs',
      kind: 'processing',
      cycleTicks: 1,
      inputs: [{ productId: 'logs', quantity: 1 }],
      outputs: [
        { productId: 'structural-timber', quantity: 6 },
        { productId: 'structural-timber', quantity: 6 },
      ],
    };
    const facility = makeFacility('sawmill', recipe.id, {
      logs: makeSlot('logs', { quantity: 10 }),
      'structural-timber': makeSlot('structural-timber', {
        quantity: 90,
        capacity: 100,
      }),
    });

    expect(advanceFacilityRecipe(facility, recipe)).toEqual({
      blocker: 'output-full',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility,
    });
    expect(facility.inventories.logs.quantity).toBe(10);
    expect(facility.inventories['structural-timber'].quantity).toBe(90);
  });

  it('validates and commits a same-product input/output recipe by net delta', () => {
    const recipe: RecipeDefinition = {
      id: 'logs-trimming',
      kind: 'processing',
      cycleTicks: 1,
      inputs: [{ productId: 'logs', quantity: 10 }],
      outputs: [{ productId: 'logs', quantity: 8 }],
    };
    const facility = makeFacility('sawmill', recipe.id, {
      logs: makeSlot('logs', {
        quantity: 10,
        capacity: 10,
        targetStock: 5,
        recentInflow: 2,
        recentOutflow: 3,
      }),
    });

    expect(advanceFacilityRecipe(facility, recipe)).toEqual({
      blocker: 'working',
      completedBatches: 1,
      productDeltas: [{ productId: 'logs', units: -2 }],
      receipts: [],
      facility: {
        ...facility,
        recipeProgressTicks: 0,
        inventories: {
          logs: makeSlot('logs', {
            quantity: 8,
            capacity: 10,
            targetStock: 5,
            recentInflow: 10,
            recentOutflow: 13,
          }),
        },
      },
    });
    expect(facility.inventories.logs.quantity).toBe(10);
  });

  it.each([
    {
      name: 'input outflow',
      recipe: {
        id: 'input-counter-overflow',
        kind: 'processing',
        cycleTicks: 1,
        inputs: [
          { productId: 'logs', quantity: 1 },
          { productId: 'logs', quantity: 1 },
        ],
        outputs: [{ productId: 'structural-timber', quantity: 1 }],
      } as RecipeDefinition,
      facility: makeFacility('sawmill', 'input-counter-overflow', {
        logs: makeSlot('logs', {
          quantity: 10,
          recentOutflow: Number.MAX_SAFE_INTEGER - 1,
        }),
        'structural-timber': makeSlot('structural-timber'),
      }),
      blocker: 'waiting-input',
    },
    {
      name: 'output inflow',
      recipe: {
        id: 'output-counter-overflow',
        kind: 'processing',
        cycleTicks: 1,
        inputs: [{ productId: 'logs', quantity: 1 }],
        outputs: [
          { productId: 'structural-timber', quantity: 1 },
          { productId: 'structural-timber', quantity: 1 },
        ],
      } as RecipeDefinition,
      facility: makeFacility('sawmill', 'output-counter-overflow', {
        logs: makeSlot('logs', { quantity: 10 }),
        'structural-timber': makeSlot('structural-timber', {
          recentInflow: Number.MAX_SAFE_INTEGER - 1,
        }),
      }),
      blocker: 'output-full',
    },
  ])('rejects cumulative $name overflow before committing', ({
    recipe,
    facility,
    blocker,
  }) => {
    expect(advanceFacilityRecipe(facility, recipe)).toEqual({
      blocker,
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility,
    });
  });

  it('returns idle when the facility has no active recipe', () => {
    const recipe = getRecipe('forest-harvest');
    const facility = makeFacility(
      'managed-forest',
      null,
      { logs: makeSlot('logs') },
    );

    expect(advanceFacilityRecipe(facility, recipe)).toEqual({
      blocker: 'idle',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
      facility,
    });
  });

  it('is identical when the same ticks are split into different groupings', () => {
    const recipe = getRecipe('sawmill-cut');
    const initial = makeFacility('sawmill', recipe.id, {
      logs: makeSlot('logs', { quantity: 40 }),
      'structural-timber': makeSlot('structural-timber'),
    });

    expect(advanceTicks(initial, recipe, [6]))
      .toEqual(advanceTicks(initial, recipe, [1, 2, 3]));
  });
});

describe('applyFacilityBoundary', () => {
  it('imports only the port slot free capacity and records the accepted units', () => {
    const definition = getDefinition('port-interchange');
    const facility = makeFacility('port-interchange', null, {
      steel: makeSlot('steel', {
        quantity: 80,
        capacity: 100,
        recentInflow: 2,
      }),
    });

    const result = applyFacilityBoundary(
      facility,
      definition,
      'steel',
      50,
      'import',
    );

    expect(result).toEqual({
      acceptedUnits: 20,
      kind: 'import',
      receipt: {
        facilityId: 'port-interchange-1',
        productId: 'steel',
        units: 20,
        kind: 'import',
      },
      facility: {
        ...facility,
        inventories: {
          steel: makeSlot('steel', {
            quantity: 100,
            capacity: 100,
            recentInflow: 22,
          }),
        },
      },
    });
    expect(facility.inventories.steel.quantity).toBe(80);
  });

  it('consumes only available unreserved town stock', () => {
    const definition = getDefinition('town-construction-market');
    const facility = makeFacility('town-construction-market', null, {
      'building-modules': makeSlot('building-modules', {
        quantity: 10,
        reservedQuantity: 4,
        recentOutflow: 3,
      }),
    });

    const result = applyFacilityBoundary(
      facility,
      definition,
      'building-modules',
      20,
      'consumption',
    );

    expect(result).toMatchObject({
      acceptedUnits: 6,
      kind: 'consumption',
      receipt: {
        facilityId: 'town-construction-market-1',
        productId: 'building-modules',
        units: 6,
        kind: 'consumption',
      },
      facility: {
        inventories: {
          'building-modules': {
            quantity: 4,
            reservedQuantity: 4,
            recentOutflow: 9,
          },
        },
      },
    });
  });

  it('exports only available unreserved port stock', () => {
    const definition = getDefinition('port-interchange');
    const facility = makeFacility('port-interchange', null, {
      steel: makeSlot('steel', {
        quantity: 12,
        reservedQuantity: 2,
      }),
    });

    expect(applyFacilityBoundary(
      facility,
      definition,
      'steel',
      20,
      'export',
    )).toMatchObject({
      acceptedUnits: 10,
      kind: 'export',
      receipt: {
        facilityId: 'port-interchange-1',
        productId: 'steel',
        units: 10,
        kind: 'export',
      },
      facility: {
        inventories: {
          steel: { quantity: 2, recentOutflow: 10 },
        },
      },
    });
  });

  it.each([
    {
      name: 'port import at a non-port',
      facility: makeFacility('sawmill', null, {
        logs: makeSlot('logs'),
      }),
      definition: getDefinition('sawmill'),
      productId: 'logs',
      kind: 'import',
    },
    {
      name: 'port export at a non-port',
      facility: makeFacility('sawmill', null, {
        logs: makeSlot('logs', { quantity: 10 }),
      }),
      definition: getDefinition('sawmill'),
      productId: 'logs',
      kind: 'export',
    },
    {
      name: 'town consumption at a non-town',
      facility: makeFacility('port-interchange', null, {
        steel: makeSlot('steel', { quantity: 10 }),
      }),
      definition: getDefinition('port-interchange'),
      productId: 'steel',
      kind: 'consumption',
    },
    {
      name: 'generic resource extraction',
      facility: makeFacility('managed-forest', null, {
        logs: makeSlot('logs'),
      }),
      definition: getDefinition('managed-forest'),
      productId: 'logs',
      kind: 'resource-extraction',
    },
  ])('rejects $name without mutation', ({
    facility,
    definition,
    productId,
    kind,
  }) => {
    expect(applyFacilityBoundary(
      facility,
      definition,
      productId,
      10,
      kind as any,
    )).toMatchObject({
      acceptedUnits: 0,
      receipt: null,
      facility,
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid boundary units %s and returns the original facility',
    (requestedUnits) => {
      const definition = getDefinition('port-interchange');
      const facility = makeFacility('port-interchange', null, {
        steel: makeSlot('steel', { quantity: 20 }),
      });

      const result = applyFacilityBoundary(
        facility,
        definition,
        'steel',
        requestedUnits,
        'export',
      );

      expect(result).toEqual({
        acceptedUnits: 0,
        kind: 'export',
        receipt: null,
        facility,
      });
    },
  );

  it('rejects a product outside the facility definition', () => {
    const definition = getDefinition('port-interchange');
    const facility = makeFacility('port-interchange', null, {
      logs: makeSlot('logs', { quantity: 10 }),
    });

    expect(applyFacilityBoundary(
      facility,
      definition,
      'logs',
      5,
      'export',
    )).toEqual({
      acceptedUnits: 0,
      kind: 'export',
      receipt: null,
      facility,
    });
  });
});
