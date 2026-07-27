import type {
  FacilityDefinition,
  FacilityEconomyDef,
  InventorySlotDef,
  RecipeDefinition,
} from '../../src/economy/EconomyData';
import {
  getFacilityDefinition,
  getProduct,
  getRecipe,
} from '../../src/economy/ProductCatalog';
import * as ProductCatalog from '../../src/economy/ProductCatalog';
import {
  canContinueConsignment,
  eligibleLoadProducts,
  facilityAcceptsProduct,
  potentialAcceptedProduct,
  potentialLoadProducts,
} from '../../src/freight/FacilityCargoRules';
import type { TrainDef } from '../../src/config/WorldData';
import {
  FLATBED_FREIGHT_SET_ID,
  getFreightSet,
} from '../../src/freight/FreightSetCatalog';

function cloneCatalogueFacility(definitionId: string): FacilityEconomyDef {
  const definition = getFacilityDefinition(definitionId)!;
  const inventories: Record<string, InventorySlotDef> = {};
  definition.inventory.forEach((template) => {
    inventories[template.productId] = {
      productId: template.productId,
      quantity: template.initialQuantity,
      reservedQuantity: 0,
      capacity: template.capacity,
      recentInflow: 0,
      recentOutflow: 0,
      targetStock: template.targetStock,
    };
  });
  return {
    id: `${definition.id}-instance`,
    definitionId: definition.id,
    name: definition.displayName,
    x: 100,
    y: 200,
    railAccess: { x: 100, y: 200, radius: 50 },
    inventories,
    activeRecipeId: definition.recipeIds[0] ?? null,
    recipeProgressTicks: 0,
  };
}

const flatbed = () => getFreightSet(FLATBED_FREIGHT_SET_ID)!;

