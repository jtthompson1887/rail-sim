import type {
  FacilityDefinition,
  ProductDefinition,
  RecipeDefinition,
} from './EconomyData';
import {
  INITIAL_FACILITY_DEFINITIONS,
  INITIAL_PRODUCTS,
  INITIAL_RECIPES,
} from './InitialEconomyContent';

export type ContentValidationResult =
  | { valid: true }
  | { valid: false; code: string; referenceId?: string };

type UnknownRecord = Record<string, unknown>;

const VALID_CARGO_CLASSES = new Set<string>(['bulk', 'covered', 'flatbed']);
const VALID_RECIPE_KINDS = new Set<string>([
  'resource-extraction',
  'processing',
]);
const VALID_BOUNDARIES = new Set<string>([
  'none',
  'port',
  'town-consumer',
]);

const productById = new Map(
  INITIAL_PRODUCTS.map((product) => [product.id, product]),
);
const recipeById = new Map(
  INITIAL_RECIPES.map((recipe) => [recipe.id, recipe]),
);
const facilityById = new Map(
  INITIAL_FACILITY_DEFINITIONS.map((facility) => [facility.id, facility]),
);

const invalid = (
  code: string,
  referenceId?: string,
): ContentValidationResult => referenceId === undefined
  ? { valid: false, code }
  : { valid: false, code, referenceId };

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const validateAmount = (
  amount: unknown,
  productIds: Set<string>,
): ContentValidationResult => {
  if (!isRecord(amount)) {
    return invalid('invalid-recipe-amount');
  }
  if (!isNonEmptyString(amount.productId)) {
    return invalid('invalid-recipe-amount');
  }
  if (!productIds.has(amount.productId)) {
    return invalid('unknown-recipe-product', amount.productId);
  }
  if (!isPositiveSafeInteger(amount.quantity)) {
    return invalid('invalid-recipe-quantity', amount.productId);
  }
  return { valid: true };
};

