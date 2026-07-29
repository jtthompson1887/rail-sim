import type { TrainDef, WorldData } from '../config/WorldData';
import type { CompanyStateDef } from '../economy/EconomyData';
import { summariseProfitAndLoss } from '../economy/FinanceLedger';
import { getProduct } from '../economy/ProductCatalog';
import type {
  CargoBlockerCode,
  CargoTransferStatus,
} from './CargoSystem';
import {
  canContinueConsignment,
  potentialAcceptedProduct,
  potentialLoadProducts,
} from './FacilityCargoRules';
import {
  capacityForProduct,
  FLATBED_FREIGHT_SET_ID,
  getFreightSet,
} from './FreightSetCatalog';
import type {
  FreightSetDefinition,
} from './FreightSetCatalog';
import type {
  FreightPurchaseBlocker,
  FreightPurchaseQuote,
} from './FreightPurchaseService';
import type { TrainRuntimeSnapshot } from './TrainRuntime';

export interface OperatingSummaryDto {
  readonly fromTick: number;
  readonly throughTick: number;
  readonly deliveryRevenue: number;
  readonly contractBonuses: number;
  readonly runningExpenses: number;
  readonly operatingProfit: number;
  readonly capitalExpenditure: number;
  readonly cashFlow: number;
}

export interface FreightPurchaseDto {
  readonly freightSetId: typeof FLATBED_FREIGHT_SET_ID;
  readonly displayName: string;
  readonly price: number;
  readonly compatibleCargoLabel: string;
  readonly capacityLabel: string;
  readonly runningCostLabel: string;
  readonly cashAfter: number;
  readonly affordable: boolean;
  readonly validPlacement: boolean;
  readonly remedy: string;
}

export interface TrainInspectionDto {
  readonly trainId: string;
  readonly displayName: string;
  readonly direction: 'forward' | 'neutral' | 'reverse';
  readonly throttle: -1 | 0 | 1;
  readonly movementState: 'stopped' | 'moving' | 'derailed';
  readonly cargo: {
    readonly productLabel: string;
    readonly unitLabel: string;
    readonly units: number;
    readonly capacityUnits: number;
    readonly text: string;
  };
  readonly nearestEligibleFacility: string | null;
  readonly transfer: CargoTransferStatus;
  readonly transferRemedy: string;
  readonly currentTrip: {
    readonly revenue: number;
    readonly runningCost: number;
    readonly operatingProfit: number;
  };
  readonly lastDelivery: {
    readonly revenue: number;
    readonly runningCost: number;
    readonly operatingProfit: number;
  };
  readonly lifetime: {
    readonly deliveredUnits: number;
    readonly revenue: number;
    readonly runningCost: number;
    readonly operatingProfit: number;
  };
}

const PURCHASE_REMEDIES: Readonly<
Partial<Record<FreightPurchaseBlocker, string>>
> = Object.freeze({
  'no-track': 'Click on player track to place the General Flatbed Set',
  'outside-forest-access': 'Place inside Managed Forest rail access',
  'disconnected-route': 'Connect Managed Forest and Sawmill first',
  'insufficient-cash': 'Insufficient cash for General Flatbed Set',
  'duplicate-gesture': 'Purchase already in progress',
});

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    const record = value as unknown as Record<string, unknown>;
    Object.keys(record).forEach((key) => deepFreeze(record[key]));
    Object.freeze(value);
  }
  return value;
};

const pluralUnit = (unitLabel: string, units: number): string =>
  units === 1 ? unitLabel : `${unitLabel}s`;

const compactUnit = (unitLabel: string): string =>
  unitLabel === 'tonne' ? 't' : pluralUnit(unitLabel, 2);

const capacityFor = (
  freightSet: FreightSetDefinition | undefined,
  productId: string | null,
): number => {
  if (!freightSet || !productId) return 0;
  const product = getProduct(productId);
  if (!product) return 0;
  const capacity = capacityForProduct(freightSet, product);
  return capacity.ok ? capacity.capacityUnits : 0;
};

export function formatFreightPurchaseRemedy(
  blocker: FreightPurchaseBlocker,
): string {
  return PURCHASE_REMEDIES[blocker]
    ?? 'General Flatbed Set purchase could not be completed';
}

