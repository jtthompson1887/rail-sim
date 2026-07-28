import type { WorldData } from '../config/WorldData';
import type {
  FacilityId,
  ProductId,
} from './EconomyData';
import { advanceFacilityRecipe } from './IndustrySystem';
import { quoteLocalProduct } from './MarketSystem';
import {
  capacityForProduct,
  FREIGHT_SETS,
} from '../freight/FreightSetCatalog';
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
  activeRecipe: {
    id: string;
    displayName: string;
    cycleTicks: number;
    progressTicks: number;
    inputs: Array<{
      productId: ProductId;
      displayName: string;
      unitLabel: string;
      quantity: number;
    }>;
    outputs: Array<{
      productId: ProductId;
      displayName: string;
      unitLabel: string;
      quantity: number;
    }>;
    fullLoad: {
      freightSetId: string;
      freightSetDisplayName: string;
      inputQuantity: number;
      outputQuantity: number;
      cycles: number;
    } | null;
  } | null;
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
    fullLoadQuantity: number | null;
    fullLoadGross: number | null;
    factors: Array<{ id: string; basisPoints: number }>;
  }>;
  railConnected: boolean;
}

const RECIPE_NAMES: Record<string, string> = {
  'forest-harvest': 'Forest harvest',
  'quarry-extraction': 'Quarry extraction',
  'sawmill-cut': 'Sawmill cut',
  'cement-kiln': 'Cement kiln',
  'module-assembly': 'Module assembly',
};

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
  if (blocker === 'working') {
    return {
      code: 'working',
      label: `Working ${facility.recipeProgressTicks} / ${recipe.cycleTicks} ticks`,
    };
  }
  return { code: 'idle', label: 'Idle' };
}

function freezeInspection(
  dto: FacilityInspectionDto,
): FacilityInspectionDto {
  Object.freeze(dto.status);
  if (dto.activeRecipe) {
    dto.activeRecipe.inputs.forEach(Object.freeze);
    dto.activeRecipe.outputs.forEach(Object.freeze);
    Object.freeze(dto.activeRecipe.inputs);
    Object.freeze(dto.activeRecipe.outputs);
    if (dto.activeRecipe.fullLoad) {
      Object.freeze(dto.activeRecipe.fullLoad);
    }
    Object.freeze(dto.activeRecipe);
  }
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
  const recipeInputs = recipe
    ? recipe.inputs.reduce<
      NonNullable<FacilityInspectionDto['activeRecipe']>['inputs']
    >((all, input) => {
      const product = getProduct(input.productId);
      if (product) all.push({
        productId: input.productId,
        displayName: product.displayName,
        unitLabel: product.unitLabel,
        quantity: input.quantity,
      });
      return all;
    }, [])
    : [];
  const recipeOutputs = recipe
    ? recipe.outputs.reduce<
      NonNullable<FacilityInspectionDto['activeRecipe']>['outputs']
    >((all, output) => {
      const product = getProduct(output.productId);
      if (product) all.push({
        productId: output.productId,
        displayName: product.displayName,
        unitLabel: product.unitLabel,
        quantity: output.quantity,
      });
      return all;
    }, [])
    : [];
  const primaryInput = recipeInputs.length === 1
    ? recipeInputs[0]
    : undefined;
  const primaryOutput = recipeOutputs.length === 1
    ? recipeOutputs[0]
    : undefined;
  const inputProduct = primaryInput
    ? getProduct(primaryInput.productId)
    : undefined;
  const fullLoadFreightSet = inputProduct
    ? FREIGHT_SETS.find((set) =>
      set.compatibleProductIds.indexOf(inputProduct.id) !== -1)
    : undefined;
  const capacity = inputProduct && fullLoadFreightSet
    ? capacityForProduct(fullLoadFreightSet, inputProduct)
    : null;
  const cycles = capacity?.ok === true && primaryInput
    && capacity.capacityUnits % primaryInput.quantity === 0
    ? capacity.capacityUnits / primaryInput.quantity
    : null;
  const fullLoadInputQuantity = capacity?.ok === true
    ? capacity.capacityUnits
    : null;
  const fullLoad = cycles !== null && primaryOutput && fullLoadFreightSet
    && fullLoadInputQuantity !== null
    ? {
      freightSetId: fullLoadFreightSet.id,
      freightSetDisplayName: fullLoadFreightSet.displayName,
      inputQuantity: fullLoadInputQuantity,
      outputQuantity: primaryOutput.quantity * cycles,
      cycles,
    }
    : null;
  const activeRecipe = recipe
    ? {
      id: recipe.id,
      displayName: RECIPE_NAMES[recipe.id] ?? 'Production recipe',
      cycleTicks: recipe.cycleTicks,
      progressTicks: facility.recipeProgressTicks,
      inputs: recipeInputs,
      outputs: recipeOutputs,
      fullLoad,
    }
    : null;
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
  const quotes = needs.reduce<FacilityInspectionDto['quotes']>((all, productId) => {
    const slot = facility.inventories[productId];
    if (!slot) return all;
    const quote = quoteLocalProduct(
      productId,
      world.economy.market,
      slot,
    );
    const quoteFullLoadQuantity = activeRecipe?.fullLoad
      && activeRecipe.inputs[0]?.productId === productId
      ? activeRecipe.fullLoad.inputQuantity
      : null;
    const fullLoadGross = quote.ok && quoteFullLoadQuantity !== null
      && Number.isSafeInteger(quote.unitPrice * quoteFullLoadQuantity)
      ? quote.unitPrice * quoteFullLoadQuantity
      : null;
    if (quote.ok) all.push({
      productId: quote.productId,
      displayName:
        getProduct(quote.productId)?.displayName ?? 'Unknown product',
      unitLabel: getProduct(quote.productId)?.unitLabel ?? 'unit',
      unitPrice: quote.unitPrice,
      fullLoadQuantity: quoteFullLoadQuantity,
      fullLoadGross,
      factors: quote.factors.map((factor) => ({ ...factor })),
    });
    return all;
  }, []);
  return freezeInspection({
    id: facility.id,
    name: facility.name,
    status: buildStatus(world, facility.id, railConnected),
    activeRecipe,
    produces,
    needs,
    inputRows,
    outputRows,
    inventories,
    quotes,
    railConnected,
  });
}
