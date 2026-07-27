import type {
  FacilityDefinition,
  FacilityEconomyDef,
  InventorySlotDef,
  RecipeDefinition,
} from '../../src/economy/EconomyData';
import {
  getFacilityDefinition,
  getRecipe,
} from '../../src/economy/ProductCatalog';
import * as ProductCatalog from '../../src/economy/ProductCatalog';
import {
  eligibleLoadProducts,
  facilityAcceptsProduct,
} from '../../src/freight/FacilityCargoRules';
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
  it('derives Sawmill and Prefabrication Plant inputs from active recipes', () => {
    const sawmill = cloneCatalogueFacility('sawmill');
    sawmill.inventories.logs.quantity = 21;
    sawmill.inventories.logs.reservedQuantity = 199;
    const prefab = cloneCatalogueFacility('prefabrication-plant');
    prefab.inventories['structural-timber'].quantity = 41;
    prefab.inventories['structural-timber'].reservedQuantity = 159;

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
    sawmill.inventories.logs.reservedQuantity = 200;
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

  it('fails closed when the required inventory slot is missing', () => {
    const sawmill = cloneCatalogueFacility('sawmill');
    delete sawmill.inventories.logs;

    expect(facilityAcceptsProduct(sawmill, 'logs')).toBeNull();
  });
});
