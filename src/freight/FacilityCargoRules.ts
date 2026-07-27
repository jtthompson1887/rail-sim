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

const validSourceSlot = (
  slot: InventorySlotDef | undefined,
  productId: string,
): slot is InventorySlotDef => slot !== undefined
  && slot.productId === productId
  && isNonNegativeSafeInteger(slot.quantity)
  && isNonNegativeSafeInteger(slot.reservedQuantity)
  && Number.isSafeInteger(slot.capacity)
  && slot.capacity > 0
  && slot.quantity <= slot.capacity;

const validDestinationSlot = (
  slot: InventorySlotDef | undefined,
  productId: string,
): slot is InventorySlotDef => slot !== undefined
  && slot.productId === productId
  && isNonNegativeSafeInteger(slot.quantity)
  && Number.isSafeInteger(slot.capacity)
  && slot.capacity > 0
  && slot.quantity <= slot.capacity;

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
      || !getProduct(output.productId)
      || freightSet.compatibleProductIds.indexOf(output.productId) === -1) {
      return;
    }
    const slot = facility.inventories?.[output.productId];
    if (!validSourceSlot(slot, output.productId)) return;
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
  if (!recipe || !Array.isArray(recipe.inputs) || !getProduct(productId)) {
    return null;
  }
  const input = recipe.inputs.find((candidate) =>
    candidate?.productId === productId
    && Number.isSafeInteger(candidate.quantity)
    && candidate.quantity > 0);
  const slot = facility.inventories?.[productId];
  if (!input || !validDestinationSlot(slot, productId)) return null;

  const freeCapacityUnits = slot.capacity - slot.quantity;
  if (!Number.isSafeInteger(freeCapacityUnits) || freeCapacityUnits <= 0) {
    return null;
  }
  return Object.freeze({ productId, freeCapacityUnits });
}
