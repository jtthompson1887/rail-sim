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
  inputRows: Array<{
    productId: ProductId;
    displayName: string;
    unitLabel: string;
    requiredQuantity: number;
    availableQuantity: number;
    missingQuantity: number;
  }>;
  outputRows: Array<{
    productId: ProductId;
    displayName: string;
    unitLabel: string;
    cycleQuantity: number;
  }>;
  inventories: Array<{
    productId: ProductId;
    displayName: string;
    unitLabel: string;
    quantity: number;
    capacity: number;
  }>;
  quotes: Array<{
    productId: ProductId;
    displayName: string;
    unitLabel: string;
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
  const missingNames = recipe?.inputs.reduce<string[]>((names, amount) => {
    const slot = facility?.inventories[amount.productId];
    if (slot
      && slot.quantity - slot.reservedQuantity >= amount.quantity) {
      return names;
    }
    const product = getProduct(amount.productId);
    if (product) {
      names.push(product.displayName.toLocaleLowerCase('en-GB'));
    }
    return names;
  }, []) ?? [];
  if (missingNames.length === 0) return 'Needs inputs';
  if (missingNames.length === 1) return `Needs ${missingNames[0]}`;
  if (missingNames.length === 2) {
    return `Needs ${missingNames[0]} and ${missingNames[1]}`;
  }
  return `Needs ${missingNames.slice(0, -1).join(', ')}, and `
    + missingNames[missingNames.length - 1];
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
  dto.inputRows.forEach(Object.freeze);
  dto.outputRows.forEach(Object.freeze);
  Object.freeze(dto.inputRows);
  Object.freeze(dto.outputRows);
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
  const inputRows = recipe
    ? recipe.inputs.reduce<FacilityInspectionDto['inputRows']>(
      (rows, input) => {
        const product = getProduct(input.productId);
        const slot = facility.inventories[input.productId];
        if (!product || !slot) return rows;
        const availableQuantity = Math.max(
          0,
          slot.quantity - slot.reservedQuantity,
        );
        rows.push({
          productId: input.productId,
          displayName: product.displayName,
          unitLabel: product.unitLabel,
          requiredQuantity: input.quantity,
          availableQuantity,
          missingQuantity: Math.max(
            0,
            input.quantity - availableQuantity,
          ),
        });
        return rows;
      },
      [],
    )
    : [];
  const outputRows = recipe
    ? recipe.outputs.reduce<FacilityInspectionDto['outputRows']>(
      (rows, output) => {
        const product = getProduct(output.productId);
        if (!product) return rows;
        rows.push({
          productId: output.productId,
          displayName: product.displayName,
          unitLabel: product.unitLabel,
          cycleQuantity: output.quantity,
        });
        return rows;
      },
      [],
    )
    : [];
  const slots = Object.keys(facility.inventories).map(
    (productId) => facility.inventories[productId],
  );
  const inventories = slots.map((slot) => ({
    productId: slot.productId,
    displayName: getProduct(slot.productId)?.displayName ?? 'Unknown product',
    unitLabel: getProduct(slot.productId)?.unitLabel ?? 'unit',
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
      displayName:
        getProduct(quote.productId)?.displayName ?? 'Unknown product',
      unitLabel: getProduct(quote.productId)?.unitLabel ?? 'unit',
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
    inputRows,
    outputRows,
    inventories,
    quotes,
    railConnected,
  });
}
