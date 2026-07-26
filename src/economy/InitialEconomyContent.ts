import {
  FacilityDefinition,
  ProductDefinition,
  RecipeDefinition,
} from './EconomyData';

const freezeProducts = (
  products: ReadonlyArray<ProductDefinition>,
): ReadonlyArray<ProductDefinition> => Object.freeze(
  products.map((product) => Object.freeze({ ...product })),
);

const freezeRecipes = (
  recipes: ReadonlyArray<RecipeDefinition>,
): ReadonlyArray<RecipeDefinition> => Object.freeze(
  recipes.map((recipe) => Object.freeze({
    ...recipe,
    inputs: Object.freeze(
      recipe.inputs.map((amount) => Object.freeze({ ...amount })),
    ),
    outputs: Object.freeze(
      recipe.outputs.map((amount) => Object.freeze({ ...amount })),
    ),
  })),
);

const freezeFacilities = (
  facilities: ReadonlyArray<FacilityDefinition>,
): ReadonlyArray<FacilityDefinition> => Object.freeze(
  facilities.map((facility) => Object.freeze({
    ...facility,
    recipeIds: Object.freeze([...facility.recipeIds]),
    inventory: Object.freeze(
      facility.inventory.map((slot) => Object.freeze({ ...slot })),
    ),
  })),
);

export const INITIAL_PRODUCTS = freezeProducts([
  {
    id: 'logs',
    displayName: 'Logs',
    category: 'raw-material',
    cargoClass: 'flatbed',
    unitLabel: 'tonne',
    unitMassKg: 1_000,
    unitVolumeLitres: 1_600,
    basePrice: 90,
    marketSector: 'construction',
  },
  {
    id: 'structural-timber',
    displayName: 'Structural Timber',
    category: 'processed-material',
    cargoClass: 'flatbed',
    unitLabel: 'tonne',
    unitMassKg: 1_000,
    unitVolumeLitres: 1_200,
    basePrice: 180,
    marketSector: 'construction',
  },
  {
    id: 'limestone-aggregate',
    displayName: 'Limestone Aggregate',
    category: 'raw-material',
    cargoClass: 'bulk',
    unitLabel: 'tonne',
    unitMassKg: 1_000,
    unitVolumeLitres: 625,
    basePrice: 45,
    marketSector: 'construction',
  },
  {
    id: 'cement',
    displayName: 'Cement',
    category: 'processed-material',
    cargoClass: 'covered',
    unitLabel: 'tonne',
    unitMassKg: 1_000,
    unitVolumeLitres: 800,
    basePrice: 130,
    marketSector: 'construction',
  },
  {
    id: 'steel',
    displayName: 'Steel',
    category: 'imported-material',
    cargoClass: 'flatbed',
    unitLabel: 'tonne',
    unitMassKg: 1_000,
    unitVolumeLitres: 128,
    basePrice: 650,
    marketSector: 'construction',
  },
  {
    id: 'building-modules',
    displayName: 'Building Modules',
    category: 'finished-good',
    cargoClass: 'flatbed',
    unitLabel: 'module',
    unitMassKg: 8_000,
    unitVolumeLitres: 25_000,
    basePrice: 6_000,
    marketSector: 'construction',
  },
]);

export const INITIAL_RECIPES = freezeRecipes([
  {
    id: 'forest-harvest',
    kind: 'resource-extraction',
    cycleTicks: 4,
    inputs: [],
    outputs: [{ productId: 'logs', quantity: 8 }],
  },
  {
    id: 'quarry-extraction',
    kind: 'resource-extraction',
    cycleTicks: 4,
    inputs: [],
    outputs: [{ productId: 'limestone-aggregate', quantity: 10 }],
  },
  {
    id: 'sawmill-cut',
    kind: 'processing',
    cycleTicks: 3,
    inputs: [{ productId: 'logs', quantity: 10 }],
    outputs: [{ productId: 'structural-timber', quantity: 8 }],
  },
  {
    id: 'cement-kiln',
    kind: 'processing',
    cycleTicks: 4,
    inputs: [{ productId: 'limestone-aggregate', quantity: 12 }],
    outputs: [{ productId: 'cement', quantity: 8 }],
  },
  {
    id: 'module-assembly',
    kind: 'processing',
    cycleTicks: 6,
    inputs: [
      { productId: 'structural-timber', quantity: 8 },
      { productId: 'cement', quantity: 8 },
      { productId: 'steel', quantity: 6 },
    ],
    outputs: [{ productId: 'building-modules', quantity: 4 }],
  },
]);

export const INITIAL_FACILITY_DEFINITIONS = freezeFacilities([
  {
    id: 'managed-forest',
    displayName: 'Managed Forest',
    recipeIds: ['forest-harvest'],
    inventory: [
      {
        productId: 'logs',
        capacity: 240,
        targetStock: 120,
        initialQuantity: 60,
      },
    ],
    boundary: 'none',
  },
  {
    id: 'sawmill',
    displayName: 'Sawmill',
    recipeIds: ['sawmill-cut'],
    inventory: [
      {
        productId: 'logs',
        capacity: 200,
        targetStock: 100,
        initialQuantity: 0,
      },
      {
        productId: 'structural-timber',
        capacity: 160,
        targetStock: 80,
        initialQuantity: 0,
      },
    ],
    boundary: 'none',
  },
  {
    id: 'quarry',
    displayName: 'Quarry',
    recipeIds: ['quarry-extraction'],
    inventory: [
      {
        productId: 'limestone-aggregate',
        capacity: 300,
        targetStock: 150,
        initialQuantity: 75,
      },
    ],
    boundary: 'none',
  },
  {
    id: 'cement-works',
    displayName: 'Cement Works',
    recipeIds: ['cement-kiln'],
    inventory: [
      {
        productId: 'limestone-aggregate',
        capacity: 240,
        targetStock: 120,
        initialQuantity: 0,
      },
      {
        productId: 'cement',
        capacity: 160,
        targetStock: 80,
        initialQuantity: 0,
      },
    ],
    boundary: 'none',
  },
  {
    id: 'port-interchange',
    displayName: 'Port Interchange',
    recipeIds: [],
    inventory: [
      {
        productId: 'steel',
        capacity: 240,
        targetStock: 120,
        initialQuantity: 120,
      },
      {
        productId: 'building-modules',
        capacity: 120,
        targetStock: 60,
        initialQuantity: 0,
      },
    ],
    boundary: 'port',
  },
  {
    id: 'prefabrication-plant',
    displayName: 'Prefabrication Plant',
    recipeIds: ['module-assembly'],
    inventory: [
      {
        productId: 'structural-timber',
        capacity: 160,
        targetStock: 80,
        initialQuantity: 0,
      },
      {
        productId: 'cement',
        capacity: 160,
        targetStock: 80,
        initialQuantity: 0,
      },
      {
        productId: 'steel',
        capacity: 160,
        targetStock: 80,
        initialQuantity: 0,
      },
      {
        productId: 'building-modules',
        capacity: 120,
        targetStock: 60,
        initialQuantity: 0,
      },
    ],
    boundary: 'none',
  },
  {
    id: 'town-construction-market',
    displayName: 'Town Construction Market',
    recipeIds: [],
    inventory: [
      {
        productId: 'building-modules',
        capacity: 160,
        targetStock: 80,
        initialQuantity: 0,
      },
    ],
    boundary: 'town-consumer',
  },
]);
