import type { ProductDefinition } from '../economy/EconomyData';

export interface FreightSetDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly compatibleProductIds: readonly string[];
  readonly payloadMassKg: number;
  readonly payloadVolumeLitres: number;
  readonly purchasePrice: number;
  readonly runningCostPerActiveTick: number;
}

export type FreightCapacityResult =
  | { ok: true; capacityUnits: number }
  | { ok: false; code: 'incompatible-product' | 'invalid-definition' };

export type FreightSetValidationResult =
  | { valid: true }
  | { valid: false; code: string; referenceId?: string };

export const FLATBED_FREIGHT_SET_ID = 'flatbed-freight-set';
export const FLATBED_TRAIN_PURCHASE_PRICE = 90_000;
export const OPERATING_RESERVE = 20_000;
export const STARTER_ROUTE_RESERVE = 110_000;

const isNonEmptyString = (value: string): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const isPositiveSafeInteger = (value: number): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const invalid = (
  code: string,
  referenceId?: string,
): FreightSetValidationResult => referenceId === undefined
  ? { valid: false, code }
  : { valid: false, code, referenceId };

const freezeFreightSets = (
  sets: readonly FreightSetDefinition[],
): readonly FreightSetDefinition[] => Object.freeze(
  sets.map((set) => Object.freeze({
    ...set,
    compatibleProductIds: Object.freeze([...set.compatibleProductIds]),
  })),
);

export const FREIGHT_SETS: readonly FreightSetDefinition[] =
  freezeFreightSets([{
    id: FLATBED_FREIGHT_SET_ID,
    displayName: 'General Flatbed Set',
    compatibleProductIds: ['logs', 'structural-timber'],
    payloadMassKg: 60_000,
    payloadVolumeLitres: 96_000,
    purchasePrice: FLATBED_TRAIN_PURCHASE_PRICE,
    runningCostPerActiveTick: 20,
  }]);

const freightSetById = new Map(
  FREIGHT_SETS.map((set) => [set.id, set]),
);

export const getFreightSet = (
  id: string,
): FreightSetDefinition | undefined => freightSetById.get(id);

export const capacityForProduct = (
  set: FreightSetDefinition,
  product: ProductDefinition,
): FreightCapacityResult => {
  if (set.compatibleProductIds.indexOf(product.id) === -1) {
    return { ok: false, code: 'incompatible-product' };
  }
  if (!isPositiveSafeInteger(set.payloadMassKg)
    || !isPositiveSafeInteger(set.payloadVolumeLitres)
    || !isPositiveSafeInteger(product.unitMassKg)
    || !isPositiveSafeInteger(product.unitVolumeLitres)) {
    return { ok: false, code: 'invalid-definition' };
  }

  const massCapacity = Math.floor(set.payloadMassKg / product.unitMassKg);
  const volumeCapacity = Math.floor(
    set.payloadVolumeLitres / product.unitVolumeLitres,
  );
  const capacityUnits = Math.min(massCapacity, volumeCapacity);

  return { ok: true, capacityUnits };
};

export const validateFreightSetContent = (
  sets: readonly FreightSetDefinition[],
  products: readonly ProductDefinition[],
): FreightSetValidationResult => {
  const productIds = new Set(products.map((product) => product.id));
  const setIds = new Set<string>();

  for (const set of sets) {
    if (!isNonEmptyString(set.id)
      || !isNonEmptyString(set.displayName)
      || !Array.isArray(set.compatibleProductIds)
      || set.compatibleProductIds.length === 0) {
      return invalid(
        'invalid-freight-set',
        isNonEmptyString(set.id) ? set.id : undefined,
      );
    }
    if (setIds.has(set.id)) {
      return invalid('duplicate-freight-set', set.id);
    }
    setIds.add(set.id);

    if (!isPositiveSafeInteger(set.payloadMassKg)
      || !isPositiveSafeInteger(set.payloadVolumeLitres)
      || !isPositiveSafeInteger(set.purchasePrice)
      || !isPositiveSafeInteger(set.runningCostPerActiveTick)) {
      return invalid('invalid-freight-set-quantity', set.id);
    }

    const compatibleProductIds = new Set<string>();
    for (const productId of set.compatibleProductIds) {
      if (!isNonEmptyString(productId)) {
        return invalid('invalid-compatible-product');
      }
      if (compatibleProductIds.has(productId)) {
        return invalid('duplicate-compatible-product', productId);
      }
      if (!productIds.has(productId)) {
        return invalid('unknown-compatible-product', productId);
      }
      compatibleProductIds.add(productId);
    }
  }

  return { valid: true };
};
