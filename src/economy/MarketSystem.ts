import type {
  InventorySlotDef,
  MarketStateDef,
  ProductId,
} from './EconomyData';
import { getProduct } from './ProductCatalog';
import { createSeededRandom } from '../utils/SeededRandom';

const BASIS_POINTS = 10_000;
const CONSTRUCTION_MIN_BPS = 8_500;
const CONSTRUCTION_MAX_BPS = 11_500;
const REGIONAL_MIN_BPS = 8_000;
const REGIONAL_MAX_BPS = 12_000;
const PRESSURE_MIN_BPS = 7_500;
const PRESSURE_MAX_BPS = 13_000;
const PRESSURE_RANGE_BPS = 3_000;
const MARKET_TICK_CADENCE = 24;
const MARKET_DRIFT_BPS = 25;

export type LocalQuoteResult =
  | {
    ok: true;
    productId: ProductId;
    unitPrice: number;
    factors: Array<{
      id:
        | 'global-construction'
        | 'regional-demand'
        | 'inventory-pressure';
      basisPoints: number;
    }>;
  }
  | {
    ok: false;
    code:
      | 'unknown-product'
      | 'product-slot-mismatch'
      | 'invalid-market-state'
      | 'invalid-inventory'
      | 'price-overflow';
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isBpsWithin = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is number => Number.isSafeInteger(value)
  && (value as number) >= minimum
  && (value as number) <= maximum;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const isValidSlot = (
  slot: Record<string, unknown>,
): boolean => typeof slot.productId === 'string'
  && slot.productId.length > 0
  && isNonNegativeSafeInteger(slot.quantity)
  && isNonNegativeSafeInteger(slot.reservedQuantity)
  && Number.isSafeInteger(slot.capacity)
  && (slot.capacity as number) > 0
  && isNonNegativeSafeInteger(slot.recentInflow)
  && isNonNegativeSafeInteger(slot.recentOutflow)
  && Number.isSafeInteger(slot.targetStock)
  && (slot.targetStock as number) > 0
  && (slot.reservedQuantity as number) <= (slot.quantity as number)
  && (slot.quantity as number) <= (slot.capacity as number)
  && (slot.targetStock as number) <= (slot.capacity as number);

const multiplyBasisPoints = (
  value: number,
  factorBps: number,
): number | null => {
  if (value > Math.floor(Number.MAX_SAFE_INTEGER / factorBps)) {
    return null;
  }
  const multiplied = value * factorBps;
  const rounded = Math.round(multiplied / BASIS_POINTS);
  return Number.isSafeInteger(rounded) ? rounded : null;
};

const normalizeRegionalDemand = (
  value: unknown,
): Record<ProductId, number> => {
  if (!isRecord(value)) return {};

  const normalized: Record<ProductId, number> = {};
  Object.keys(value).forEach((productId) => {
    const storedDemand = value[productId];
    normalized[productId] = Number.isSafeInteger(storedDemand)
      ? clamp(
        storedDemand as number,
        REGIONAL_MIN_BPS,
        REGIONAL_MAX_BPS,
      )
      : BASIS_POINTS;
  });
  return normalized;
};

export const quoteLocalProduct = (
  productId: ProductId,
  market: MarketStateDef,
  slot: InventorySlotDef,
): LocalQuoteResult => {
  const product = getProduct(productId);
  if (product === undefined) {
    return { ok: false, code: 'unknown-product' };
  }

  if (!isRecord(slot)) {
    return { ok: false, code: 'invalid-inventory' };
  }
  if (typeof slot.productId !== 'string' || slot.productId.length === 0) {
    return { ok: false, code: 'invalid-inventory' };
  }
  if (slot.productId !== productId) {
    return { ok: false, code: 'product-slot-mismatch' };
  }

  if (!isRecord(market)
    || !isBpsWithin(
      market.constructionIndexBps,
      CONSTRUCTION_MIN_BPS,
      CONSTRUCTION_MAX_BPS,
    )
    || !isRecord(market.regionalDemandBpsByProduct)) {
    return { ok: false, code: 'invalid-market-state' };
  }
  const regionalDemandBps =
    market.regionalDemandBpsByProduct[productId];
  if (!isBpsWithin(
    regionalDemandBps,
    REGIONAL_MIN_BPS,
    REGIONAL_MAX_BPS,
  )) {
    return { ok: false, code: 'invalid-market-state' };
  }

  if (!isValidSlot(slot)) {
    return { ok: false, code: 'invalid-inventory' };
  }

  const stockDelta = slot.targetStock - slot.quantity;
  if (Math.abs(stockDelta)
    > Math.floor(Number.MAX_SAFE_INTEGER / PRESSURE_RANGE_BPS)) {
    return { ok: false, code: 'invalid-inventory' };
  }
  const pressureDeltaBps = Math.round(
    (stockDelta * PRESSURE_RANGE_BPS) / slot.targetStock,
  );
  const inventoryPressureBps = clamp(
    BASIS_POINTS + pressureDeltaBps,
    PRESSURE_MIN_BPS,
    PRESSURE_MAX_BPS,
  );
  const factors = [
    {
      id: 'global-construction' as const,
      basisPoints: market.constructionIndexBps,
    },
    {
      id: 'regional-demand' as const,
      basisPoints: regionalDemandBps,
    },
    {
      id: 'inventory-pressure' as const,
      basisPoints: inventoryPressureBps,
    },
  ];

  let unitPrice = product.basePrice;
  for (const factor of factors) {
    const nextPrice = multiplyBasisPoints(unitPrice, factor.basisPoints);
    if (nextPrice === null) {
      return { ok: false, code: 'price-overflow' };
    }
    unitPrice = nextPrice;
  }

  return {
    ok: true,
    productId,
    unitPrice,
    factors,
  };
};

export const advanceMarketTick = (
  market: MarketStateDef,
  seed: string,
  economyTick: number,
): MarketStateDef => {
  const marketRecord: Record<string, unknown> = isRecord(market)
    ? market
    : {};
  const storedConstructionIndexBps =
    marketRecord.constructionIndexBps;
  let constructionIndexBps = Number.isSafeInteger(
    storedConstructionIndexBps,
  )
    ? clamp(
      storedConstructionIndexBps as number,
      CONSTRUCTION_MIN_BPS,
      CONSTRUCTION_MAX_BPS,
    )
    : BASIS_POINTS;
  if (Number.isSafeInteger(economyTick)
    && economyTick > 0
    && economyTick % MARKET_TICK_CADENCE === 0) {
    const random = createSeededRandom(
      `${seed}:construction-market:${economyTick}`,
    )();
    const drift = random < (1 / 3)
      ? -MARKET_DRIFT_BPS
      : random < (2 / 3)
        ? 0
        : MARKET_DRIFT_BPS;
    constructionIndexBps = clamp(
      constructionIndexBps + drift,
      CONSTRUCTION_MIN_BPS,
      CONSTRUCTION_MAX_BPS,
    );
  }

  return {
    constructionIndexBps,
    regionalDemandBpsByProduct: normalizeRegionalDemand(
      marketRecord.regionalDemandBpsByProduct,
    ),
  };
};
