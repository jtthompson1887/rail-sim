import type {
  FacilityEconomyDef,
  InventorySlotDef,
  RecipeDefinition,
} from '../economy/EconomyData';
import {
  getFacilityDefinition,
  getProduct,
  getRecipe,
} from '../economy/ProductCatalog';
import type { FreightSetDefinition } from './FreightSetCatalog';

export interface LoadableProduct {
  readonly productId: string;
  readonly availableUnits: number;
}

export interface AcceptedProduct {
  readonly productId: string;
  readonly freeCapacityUnits: number;
}

interface OrderedLoadableProduct extends LoadableProduct {
  readonly recipeOrder: number;
}

const EMPTY_LOAD_PRODUCTS: readonly LoadableProduct[] = Object.freeze([]);

const isNonNegativeSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasProductDefinition = (productId: string): boolean => {
  const product = getProduct(productId) as unknown;
  return isRecord(product) && product.id === productId;
};

const activeRecipe = (
  facility: FacilityEconomyDef,
): RecipeDefinition | null => {
  const definition = getFacilityDefinition(facility.definitionId);
  const recipeId = facility.activeRecipeId;
  if (!definition
    || typeof recipeId !== 'string'
    || definition.recipeIds.indexOf(recipeId) === -1) {
    return null;
  }
  return getRecipe(recipeId) ?? null;
};

const validInventorySlot = (
  slot: unknown,
  productId: string,
): slot is InventorySlotDef => isRecord(slot)
  && slot.productId === productId
  && isNonNegativeSafeInteger(slot.quantity as number)
  && isNonNegativeSafeInteger(slot.reservedQuantity as number)
  && Number.isSafeInteger(slot.capacity)
  && (slot.capacity as number) > 0
  && (slot.reservedQuantity as number) <= (slot.quantity as number)
  && (slot.quantity as number) <= (slot.capacity as number);

export function eligibleLoadProducts(
  facility: FacilityEconomyDef,
  freightSet: FreightSetDefinition,
): readonly LoadableProduct[] {
  const recipe = activeRecipe(facility);
  if (!recipe
    || !Array.isArray(recipe.outputs)
    || !Array.isArray(freightSet.compatibleProductIds)) {
    return EMPTY_LOAD_PRODUCTS;
  }

  const candidates: OrderedLoadableProduct[] = [];
  const includedProductIds = new Set<string>();
  recipe.outputs.forEach((output, recipeOrder) => {
    if (typeof output?.productId !== 'string'
      || !Number.isSafeInteger(output.quantity)
      || output.quantity <= 0
      || includedProductIds.has(output.productId)
      || !hasProductDefinition(output.productId)
      || freightSet.compatibleProductIds.indexOf(output.productId) === -1) {
      return;
    }
    const slot = facility.inventories?.[output.productId];
    if (!validInventorySlot(slot, output.productId)) return;
    const availableUnits = slot.quantity - slot.reservedQuantity;
    if (!Number.isSafeInteger(availableUnits) || availableUnits <= 0) return;

    includedProductIds.add(output.productId);
    candidates.push({
      productId: output.productId,
      availableUnits,
      recipeOrder,
    });
  });
  candidates.sort((left, right) => left.recipeOrder - right.recipeOrder
    || left.productId.localeCompare(right.productId));

  return Object.freeze(candidates.map(({ productId, availableUnits }) =>
    Object.freeze({ productId, availableUnits })));
}

export function facilityAcceptsProduct(
  facility: FacilityEconomyDef,
  productId: string,
): AcceptedProduct | null {
  const recipe = activeRecipe(facility);
  if (!recipe
    || !Array.isArray(recipe.inputs)
    || !hasProductDefinition(productId)) {
    return null;
  }
  const input = recipe.inputs.find((candidate) =>
    candidate?.productId === productId
    && Number.isSafeInteger(candidate.quantity)
    && candidate.quantity > 0);
  const slot = facility.inventories?.[productId];
  if (!input || !validInventorySlot(slot, productId)) return null;

  const freeCapacityUnits = slot.capacity - slot.quantity;
  if (!Number.isSafeInteger(freeCapacityUnits) || freeCapacityUnits <= 0) {
    return null;
  }
  return Object.freeze({ productId, freeCapacityUnits });
}