const loadedTrain = (
  units: number,
  loadedUnits: number,
  originFacilityId = 'managed-forest-instance',
): TrainDef => ({
  id: 'train-1',
  freightSetId: FLATBED_FREIGHT_SET_ID,
  trackUUID: 'track-1',
  trackT: 0,
  facing: 1,
  cargo: {
    productId: 'logs',
    units,
    loadedUnits,
    originFacilityId,
  },
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

describe('canContinueConsignment', () => {
  const forest = cloneCatalogueFacility('managed-forest');

  it.each([
    ['valid partial same-origin cargo', loadedTrain(40, 40), true],
    ['a full consignment', loadedTrain(60, 60), false],
    ['a partially unloaded consignment', loadedTrain(30, 40), false],
    [
      'cargo loaded at another origin',
      loadedTrain(40, 40, 'another-forest'),
      false,
    ],
  ] as const)('returns %s = %s', (_case, train, expected) => {
    expect(canContinueConsignment(train, forest, 60)).toBe(expected);
  });
});

describe('eligibleLoadProducts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives Forest logs and Sawmill timber from their active outputs', () => {
    const forest = cloneCatalogueFacility('managed-forest');
    forest.inventories.logs.reservedQuantity = 8;
    const sawmill = cloneCatalogueFacility('sawmill');
    sawmill.inventories['structural-timber'].quantity = 37;
    sawmill.inventories['structural-timber'].reservedQuantity = 7;

    expect(eligibleLoadProducts(forest, flatbed())).toEqual([
      { productId: 'logs', availableUnits: 52 },
    ]);
    expect(eligibleLoadProducts(sawmill, flatbed())).toEqual([
      { productId: 'structural-timber', availableUnits: 30 },
    ]);
  });

  it('rejects a Quarry output that is incompatible with the flatbed', () => {
    expect(eligibleLoadProducts(
      cloneCatalogueFacility('quarry'),
      flatbed(),
    )).toEqual([]);
  });

  it('returns no source for missing, idle, unknown, or unassigned recipes', () => {
    const missingDefinition = cloneCatalogueFacility('managed-forest');
    missingDefinition.definitionId = 'missing-facility-definition';
    const idle = cloneCatalogueFacility('managed-forest');
    idle.activeRecipeId = null;
    const unknownRecipe = cloneCatalogueFacility('managed-forest');
    unknownRecipe.activeRecipeId = 'missing-recipe';
    const unassignedRecipe = cloneCatalogueFacility('managed-forest');
    unassignedRecipe.activeRecipeId = 'sawmill-cut';

    expect(eligibleLoadProducts(missingDefinition, flatbed())).toEqual([]);
    expect(eligibleLoadProducts(idle, flatbed())).toEqual([]);
    expect(eligibleLoadProducts(unknownRecipe, flatbed())).toEqual([]);
    expect(eligibleLoadProducts(unassignedRecipe, flatbed())).toEqual([]);
  });

  it('returns only positive unreserved availability', () => {
    const forest = cloneCatalogueFacility('managed-forest');
    forest.inventories.logs.quantity = 12;
    forest.inventories.logs.reservedQuantity = 12;

    expect(eligibleLoadProducts(forest, flatbed())).toEqual([]);

    forest.inventories.logs.reservedQuantity = 5;
    expect(eligibleLoadProducts(forest, flatbed())).toEqual([
      { productId: 'logs', availableUnits: 7 },
    ]);
  });

  it('discovers a valid source with zero availability', () => {
    const forest = cloneCatalogueFacility('managed-forest');
    forest.inventories.logs.reservedQuantity =
      forest.inventories.logs.quantity;

    expect(potentialLoadProducts(forest, flatbed())).toEqual([
      { productId: 'logs', availableUnits: 0 },
    ]);
    expect(eligibleLoadProducts(forest, flatbed())).toEqual([]);
  });

  it.each([
    ['a null slot', (slot: any) => null],
    ['a non-object slot', (slot: any) => 7],
    ['an unsafe quantity', (slot: any) => ({
      ...slot,
      quantity: Number.MAX_SAFE_INTEGER + 1,
    })],
    ['a fractional quantity', (slot: any) => ({
      ...slot,
      quantity: 1.5,
    })],
    ['an unsafe reservation', (slot: any) => ({
      ...slot,
      reservedQuantity: Number.MAX_SAFE_INTEGER + 1,
    })],
    ['a fractional reservation', (slot: any) => ({
      ...slot,
      reservedQuantity: 1.5,
    })],
    ['reservation above quantity', (slot: any) => ({
      ...slot,
      quantity: 10,
      reservedQuantity: 11,
    })],
    ['an unsafe capacity', (slot: any) => ({
      ...slot,
      capacity: Number.MAX_SAFE_INTEGER + 1,
    })],
    ['a fractional capacity', (slot: any) => ({
      ...slot,
      capacity: 240.5,
    })],
    ['quantity above capacity', (slot: any) => ({
      ...slot,
      quantity: 241,
      capacity: 240,
    })],
  ])('fails closed for %s', (_description, malformedSlot) => {
    const forest = cloneCatalogueFacility('managed-forest');
    forest.inventories.logs = malformedSlot(forest.inventories.logs);

    expect(potentialLoadProducts(forest, flatbed())).toEqual([]);
    expect(eligibleLoadProducts(forest, flatbed())).toEqual([]);
  });

  it.each([
    ['unknown', undefined],
    ['invalid', { ...getProduct('logs'), id: 'wrong-product' }],
  ])('rejects an %s output product definition', (_description, product) => {
    jest.spyOn(ProductCatalog, 'getProduct')
      .mockReturnValue(product as any);

    expect(eligibleLoadProducts(
      cloneCatalogueFacility('managed-forest'),
      flatbed(),
    )).toEqual([]);
  });

  it('preserves recipe output order and returns immutable new values', () => {
    const baseDefinition = getFacilityDefinition('managed-forest')!;
    const baseRecipe = getRecipe('forest-harvest')!;
    const definition: FacilityDefinition = Object.freeze({
      ...baseDefinition,
      recipeIds: Object.freeze(['mixed-harvest']),
      inventory: Object.freeze([
        ...baseDefinition.inventory,
        Object.freeze({
          productId: 'structural-timber',
          capacity: 160,
          targetStock: 80,
          initialQuantity: 0,
        }),
      ]),
    });
    const recipe: RecipeDefinition = Object.freeze({
      ...baseRecipe,
      id: 'mixed-harvest',
      outputs: Object.freeze([
        Object.freeze({ productId: 'structural-timber', quantity: 4 }),
        Object.freeze({ productId: 'logs', quantity: 8 }),
      ]),
    });
    jest.spyOn(ProductCatalog, 'getFacilityDefinition')
      .mockReturnValue(definition);
    jest.spyOn(ProductCatalog, 'getRecipe').mockReturnValue(recipe);
    const facility = cloneCatalogueFacility('managed-forest');
    facility.activeRecipeId = 'mixed-harvest';
    facility.inventories['structural-timber'] = {
      productId: 'structural-timber',
      quantity: 19,
      reservedQuantity: 3,
      capacity: 160,
      recentInflow: 0,
      recentOutflow: 0,
      targetStock: 80,
    };
    const before = JSON.parse(JSON.stringify(facility));

    const result = eligibleLoadProducts(facility, flatbed());

    expect(result).toEqual([
      { productId: 'structural-timber', availableUnits: 16 },
      { productId: 'logs', availableUnits: 60 },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every((item) => Object.isFrozen(item))).toBe(true);
    expect(facility).toEqual(before);
    expect(() => {
      (result as Array<{ productId: string; availableUnits: number }>).reverse();
    }).toThrow(TypeError);
    expect(() => {
      (result[0] as { productId: string; availableUnits: number })
        .availableUnits = 1;
    }).toThrow(TypeError);
  });
});

describe('facilityAcceptsProduct', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives Sawmill and Prefabrication Plant inputs from active recipes', () => {
    const sawmill = cloneCatalogueFacility('sawmill');
    sawmill.inventories.logs.quantity = 21;
    sawmill.inventories.logs.reservedQuantity = 20;
    const prefab = cloneCatalogueFacility('prefabrication-plant');
    prefab.inventories['structural-timber'].quantity = 41;
    prefab.inventories['structural-timber'].reservedQuantity = 40;

    expect(facilityAcceptsProduct(sawmill, 'logs')).toEqual({
      productId: 'logs',
      freeCapacityUnits: 179,
    });
    expect(facilityAcceptsProduct(
      prefab,
      'structural-timber',
    )).toEqual({
      productId: 'structural-timber',
      freeCapacityUnits: 119,
    });
  });

  it('rejects products that are not active recipe inputs', () => {
    expect(facilityAcceptsProduct(
      cloneCatalogueFacility('managed-forest'),
      'structural-timber',
    )).toBeNull();
    expect(facilityAcceptsProduct(
      cloneCatalogueFacility('sawmill'),
      'structural-timber',
    )).toBeNull();
  });

  it('returns no destination for missing, idle, unknown, or unassigned recipes', () => {
    const missingDefinition = cloneCatalogueFacility('sawmill');
    missingDefinition.definitionId = 'missing-facility-definition';
    const idle = cloneCatalogueFacility('sawmill');
    idle.activeRecipeId = null;
    const unknownRecipe = cloneCatalogueFacility('sawmill');
    unknownRecipe.activeRecipeId = 'missing-recipe';
    const unassignedRecipe = cloneCatalogueFacility('sawmill');
    unassignedRecipe.activeRecipeId = 'module-assembly';

    expect(facilityAcceptsProduct(missingDefinition, 'logs')).toBeNull();
    expect(facilityAcceptsProduct(idle, 'logs')).toBeNull();
    expect(facilityAcceptsProduct(unknownRecipe, 'logs')).toBeNull();
    expect(facilityAcceptsProduct(unassignedRecipe, 'logs')).toBeNull();
  });

  it('requires positive inbound space and returns an immutable record', () => {
    const sawmill = cloneCatalogueFacility('sawmill');
    sawmill.inventories.logs.quantity = 200;
    sawmill.inventories.logs.reservedQuantity = 0;

    expect(facilityAcceptsProduct(sawmill, 'logs')).toBeNull();

    sawmill.inventories.logs.quantity = 199;
    sawmill.inventories.logs.reservedQuantity = 199;
    const before = JSON.parse(JSON.stringify(sawmill));
    const result = facilityAcceptsProduct(sawmill, 'logs')!;

    expect(result).toEqual({
      productId: 'logs',
      freeCapacityUnits: 1,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(sawmill).toEqual(before);
    expect(() => {
      (result as { productId: string; freeCapacityUnits: number })
        .freeCapacityUnits = 0;
    }).toThrow(TypeError);
  });

  it('discovers a valid destination with zero free capacity', () => {
    const sawmill = cloneCatalogueFacility('sawmill');
    sawmill.inventories.logs.quantity =
      sawmill.inventories.logs.capacity;

    expect(potentialAcceptedProduct(sawmill, 'logs')).toEqual({
      productId: 'logs',
      freeCapacityUnits: 0,
    });
    expect(facilityAcceptsProduct(sawmill, 'logs')).toBeNull();
  });

  it('fails closed when the required inventory slot is missing', () => {
    const sawmill = cloneCatalogueFacility('sawmill');
    delete sawmill.inventories.logs;

    expect(facilityAcceptsProduct(sawmill, 'logs')).toBeNull();
  });

  it.each([
    ['a null slot', (slot: any) => null],
    ['a non-object slot', (slot: any) => 'logs'],
    ['an unsafe quantity', (slot: any) => ({
      ...slot,
      quantity: Number.MAX_SAFE_INTEGER + 1,
    })],
    ['a fractional quantity', (slot: any) => ({
      ...slot,
      quantity: 1.5,
    })],
    ['an unsafe reservation', (slot: any) => ({
      ...slot,
      reservedQuantity: Number.MAX_SAFE_INTEGER + 1,
    })],
    ['a fractional reservation', (slot: any) => ({
      ...slot,
      reservedQuantity: 1.5,
    })],
    ['reservation above quantity', (slot: any) => ({
      ...slot,
      quantity: 10,
      reservedQuantity: 11,
    })],
    ['an unsafe capacity', (slot: any) => ({
      ...slot,
      capacity: Number.MAX_SAFE_INTEGER + 1,
    })],
    ['a fractional capacity', (slot: any) => ({
      ...slot,
      capacity: 200.5,
    })],
    ['quantity above capacity', (slot: any) => ({
      ...slot,
      quantity: 201,
      capacity: 200,
    })],
  ])('fails closed for %s', (_description, malformedSlot) => {
    const sawmill = cloneCatalogueFacility('sawmill');
    sawmill.inventories.logs = malformedSlot(sawmill.inventories.logs);

    expect(potentialAcceptedProduct(sawmill, 'logs')).toBeNull();
    expect(facilityAcceptsProduct(sawmill, 'logs')).toBeNull();
  });

  it.each([
    ['unknown', undefined],
    ['invalid', { ...getProduct('logs'), id: 'wrong-product' }],
  ])('rejects an %s input product definition', (_description, product) => {
    jest.spyOn(ProductCatalog, 'getProduct')
      .mockReturnValue(product as any);

    expect(facilityAcceptsProduct(
      cloneCatalogueFacility('sawmill'),
      'logs',
    )).toBeNull();
  });
});
