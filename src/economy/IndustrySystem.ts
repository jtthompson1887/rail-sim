import type {
  FacilityDefinition,
  FacilityEconomyDef,
  FacilityId,
  IndustryBlocker,
  InventorySlotDef,
  ProductId,
  RecipeDefinition,
} from './EconomyData';

export interface IndustryProductDelta {
  productId: ProductId;
  units: number;
}

export interface ExtractionReceipt {
  facilityId: FacilityId;
  productId: ProductId;
  units: number;
  kind: 'resource-extraction';
}

export interface IndustryTickResult {
  facility: FacilityEconomyDef;
  blocker: IndustryBlocker;
  completedBatches: 0 | 1;
  productDeltas: IndustryProductDelta[];
  receipts: ExtractionReceipt[];
}

export type InventoryBoundaryKind =
  | 'import'
  | 'consumption'
  | 'export';

export interface FacilityBoundaryResult {
  acceptedUnits: number;
  kind: InventoryBoundaryKind;
  facility: FacilityEconomyDef;
  receipt:
    | {
      facilityId: FacilityId;
      productId: ProductId;
      units: number;
      kind: InventoryBoundaryKind;
    }
    | null;
}

const BOUNDARY_KINDS = new Set<string>([
  'import',
  'consumption',
  'export',
]);

const isNonNegativeSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const isUsableSlot = (
  value: unknown,
  productId: ProductId,
): value is InventorySlotDef => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const slot = value as InventorySlotDef;
  return slot.productId === productId
  && isNonNegativeSafeInteger(slot.quantity)
  && isNonNegativeSafeInteger(slot.reservedQuantity)
  && Number.isSafeInteger(slot.capacity)
  && slot.capacity > 0
  && isNonNegativeSafeInteger(slot.recentInflow)
  && isNonNegativeSafeInteger(slot.recentOutflow)
  && slot.reservedQuantity <= slot.quantity
  && slot.quantity <= slot.capacity;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneFacility = (
  facility: FacilityEconomyDef,
): FacilityEconomyDef => {
  if (!isRecord(facility.inventories)) {
    return {
      ...facility,
      railAccess: isRecord(facility.railAccess)
        ? { ...facility.railAccess }
        : facility.railAccess,
      inventories: facility.inventories,
    };
  }
  const inventories: Record<ProductId, InventorySlotDef> = {};
  Object.keys(facility.inventories).forEach((productId) => {
    const slot = facility.inventories[productId];
    inventories[productId] = (
      isRecord(slot) ? { ...slot } : slot
    ) as InventorySlotDef;
  });
  return {
    ...facility,
    railAccess: isRecord(facility.railAccess)
      ? { ...facility.railAccess }
      : facility.railAccess,
    inventories,
  };
};

const getInventorySlot = (
  facility: FacilityEconomyDef,
  productId: ProductId,
): unknown => isRecord(facility.inventories)
  ? facility.inventories[productId]
  : undefined;

interface ProductBatch {
  productId: ProductId;
  inputUnits: number;
  outputUnits: number;
}

type AggregateRecipeResult =
  | { valid: true; batches: ProductBatch[] }
  | { valid: false; blocker: 'waiting-input' | 'output-full' };

const aggregateRecipe = (
  recipe: RecipeDefinition,
): AggregateRecipeResult => {
  const byProductId = new Map<ProductId, ProductBatch>();
  for (const input of recipe.inputs) {
    const batch = byProductId.get(input.productId) ?? {
      productId: input.productId,
      inputUnits: 0,
      outputUnits: 0,
    };
    const inputUnits = batch.inputUnits + input.quantity;
    if (!Number.isSafeInteger(inputUnits)) {
      return { valid: false, blocker: 'waiting-input' };
    }
    batch.inputUnits = inputUnits;
    byProductId.set(input.productId, batch);
  }
  for (const output of recipe.outputs) {
    const batch = byProductId.get(output.productId) ?? {
      productId: output.productId,
      inputUnits: 0,
      outputUnits: 0,
    };
    const outputUnits = batch.outputUnits + output.quantity;
    if (!Number.isSafeInteger(outputUnits)) {
      return { valid: false, blocker: 'output-full' };
    }
    batch.outputUnits = outputUnits;
    byProductId.set(output.productId, batch);
  }
  return { valid: true, batches: Array.from(byProductId.values()) };
};

const unchangedTick = (
  facility: FacilityEconomyDef,
  blocker: IndustryBlocker,
): IndustryTickResult => ({
  facility: cloneFacility(facility),
  blocker,
  completedBatches: 0,
  productDeltas: [],
  receipts: [],
});