export function formatCargoRemedy(
  world: WorldData,
  freightSetId: string,
  transfer: CargoTransferStatus,
): string {
  const blocker = transfer.blocker;
  if (!blocker) return '';
  const freightSet = getFreightSet(freightSetId);
  const product = transfer.productId
    ? getProduct(transfer.productId)
    : undefined;
  const facility = transfer.facilityId
    ? world.economy.facilities.find(({ id }) => id === transfer.facilityId)
    : undefined;
  const setName = freightSet?.displayName ?? 'This train';
  const productName = product?.displayName ?? 'this cargo';
  const facilityName = facility?.name ?? 'the eligible facility';
  const remedies: Record<CargoBlockerCode, string> = {
    'not-operating': 'Resume the game to transfer cargo',
    derailed: 'Rerail the train to transfer cargo',
    'train-moving': 'Stop the train to transfer cargo',
    'unknown-freight-set': 'This train has no recognised freight set',
    'incompatible-product': `${setName} cannot carry ${productName}`,
    'outside-eligible-facility': `Move inside ${facilityName} rail access`,
    'source-empty': `${facilityName} has no ${productName} available`,
    'train-full': `${setName} is full of ${productName}`,
    'destination-full': `${facilityName} ${productName} storage is full`,
    'product-not-accepted': `${facilityName} does not accept ${productName}`,
    'insufficient-running-cash': 'Add cash to cover train running costs',
  };
  return remedies[blocker];
}

export function buildOperatingSummary(
  company: CompanyStateDef,
  economyTick: number,
): OperatingSummaryDto {
  const fromTick = Math.max(0, economyTick - 23);
  const summary = summariseProfitAndLoss(company, fromTick, economyTick);
  return Object.freeze({
    fromTick,
    throughTick: economyTick,
    deliveryRevenue: summary.deliveryRevenue,
    contractBonuses: summary.contractBonuses,
    runningExpenses: summary.operatingExpenses,
    operatingProfit: summary.railwayOperatingProfit,
    capitalExpenditure: summary.capitalExpenditure,
    cashFlow: summary.cashFlow,
  });
}

const relevantFacilityName = (
  world: WorldData,
  runtime: TrainRuntimeSnapshot,
  transfer: CargoTransferStatus,
  freightSet: FreightSetDefinition | undefined,
  train: TrainDef,
): string | null => {
  if (transfer.facilityId) {
    return world.economy.facilities.find(
      ({ id }) => id === transfer.facilityId,
    )?.name ?? 'Unknown facility';
  }
  if (!freightSet) return null;

  const cargoProductId = train.cargo?.productId ?? null;
  const contextProductId = cargoProductId ?? transfer.productId;
  const candidates = world.economy.facilities
    .filter((facility) => {
      if (cargoProductId) {
        const source = potentialLoadProducts(facility, freightSet)
          .some(({ productId }) => productId === cargoProductId)
          && canContinueConsignment(
            train,
            facility,
            capacityFor(freightSet, cargoProductId),
          );
        return source
          || potentialAcceptedProduct(facility, cargoProductId) !== null;
      }
      const products = potentialLoadProducts(facility, freightSet);
      return contextProductId
        ? products.some(({ productId }) => productId === contextProductId)
        : products.length > 0;
    })
    .map((facility) => ({
      facility,
      distance: Math.hypot(
        runtime.x - facility.railAccess.x,
        runtime.y - facility.railAccess.y,
      ),
    }))
    .sort((left, right) => left.distance - right.distance
      || left.facility.id.localeCompare(right.facility.id));
  return candidates[0]?.facility.name ?? null;
};