export const validateEconomyContent = (
  products: ReadonlyArray<ProductDefinition>,
  recipes: ReadonlyArray<RecipeDefinition>,
  facilities: ReadonlyArray<FacilityDefinition>,
): ContentValidationResult => {
  if (!Array.isArray(products)) return invalid('invalid-products');
  if (!Array.isArray(recipes)) return invalid('invalid-recipes');
  if (!Array.isArray(facilities)) return invalid('invalid-facilities');

  const productIds = new Set<string>();
  for (const product of products as ReadonlyArray<unknown>) {
    if (!isRecord(product)
      || !isNonEmptyString(product.id)
      || !isNonEmptyString(product.displayName)
      || !isNonEmptyString(product.category)
      || !isNonEmptyString(product.unitLabel)
      || product.marketSector !== 'construction') {
      return invalid(
        'invalid-product',
        isRecord(product) && isNonEmptyString(product.id)
          ? product.id
          : undefined,
      );
    }
    if (productIds.has(product.id)) {
      return invalid('duplicate-product', product.id);
    }
    if (!isNonEmptyString(product.cargoClass)
      || !VALID_CARGO_CLASSES.has(product.cargoClass)) {
      return invalid('invalid-cargo-class', product.id);
    }
    if (!isPositiveSafeInteger(product.unitMassKg)
      || !isPositiveSafeInteger(product.unitVolumeLitres)
      || !isPositiveSafeInteger(product.basePrice)) {
      return invalid('invalid-product-quantity', product.id);
    }
    productIds.add(product.id);
  }

  const recipesById = new Map<string, RecipeDefinition>();
  for (const recipe of recipes as ReadonlyArray<unknown>) {
    if (!isRecord(recipe)
      || !isNonEmptyString(recipe.id)
      || !isNonEmptyString(recipe.kind)
      || !VALID_RECIPE_KINDS.has(recipe.kind)) {
      return invalid(
        'invalid-recipe',
        isRecord(recipe) && isNonEmptyString(recipe.id)
          ? recipe.id
          : undefined,
      );
    }
    if (recipesById.has(recipe.id)) {
      return invalid('duplicate-recipe', recipe.id);
    }
    if (!isPositiveSafeInteger(recipe.cycleTicks)) {
      return invalid('invalid-recipe-cycle', recipe.id);
    }
    if (!Array.isArray(recipe.inputs) || !Array.isArray(recipe.outputs)) {
      return invalid('invalid-recipe-amounts', recipe.id);
    }
    if (recipe.kind === 'processing' && recipe.inputs.length === 0) {
      return invalid('processing-inputs-required', recipe.id);
    }
    if (recipe.kind === 'resource-extraction' && recipe.inputs.length > 0) {
      return invalid('extraction-inputs-forbidden', recipe.id);
    }
    if (recipe.outputs.length === 0) {
      return invalid('recipe-outputs-required', recipe.id);
    }
    for (const amount of [...recipe.inputs, ...recipe.outputs]) {
      const amountResult = validateAmount(amount, productIds);
      if (!amountResult.valid) return amountResult;
    }
    recipesById.set(recipe.id, recipe as unknown as RecipeDefinition);
  }

  const facilityIds = new Set<string>();
  for (const facility of facilities as ReadonlyArray<unknown>) {
    if (!isRecord(facility)
      || !isNonEmptyString(facility.id)
      || !isNonEmptyString(facility.displayName)
      || !isNonEmptyString(facility.boundary)
      || !VALID_BOUNDARIES.has(facility.boundary)
      || !Array.isArray(facility.recipeIds)
      || !Array.isArray(facility.inventory)) {
      return invalid(
        'invalid-facility',
        isRecord(facility) && isNonEmptyString(facility.id)
          ? facility.id
          : undefined,
      );
    }
    if (facilityIds.has(facility.id)) {
      return invalid('duplicate-facility', facility.id);
    }
    facilityIds.add(facility.id);

    const facilityRecipes: RecipeDefinition[] = [];
    const assignedRecipeIds = new Set<string>();
    for (const recipeId of facility.recipeIds as ReadonlyArray<unknown>) {
      if (!isNonEmptyString(recipeId)) {
        return invalid('invalid-facility-recipe');
      }
      if (assignedRecipeIds.has(recipeId)) {
        return invalid('duplicate-facility-recipe', recipeId);
      }
      const recipe = recipesById.get(recipeId);
      if (recipe === undefined) {
        return invalid('unknown-facility-recipe', recipeId);
      }
      assignedRecipeIds.add(recipeId);
      facilityRecipes.push(recipe);
    }

    const inventoryProductIds = new Set<string>();
    for (const slot of facility.inventory as ReadonlyArray<unknown>) {
      if (!isRecord(slot)) {
        return invalid('invalid-inventory-slot');
      }
      if (!isNonEmptyString(slot.productId)) {
        return invalid('invalid-inventory-slot');
      }
      if (!productIds.has(slot.productId)) {
        return invalid('unknown-inventory-product', slot.productId);
      }
      if (inventoryProductIds.has(slot.productId)) {
        return invalid('duplicate-inventory-slot', slot.productId);
      }
      if (!isPositiveSafeInteger(slot.capacity)
        || !isPositiveSafeInteger(slot.targetStock)
        || !isNonNegativeSafeInteger(slot.initialQuantity)
        || slot.targetStock > slot.capacity
        || slot.initialQuantity > slot.capacity) {
        return invalid('invalid-inventory-quantity', slot.productId);
      }
      inventoryProductIds.add(slot.productId);
    }

    for (const recipe of facilityRecipes) {
      for (const amount of [...recipe.inputs, ...recipe.outputs]) {
        if (!inventoryProductIds.has(amount.productId)) {
          return invalid('missing-inventory-slot', amount.productId);
        }
      }
    }
  }

  return { valid: true };
};

export const getProduct = (
  id: string,
): ProductDefinition | undefined => productById.get(id);

export const getRecipe = (
  id: string,
): RecipeDefinition | undefined => recipeById.get(id);

export const getFacilityDefinition = (
  id: string,
): FacilityDefinition | undefined => facilityById.get(id);
