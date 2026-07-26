import type { WorldData } from '../config/WorldData';
import type {
  FacilityId,
  ProductId,
} from './EconomyData';
import { advanceFacilityRecipe } from './IndustrySystem';
import { quoteLocalProduct } from './MarketSystem';
import {
  getFacilityDefinition,
  getProduct,
  getRecipe,
} from './ProductCatalog';

export interface FacilityInspectionDto {
  id: FacilityId;
  name: string;
  status: {
    code:
      | 'working'
      | 'waiting-input'
      | 'output-full'
      | 'waiting-railway'
      | 'idle';
    label: string;
  };
  produces: ProductId[];
  needs: ProductId[];
  inventories: Array<{
    productId: ProductId;
    displayName: string;
    quantity: number;
    capacity: number;
  }>;
  quotes: Array<{
    productId: ProductId;
    unitPrice: number;
    factors: Array<{ id: string; basisPoints: number }>;
  }>;
  railConnected: boolean;
}

function waitingInputLabel(
  world: WorldData,
  facilityId: FacilityId,
): string {
  const facility = world.economy.facilities.find(
    (candidate) => candidate.id === facilityId,
  );
  const recipe = facility?.activeRecipeId
    ? getRecipe(facility.activeRecipeId)
    : undefined;
  const missing = recipe?.inputs.find((amount) => {
    const slot = facility?.inventories[amount.productId];
    return !slot
      || slot.quantity - slot.reservedQuantity < amount.quantity;
  });
  const product = missing ? getProduct(missing.productId) : undefined;
  return product
    ? `Needs ${product.displayName.toLocaleLowerCase('en-GB')}`
    : 'Needs inputs';
}

function buildStatus(
  world: WorldData,
  facilityId: FacilityId,
  railConnected: boolean,
): FacilityInspectionDto['status'] {
  const facility = world.economy.facilities.find(
    (candidate) => candidate.id === facilityId,
  );
  if (!facility?.activeRecipeId) {
    return railConnected
      ? { code: 'idle', label: 'Idle' }
      : { code: 'waiting-railway', label: 'Waiting for railway' };
  }
  const recipe = getRecipe(facility.activeRecipeId);
  if (!recipe) return { code: 'idle', label: 'Idle' };
  const blocker = advanceFacilityRecipe(facility, recipe).blocker;
  if (blocker === 'waiting-input') {
    return {
      code: 'waiting-input',
      label: waitingInputLabel(world, facilityId),
    };
  }
  if (blocker === 'output-full') {
    return { code: 'output-full', label: 'Output storage full' };
  }
  if (blocker === 'working') return { code: 'working', label: 'Working' };
  return { code: 'idle', label: 'Idle' };
}

function freezeInspection(
  dto: FacilityInspectionDto,
): FacilityInspectionDto {
  Object.freeze(dto.status);
  dto.inventories.forEach(Object.freeze);
  dto.quotes.forEach((quote) => {
    quote.factors.forEach(Object.freeze);
    Object.freeze(quote.factors);
    Object.freeze(quote);
  });
  Object.freeze(dto.produces);
  Object.freeze(dto.needs);
  Object.freeze(dto.inventories);
  Object.freeze(dto.quotes);
  return Object.freeze(dto);
}

/** Builds a detached, immutable presentation snapshot from persisted state. */
export function buildFacilityInspection(
  world: WorldData,
  facilityId: FacilityId,
  railConnected: boolean,
): FacilityInspectionDto | null {
  const facility = world.economy.facilities.find(
    (candidate) => candidate.id === facilityId,
  );
  if (!facility || !getFacilityDefinition(facility.definitionId)) return null;
  const recipe = facility.activeRecipeId
    ? getRecipe(facility.activeRecipeId)
    : undefined;
  const needs = recipe
    ? Array.from(new Set(recipe.inputs.map(({ productId }) => productId)))
    : [];
  const produces = recipe
    ? Array.from(new Set(recipe.outputs.map(({ productId }) => productId)))
    : [];
  const slots = Object.keys(facility.inventories).map(
    (productId) => facility.inventories[productId],
  );
  const inventories = slots.map((slot) => ({
    productId: slot.productId,
    displayName: getProduct(slot.productId)?.displayName ?? slot.productId,
    quantity: slot.quantity,
    capacity: slot.capacity,
  }));
  const quotes = slots.reduce<FacilityInspectionDto['quotes']>((all, slot) => {
    const quote = quoteLocalProduct(
      slot.productId,
      world.economy.market,
      slot,
    );
    if (quote.ok) all.push({
      productId: quote.productId,
      unitPrice: quote.unitPrice,
      factors: quote.factors.map((factor) => ({ ...factor })),
    });
    return all;
  }, []);
  return freezeInspection({
    id: facility.id,
    name: facility.name,
    status: buildStatus(world, facility.id, railConnected),
    produces,
    needs,
    inventories,
    quotes,
    railConnected,
  });
}