export function buildTrainInspection(
  world: WorldData,
  runtime: TrainRuntimeSnapshot,
  transfer: CargoTransferStatus,
): TrainInspectionDto | null {
  const train = world.trains.find(({ id }) => id === runtime.trainId);
  if (!train || transfer.trainId !== runtime.trainId) return null;

  const freightSet = getFreightSet(train.freightSetId);
  const units = train.cargo?.units ?? 0;
  const contextProductId = train.cargo?.productId ?? transfer.productId;
  const fallbackProductId = freightSet?.compatibleProductIds.find(
    (productId) => capacityFor(freightSet, productId) > 0,
  ) ?? null;
  const presentationProductId = contextProductId ?? fallbackProductId;
  const product = presentationProductId
    ? getProduct(presentationProductId)
    : undefined;
  const capacityUnits = capacityFor(freightSet, presentationProductId);
  const productLabel = train.cargo
    ? product?.displayName ?? 'Unknown cargo'
    : 'Empty';
  const unitLabel = product
    ? pluralUnit(product.unitLabel, capacityUnits)
    : 'units';
  const shortUnit = product ? compactUnit(product.unitLabel) : 'units';
  const transferFacilityKnown = !transfer.facilityId
    || world.economy.facilities.some(({ id }) => id === transfer.facilityId);
  const transferProductKnown = !transfer.productId
    || getProduct(transfer.productId) !== undefined;
  const presentedTransfer: CargoTransferStatus = {
    ...transfer,
    facilityId: transferFacilityKnown ? transfer.facilityId : null,
    productId: transferProductKnown ? transfer.productId : null,
    capacityUnits: transferProductKnown ? transfer.capacityUnits : 0,
  };
  const operations = train.operations;
  return deepFreeze({
    trainId: train.id,
    displayName: freightSet?.displayName ?? 'Unknown freight set',
    direction: runtime.throttle > 0
      ? 'forward' as const
      : runtime.throttle < 0
        ? 'reverse' as const
        : 'neutral' as const,
    throttle: runtime.throttle,
    movementState: runtime.derailed
      ? 'derailed' as const
      : runtime.speedWorldUnitsPerSecond <= 2
        ? 'stopped' as const
        : 'moving' as const,
    cargo: {
      productLabel,
      unitLabel,
      units,
      capacityUnits,
      text: `${productLabel} ${units.toLocaleString('en-GB')} / `
        + `${capacityUnits.toLocaleString('en-GB')} ${shortUnit}`,
    },
    nearestEligibleFacility: relevantFacilityName(
      world,
      runtime,
      transfer,
      freightSet,
      train,
    ),
    transfer: presentedTransfer,
    transferRemedy: formatCargoRemedy(
      world,
      train.freightSetId,
      transfer,
    ),
    currentTrip: {
      revenue: operations.currentTripRevenue,
      runningCost: operations.currentTripRunningCost,
      operatingProfit:
        operations.currentTripRevenue - operations.currentTripRunningCost,
    },
    lastDelivery: {
      revenue: operations.lastTripRevenue,
      runningCost: operations.lastTripRunningCost,
      operatingProfit:
        operations.lastTripRevenue - operations.lastTripRunningCost,
    },
    lifetime: {
      deliveredUnits: operations.lifetimeDeliveredUnits,
      revenue: operations.lifetimeRevenue,
      runningCost: operations.lifetimeRunningCost,
      operatingProfit:
        operations.lifetimeRevenue - operations.lifetimeRunningCost,
    },
  });
}

export function buildFreightPurchasePresentation(
  quote: FreightPurchaseQuote | null,
  cash: number,
): FreightPurchaseDto {
  const freightSet = getFreightSet(FLATBED_FREIGHT_SET_ID);
  if (!freightSet) {
    throw new Error('Approved flatbed freight set is missing');
  }
  const products = freightSet.compatibleProductIds
    .map((productId) => getProduct(productId))
    .filter((product) => product !== undefined);
  const firstProduct = products[0];
  const firstCapacity = firstProduct
    ? capacityForProduct(freightSet, firstProduct)
    : null;
  const capacityUnits = firstCapacity?.ok
    ? firstCapacity.capacityUnits
    : 0;
  const blocker = quote?.blocker ?? 'no-track';
  return Object.freeze({
    freightSetId: FLATBED_FREIGHT_SET_ID,
    displayName: freightSet.displayName,
    price: freightSet.purchasePrice,
    compatibleCargoLabel: products
      .map(({ displayName }) => displayName)
      .join(' · '),
    capacityLabel: firstProduct
      ? `${capacityUnits.toLocaleString('en-GB')} `
        + pluralUnit(firstProduct.unitLabel, capacityUnits)
      : 'Capacity unavailable',
    runningCostLabel:
      `£${freightSet.runningCostPerActiveTick.toLocaleString('en-GB')} `
      + '/ active tick',
    cashAfter: quote?.cashAfter ?? cash - freightSet.purchasePrice,
    affordable: quote?.affordable ?? cash >= freightSet.purchasePrice,
    validPlacement: quote?.valid ?? false,
    remedy: blocker === null ? '' : formatFreightPurchaseRemedy(blocker),
  });
}
