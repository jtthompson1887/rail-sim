import type {
  FacilityEconomyDef,
  InventorySlotDef,
  ProductDefinition,
  RecipeDefinition,
} from '../economy/EconomyData';
import type { TrainDef } from '../config/WorldData';
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

const productDefinition = (
  productId: string,
): ProductDefinition | null => {
  const product = getProduct(productId) as unknown;
  return isRecord(product) && product.id === productId
    ? product as unknown as ProductDefinition
    : null;
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

export function canContinueConsignment(
  train: TrainDef,
  facility: FacilityEconomyDef,
  capacityUnits: number,
): boolean {
  const cargo = train.cargo;
  return cargo !== null
    && cargo.originFacilityId === facility.id
    && Number.isSafeInteger(cargo.units)
    && Number.isSafeInteger(cargo.loadedUnits)
    && cargo.units === cargo.loadedUnits
    && cargo.loadedUnits >= 0
    && cargo.loadedUnits < capacityUnits;
}

export function potentialLoadProducts(
  facility: FacilityEconomyDef,
  freightSet: FreightSetDefinition,
): readonly LoadableProduct[] {
  const definition = getFacilityDefinition(facility.definitionId);
  const recipe = activeRecipe(facility);
  if (!definition || !Array.isArray(freightSet.compatibleProductIds)) {
    return EMPTY_LOAD_PRODUCTS;
  }

  const candidates: OrderedLoadableProduct[] = [];
  const includedProductIds = new Set<string>();
  const addCandidate = (
    productId: string,
    recipeOrder: number,
  ): void => {
    if (includedProductIds.has(productId)
      || !hasProductDefinition(productId)
      || freightSet.compatibleProductIds.indexOf(productId) === -1) {
      return;
    }
    const slot = facility.inventories?.[productId];
    if (!validInventorySlot(slot, productId)) return;
    const availableUnits = slot.quantity - slot.reservedQuantity;
    if (!Number.isSafeInteger(availableUnits)) return;

    includedProductIds.add(productId);
    candidates.push({
      productId,
      availableUnits,
      recipeOrder,
    });
  };

  const recipeOutputs = recipe && Array.isArray(recipe.outputs)
    ? recipe.outputs
    : [];
  recipeOutputs.forEach((output, recipeOrder) => {
    if (typeof output?.productId !== 'string'
      || !Number.isSafeInteger(output.quantity)
      || output.quantity <= 0) {
      return;
    }
    addCandidate(output.productId, recipeOrder);
  });
  if (definition.boundary === 'port'
    && Array.isArray(definition.inventory)) {
    definition.inventory.forEach((template, inventoryOrder) => {
      if (typeof template?.productId !== 'string') return;
      const product = productDefinition(template.productId);
      if (product?.category !== 'imported-material') return;
      addCandidate(
        product.id,
        recipeOutputs.length + inventoryOrder,
      );
    });
  }
  candidates.sort((left, right) => left.recipeOrder - right.recipeOrder
    || left.productId.localeCompare(right.productId));

  return Object.freeze(candidates.map(({ productId, availableUnits }) =>
    Object.freeze({ productId, availableUnits })));
}

export function eligibleLoadProducts(
  facility: FacilityEconomyDef,
  freightSet: FreightSetDefinition,
): readonly LoadableProduct[] {
  const candidates = potentialLoadProducts(facility, freightSet)
    .filter(({ availableUnits }) => availableUnits > 0);
  return candidates.length === 0
    ? EMPTY_LOAD_PRODUCTS
    : Object.freeze(candidates);
}

export function potentialAcceptedProduct(
  facility: FacilityEconomyDef,
  productId: string,
): AcceptedProduct | null {
  const definition = getFacilityDefinition(facility.definitionId);
  const recipe = activeRecipe(facility);
  const product = productDefinition(productId);
  if (!definition || !product) {
    return null;
  }
  const recipeInput = recipe && Array.isArray(recipe.inputs)
    ? recipe.inputs.find((candidate) =>
      candidate?.productId === productId
      && Number.isSafeInteger(candidate.quantity)
      && candidate.quantity > 0)
    : undefined;
  const boundaryInput = definition.boundary === 'town-consumer'
    && product.category === 'finished-good'
    && Array.isArray(definition.inventory)
    && definition.inventory.some((template) =>
      template?.productId === product.id);
  const slot = facility.inventories?.[productId];
  if ((!recipeInput && !boundaryInput)
    || !validInventorySlot(slot, productId)) return null;

  const freeCapacityUnits = slot.capacity - slot.quantity;
  if (!Number.isSafeInteger(freeCapacityUnits)) return null;
  return Object.freeze({ productId, freeCapacityUnits });
}

export function facilityAcceptsProduct(
  facility: FacilityEconomyDef,
  productId: string,
): AcceptedProduct | null {
  const candidate = potentialAcceptedProduct(facility, productId);
  return candidate && candidate.freeCapacityUnits > 0 ? candidate : null;
}