export const advanceFacilityRecipe = (
  facility: FacilityEconomyDef,
  recipe: RecipeDefinition,
): IndustryTickResult => {
  if (facility.activeRecipeId === null
    || facility.activeRecipeId !== recipe.id
    || !isNonNegativeSafeInteger(facility.recipeProgressTicks)
    || facility.recipeProgressTicks >= recipe.cycleTicks) {
    return unchangedTick(facility, 'idle');
  }

  const aggregate = aggregateRecipe(recipe);
  if (aggregate.valid === false) {
    return unchangedTick(facility, aggregate.blocker);
  }

  for (const batch of aggregate.batches) {
    if (batch.inputUnits === 0) continue;
    const slot = getInventorySlot(facility, batch.productId);
    if (!isUsableSlot(slot, batch.productId)
      || slot.quantity - slot.reservedQuantity < batch.inputUnits
      || !Number.isSafeInteger(slot.recentOutflow + batch.inputUnits)) {
      return unchangedTick(facility, 'waiting-input');
    }
  }

  for (const batch of aggregate.batches) {
    if (batch.outputUnits === 0) continue;
    const slot = getInventorySlot(facility, batch.productId);
    if (!isUsableSlot(slot, batch.productId)) {
      return unchangedTick(facility, 'output-full');
    }
    const finalQuantity = slot.quantity
      - batch.inputUnits
      + batch.outputUnits;
    if (!Number.isSafeInteger(finalQuantity)
      || finalQuantity < slot.reservedQuantity
      || finalQuantity > slot.capacity
      || !Number.isSafeInteger(slot.recentInflow + batch.outputUnits)) {
      return unchangedTick(facility, 'output-full');
    }
  }

  const nextProgressTicks = facility.recipeProgressTicks + 1;
  if (nextProgressTicks < recipe.cycleTicks) {
    return {
      facility: {
        ...cloneFacility(facility),
        recipeProgressTicks: nextProgressTicks,
      },
      blocker: 'working',
      completedBatches: 0,
      productDeltas: [],
      receipts: [],
    };
  }

  const nextFacility = cloneFacility(facility);
  const productDeltas: IndustryProductDelta[] = [];
  const receipts: ExtractionReceipt[] = [];
  for (const batch of aggregate.batches) {
    const slot = nextFacility.inventories[batch.productId];
    slot.quantity += batch.outputUnits - batch.inputUnits;
    slot.recentOutflow += batch.inputUnits;
    slot.recentInflow += batch.outputUnits;
    productDeltas.push({
      productId: batch.productId,
      units: batch.outputUnits - batch.inputUnits,
    });
    if (recipe.kind === 'resource-extraction' && batch.outputUnits > 0) {
      receipts.push({
        facilityId: facility.id,
        productId: batch.productId,
        units: batch.outputUnits,
        kind: 'resource-extraction',
      });
    }
  }
  nextFacility.recipeProgressTicks = 0;

  return {
    facility: nextFacility,
    blocker: 'working',
    completedBatches: 1,
    productDeltas,
    receipts,
  };
};

const unchangedBoundary = (
  facility: FacilityEconomyDef,
  kind: InventoryBoundaryKind,
): FacilityBoundaryResult => ({
  acceptedUnits: 0,
  kind,
  facility,
  receipt: null,
});

export const applyFacilityBoundary = (
  facility: FacilityEconomyDef,
  definition: FacilityDefinition,
  productId: ProductId,
  requestedUnits: number,
  kind: InventoryBoundaryKind,
): FacilityBoundaryResult => {
  const kindIsAllowed = BOUNDARY_KINDS.has(kind);
  const boundaryIsAllowed = (
    (kind === 'import' || kind === 'export')
      && definition.boundary === 'port'
  ) || (
    kind === 'consumption'
      && definition.boundary === 'town-consumer'
  );
  const definitionHasProduct = definition.inventory.some(
    (slot) => slot.productId === productId,
  );
  const slot = getInventorySlot(facility, productId);

  if (!kindIsAllowed
    || !boundaryIsAllowed
    || facility.definitionId !== definition.id
    || !definitionHasProduct
    || !Number.isSafeInteger(requestedUnits)
    || requestedUnits <= 0
    || !isUsableSlot(slot, productId)) {
    return unchangedBoundary(facility, kind);
  }

  const acceptedUnits = kind === 'import'
    ? Math.min(requestedUnits, slot.capacity - slot.quantity)
    : Math.min(requestedUnits, slot.quantity - slot.reservedQuantity);
  if (acceptedUnits === 0) {
    return unchangedBoundary(facility, kind);
  }

  const nextCounter = kind === 'import'
    ? slot.recentInflow + acceptedUnits
    : slot.recentOutflow + acceptedUnits;
  if (!Number.isSafeInteger(nextCounter)) {
    return unchangedBoundary(facility, kind);
  }

  const nextFacility = cloneFacility(facility);
  const nextSlot = nextFacility.inventories[productId];
  if (kind === 'import') {
    nextSlot.quantity += acceptedUnits;
    nextSlot.recentInflow = nextCounter;
  } else {
    nextSlot.quantity -= acceptedUnits;
    nextSlot.recentOutflow = nextCounter;
  }

  return {
    acceptedUnits,
    kind,
    facility: nextFacility,
    receipt: {
      facilityId: facility.id,
      productId,
      units: acceptedUnits,
      kind,
    },
  };
};
