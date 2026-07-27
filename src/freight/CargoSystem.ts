import type {
  EconomyStateDef,
  FreightProgressDef,
  TrainDef,
} from '../config/WorldData';
import type {
  CompanyStateDef,
  FacilityEconomyDef,
} from '../economy/EconomyData';
import {
  postLedgerEntry,
  validateCompanyState,
} from '../economy/FinanceLedger';
import {
  REGIONAL_DEVELOPMENT_GRANT,
  REGIONAL_DEVELOPMENT_GRANT_REFERENCE,
} from '../config/FreightProgression';
import { quoteLocalProduct } from '../economy/MarketSystem';
import { getProduct } from '../economy/ProductCatalog';
import { clonePlainData } from '../utils/PlainData';
import {
  capacityForProduct,
  getFreightSet,
} from './FreightSetCatalog';
import type { FreightSetDefinition } from './FreightSetCatalog';
import {
  canContinueConsignment,
  eligibleLoadProducts,
  facilityAcceptsProduct,
  potentialAcceptedProduct,
  potentialLoadProducts,
} from './FacilityCargoRules';
import type { TrainRuntimeSnapshot } from './TrainRuntime';
import { countForwardRegionalDevelopmentGrants } from './FreightProgress';

export type CargoBlockerCode =
  | 'not-operating'
  | 'derailed'
  | 'train-moving'
  | 'unknown-freight-set'
  | 'incompatible-product'
  | 'outside-eligible-facility'
  | 'source-empty'
  | 'train-full'
  | 'destination-full'
  | 'product-not-accepted'
  | 'insufficient-running-cash';

export interface CargoTransferStatus {
  readonly trainId: string;
  readonly facilityId: string | null;
  readonly productId: string | null;
  readonly kind: 'loading' | 'unloading' | 'blocked' | 'idle';
  readonly blocker: CargoBlockerCode | null;
  readonly batchUnits: number;
  readonly cargoUnits: number;
  readonly capacityUnits: number;
  readonly batchRevenue: number;
}

export interface FreightDeliveryEvent {
  readonly trainId: string;
  readonly productId: string;
  readonly units: number;
  readonly destinationFacilityId: string;
  readonly tick: number;
  readonly revenue: number;
  readonly runningCost: number;
  readonly operatingProfit: number;
}

export interface CargoTickProposal {
  readonly company: CompanyStateDef;
  readonly economy: EconomyStateDef;
  readonly trains: readonly TrainDef[];
  readonly freightProgress: FreightProgressDef;
  readonly statuses: readonly CargoTransferStatus[];
  readonly completedDeliveries: readonly FreightDeliveryEvent[];
  readonly changed: boolean;
}

export interface CargoTickInput {
  readonly operating: boolean;
  readonly company: CompanyStateDef;
  readonly economy: EconomyStateDef;
  readonly trains: readonly TrainDef[];
  readonly freightProgress: FreightProgressDef;
  readonly runtime: readonly TrainRuntimeSnapshot[];
}

interface ContainedFacility {
  facility: FacilityEconomyDef;
  distance: number;
}

interface EligibleFacility extends ContainedFacility {
  kind: 'loading' | 'unloading';
  productId: string;
  capacityUnits: number;
}

const BATCH_UNITS = 10;
const TRANSFER_SPEED_LIMIT = 2;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    const record = value as unknown as Record<string, unknown>;
    Object.keys(record).forEach((key) => deepFreeze(record[key]));
    Object.freeze(value);
  }
  return value;
};

const distanceToFacility = (
  runtime: TrainRuntimeSnapshot,
  facility: FacilityEconomyDef,
): number => Math.hypot(
  runtime.x - facility.railAccess.x,
  runtime.y - facility.railAccess.y,
);

const compareFacility = (
  left: ContainedFacility,
  right: ContainedFacility,
): number => left.distance - right.distance
  || left.facility.id.localeCompare(right.facility.id);

const cargoCapacity = (
  freightSet: FreightSetDefinition,
  productId: string,
): number => {
  const product = getProduct(productId);
  if (!product) return 0;
  const result = capacityForProduct(freightSet, product);
  return result.ok ? result.capacityUnits : 0;
};

const currentCargoUnits = (train: TrainDef): number =>
  train.cargo?.units ?? 0;

const status = (
  train: TrainDef,
  capacityUnits: number,
  values: Pick<
    CargoTransferStatus,
    | 'facilityId'
    | 'productId'
    | 'kind'
    | 'blocker'
    | 'batchUnits'
    | 'batchRevenue'
  >,
): CargoTransferStatus => ({
  trainId: train.id,
  ...values,
  cargoUnits: currentCargoUnits(train),
  capacityUnits,
});

const blocked = (
  train: TrainDef,
  capacityUnits: number,
  blocker: CargoBlockerCode,
  facilityId: string | null = null,
  productId: string | null = train.cargo?.productId ?? null,
): CargoTransferStatus => status(train, capacityUnits, {
  facilityId,
  productId,
  kind: 'blocked',
  blocker,
  batchUnits: 0,
  batchRevenue: 0,
});

const sourceAvailability = (
  slot: FacilityEconomyDef['inventories'][string],
): number =>
  slot.quantity - slot.reservedQuantity;

const containedFacilities = (
  runtime: TrainRuntimeSnapshot,
  facilities: readonly FacilityEconomyDef[],
): ContainedFacility[] => facilities
  .map((facility) => ({
    facility,
    distance: distanceToFacility(runtime, facility),
  }))
  .filter(({ facility, distance }) => distance <= facility.railAccess.radius)
  .sort(compareFacility);

const eligibleFacilities = (
  train: TrainDef,
  freightSet: FreightSetDefinition,
  contained: readonly ContainedFacility[],
): EligibleFacility[] => {
  const eligible: EligibleFacility[] = [];
  contained.forEach((candidate) => {
    if (train.cargo === null) {
      const loadable = eligibleLoadProducts(
        candidate.facility,
        freightSet,
      );
      const selected = loadable.find(({ productId }) =>
        cargoCapacity(freightSet, productId) > 0);
      if (selected) {
        eligible.push({
          ...candidate,
          kind: 'loading',
          productId: selected.productId,
          capacityUnits: cargoCapacity(freightSet, selected.productId),
        });
      }
      return;
    }

    const productId = train.cargo.productId;
    const capacityUnits = cargoCapacity(freightSet, productId);
    const canExtend = eligibleLoadProducts(
      candidate.facility,
      freightSet,
    ).some((loadable) => loadable.productId === productId)
      && canContinueConsignment(
        train,
        candidate.facility,
        capacityUnits,
      );
    if (canExtend) {
      eligible.push({
        ...candidate,
        kind: 'loading',
        productId,
        capacityUnits,
      });
    }
    if (facilityAcceptsProduct(candidate.facility, productId)) {
      eligible.push({
        ...candidate,
        kind: 'unloading',
        productId,
        capacityUnits,
      });
    }
  });
  return eligible;
};

const blockerForContainedFacility = (
  train: TrainDef,
  freightSet: FreightSetDefinition,
  facility: FacilityEconomyDef,
): {
  blocker: CargoBlockerCode;
  productId: string | null;
  capacityUnits: number;
} => {
  const cargoProductId = train.cargo?.productId ?? null;
  const potentialSources = potentialLoadProducts(facility, freightSet)
    .filter(({ productId }) =>
      cargoProductId === null || productId === cargoProductId);
  const source = potentialSources[0] ?? null;
  const sourceProductId = source?.productId ?? null;
  const sourceCapacityUnits = sourceProductId === null
    ? 0
    : cargoCapacity(freightSet, sourceProductId);
  const sourceMatchesConsignment = train.cargo === null
    || train.cargo.originFacilityId === facility.id;
  const cargoLoadedUnits = train.cargo?.loadedUnits;
  if (source
    && train.cargo !== null
    && sourceMatchesConsignment
    && (!Number.isSafeInteger(cargoLoadedUnits)
      || (cargoLoadedUnits as number) > sourceCapacityUnits)) {
    return {
      blocker: 'train-full',
      productId: sourceProductId,
      capacityUnits: sourceCapacityUnits,
    };
  }
  const sourceCanExplainBlocker = sourceMatchesConsignment
    && (train.cargo === null
      || train.cargo.units === train.cargo.loadedUnits);
  if (source && sourceCanExplainBlocker) {
    if (source.availableUnits <= 0) {
      return {
        blocker: 'source-empty',
        productId: sourceProductId,
        capacityUnits: sourceCapacityUnits,
      };
    }
    if (train.cargo !== null
      && train.cargo.loadedUnits === sourceCapacityUnits) {
      return {
        blocker: 'train-full',
        productId: sourceProductId,
        capacityUnits: sourceCapacityUnits,
      };
    }
    if (train.cargo === null && sourceCapacityUnits <= 0) {
      return {
        blocker: 'product-not-accepted',
        productId: sourceProductId,
        capacityUnits: sourceCapacityUnits,
      };
    }
  }

  if (cargoProductId !== null) {
    const accepted = potentialAcceptedProduct(facility, cargoProductId);
    if (accepted?.freeCapacityUnits === 0) {
      return {
        blocker: 'destination-full',
        productId: cargoProductId,
        capacityUnits: cargoCapacity(freightSet, cargoProductId),
      };
    }
  }
  return {
    blocker: 'product-not-accepted',
    productId: cargoProductId ?? sourceProductId,
    capacityUnits: cargoProductId === null
      ? 0
      : cargoCapacity(freightSet, cargoProductId),
  };
};

const nearestRelevantFacility = (
  train: TrainDef,
  runtime: TrainRuntimeSnapshot,
  facilities: readonly FacilityEconomyDef[],
  freightSet: FreightSetDefinition,
): (ContainedFacility & { productId: string }) | null => {
  const candidates = facilities
    .map((facility) => {
      const cargo = train.cargo;
      const relevantProductId = cargo === null
        ? potentialLoadProducts(facility, freightSet)[0]?.productId
        : (
          (
            potentialLoadProducts(facility, freightSet)
              .some(({ productId }) => productId === cargo.productId)
            && canContinueConsignment(
              train,
              facility,
              cargoCapacity(freightSet, cargo.productId),
            )
          )
          || potentialAcceptedProduct(facility, cargo.productId) !== null
        ) ? cargo.productId : undefined;
      return relevantProductId === undefined
        ? null
        : {
          facility,
          productId: relevantProductId,
          distance: distanceToFacility(runtime, facility),
        };
    })
    .filter((candidate): candidate is ContainedFacility & {
      productId: string;
    } => candidate !== null)
    .sort(compareFacility);
  return candidates[0] ?? null;
};

const safeSum = (...values: number[]): number | null => {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

const isValidFreightProgress = (
  value: unknown,
): value is FreightProgressDef => isRecord(value)
  && value.progressVersion === 1
  && typeof value.profitableLogDeliveryCompleted === 'boolean'
  && typeof value.developmentGrantAwarded === 'boolean'
  && typeof value.profitableStructuralTimberDeliveryCompleted === 'boolean';

const hasConsistentDevelopmentGrant = (
  company: CompanyStateDef,
  progress: FreightProgressDef,
): boolean => countForwardRegionalDevelopmentGrants(company)
  === (progress.developmentGrantAwarded ? 1 : 0);

interface FatalTransferFailure {
  readonly fatal: true;
}

const FATAL_TRANSFER_FAILURE: FatalTransferFailure = Object.freeze({
  fatal: true,
});

const isFatalTransferFailure = (
  value: unknown,
): value is FatalTransferFailure => value === FATAL_TRANSFER_FAILURE;

const loadBatch = (
  train: TrainDef,
  productId: string,
  capacityUnits: number,
  facility: FacilityEconomyDef,
): CargoTransferStatus | FatalTransferFailure | null => {
  const slot = facility.inventories[productId];
  if (!slot) return null;
  const cargo = train.cargo;
  if (cargo !== null
    && !canContinueConsignment(train, facility, capacityUnits)) {
    return null;
  }
  const loadedBefore = cargo?.loadedUnits ?? 0;
  const accepted = Math.min(
    BATCH_UNITS,
    sourceAvailability(slot),
    capacityUnits - loadedBefore,
  );
  const recentOutflow = safeSum(slot.recentOutflow, accepted);
  const cargoUnits = safeSum(cargo?.units ?? 0, accepted);
  const loadedUnits = safeSum(loadedBefore, accepted);
  if (accepted <= 0) return null;
  if (recentOutflow === null
    || cargoUnits === null
    || loadedUnits === null
    || cargoUnits > capacityUnits
    || loadedUnits > capacityUnits) return FATAL_TRANSFER_FAILURE;

  slot.quantity -= accepted;
  slot.recentOutflow = recentOutflow;
  if (cargo) {
    cargo.units = cargoUnits;
    cargo.loadedUnits = loadedUnits;
  } else {
    train.cargo = {
      productId,
      units: accepted,
      loadedUnits,
      originFacilityId: facility.id,
    };
  }
  return status(train, capacityUnits, {
    facilityId: facility.id,
    productId,
    kind: 'loading',
    blocker: null,
    batchUnits: accepted,
    batchRevenue: 0,
  });
};

interface UnloadResult {
  status: CargoTransferStatus;
  company: CompanyStateDef;
  completedDelivery: FreightDeliveryEvent | null;
}

const unloadBatch = (
  train: TrainDef,
  capacityUnits: number,
  facility: FacilityEconomyDef,
  economy: EconomyStateDef,
  company: CompanyStateDef,
  progress: FreightProgressDef,
): UnloadResult | FatalTransferFailure | null => {
  const cargo = train.cargo;
  if (!cargo) return null;
  const acceptedProduct = facilityAcceptsProduct(
    facility,
    cargo.productId,
  );
  const slot = facility.inventories[cargo.productId];
  if (!acceptedProduct || !slot) return null;

  const quote = quoteLocalProduct(cargo.productId, economy.market, slot);
  if (quote.ok === false) return FATAL_TRANSFER_FAILURE;
  const accepted = Math.min(
    BATCH_UNITS,
    cargo.units,
    slot.capacity - slot.quantity,
  );
  const batchRevenue = accepted * quote.unitPrice;
  const destinationQuantity = safeSum(slot.quantity, accepted);
  const recentInflow = safeSum(slot.recentInflow, accepted);
  const tripRevenue = safeSum(
    train.operations.currentTripRevenue,
    batchRevenue,
  );
  const lifetimeDeliveredUnits = safeSum(
    train.operations.lifetimeDeliveredUnits,
    accepted,
  );
  const lifetimeRevenue = safeSum(
    train.operations.lifetimeRevenue,
    batchRevenue,
  );
  if (accepted <= 0) return null;
  if (!Number.isSafeInteger(batchRevenue)
    || batchRevenue <= 0
    || destinationQuantity === null
    || recentInflow === null
    || tripRevenue === null
    || lifetimeDeliveredUnits === null
    || lifetimeRevenue === null) {
    return FATAL_TRANSFER_FAILURE;
  }

  const runningCost = train.operations.currentTripRunningCost;
  const operatingProfit = tripRevenue - runningCost;
  if (!Number.isSafeInteger(operatingProfit)) {
    return FATAL_TRANSFER_FAILURE;
  }
  const deliveryPost = postLedgerEntry(company, {
    category: 'delivery-revenue',
    magnitude: batchRevenue,
    tick: economy.tick,
    referenceId: `${train.id}:${economy.tick}:${facility.id}`,
    direction: 'forward',
  });
  if (deliveryPost.ok === false) return FATAL_TRANSFER_FAILURE;

  const completesDelivery = cargo.units === accepted;
  const profitable = operatingProfit > 0;
  const fullConsignment = cargo.loadedUnits === capacityUnits;
  const completesProfitableFullLogs = completesDelivery
    && profitable
    && fullConsignment
    && cargo.productId === 'logs'
    && facility.definitionId === 'sawmill';
  const completesProfitableFullStructuralTimber = completesDelivery
    && profitable
    && fullConsignment
    && cargo.productId === 'structural-timber'
    && facility.definitionId === 'prefabrication-plant';
  let postedCompany = deliveryPost.company;
  if (completesProfitableFullLogs
    && !progress.developmentGrantAwarded) {
    const grantPost = postLedgerEntry(postedCompany, {
      category: 'contract-bonus',
      magnitude: REGIONAL_DEVELOPMENT_GRANT,
      tick: economy.tick,
      referenceId: REGIONAL_DEVELOPMENT_GRANT_REFERENCE,
      direction: 'forward',
    });
    if (grantPost.ok === false) return FATAL_TRANSFER_FAILURE;
    postedCompany = grantPost.company;
  }

  slot.quantity = destinationQuantity;
  slot.recentInflow = recentInflow;
  cargo.units -= accepted;
  train.operations.currentTripRevenue = tripRevenue;
  train.operations.lifetimeDeliveredUnits = lifetimeDeliveredUnits;
  train.operations.lifetimeRevenue = lifetimeRevenue;

  let completedDelivery: FreightDeliveryEvent | null = null;
  if (cargo.units === 0) {
    train.operations.lastTripRevenue = tripRevenue;
    train.operations.lastTripRunningCost = runningCost;
    train.operations.currentTripRevenue = 0;
    train.operations.currentTripRunningCost = 0;
    train.cargo = null;
    completedDelivery = {
      trainId: train.id,
      productId: cargo.productId,
      units: cargo.loadedUnits,
      destinationFacilityId: facility.id,
      tick: economy.tick,
      revenue: tripRevenue,
      runningCost,
      operatingProfit,
    };
    if (completesProfitableFullLogs) {
      progress.profitableLogDeliveryCompleted = true;
      progress.developmentGrantAwarded = true;
    }
    if (completesProfitableFullStructuralTimber) {
      progress.profitableStructuralTimberDeliveryCompleted = true;
    }
  }

  return {
    company: postedCompany,
    completedDelivery,
    status: status(train, capacityUnits, {
      facilityId: facility.id,
      productId: cargo.productId,
      kind: 'unloading',
      blocker: null,
      batchUnits: accepted,
      batchRevenue,
    }),
  };
};

export function proposeCargoTick(input: CargoTickInput): CargoTickProposal {
  let company = clonePlainData(input.company);
  const economy = clonePlainData(input.economy);
  const trains = [...clonePlainData(input.trains)];
  const trainsById = [...trains]
    .sort((left, right) => left.id.localeCompare(right.id));
  const freightProgress = clonePlainData(input.freightProgress);
  const runtimeByTrainId = new Map(
    input.runtime.map((snapshot) => [snapshot.trainId, snapshot]),
  );
  const statuses: CargoTransferStatus[] = [];
  const completedDeliveries: FreightDeliveryEvent[] = [];
  let changed = false;
  let fatalFailure = false;

  if (validateCompanyState(company).valid === false
    || !isValidFreightProgress(freightProgress)
    || !hasConsistentDevelopmentGrant(company, freightProgress)) {
    return deepFreeze({
      company,
      economy,
      trains,
      freightProgress,
      statuses,
      completedDeliveries,
      changed,
    });
  }

  trainsById.forEach((train) => {
    if (fatalFailure) return;
    const runtime = runtimeByTrainId.get(train.id);
    if (!input.operating) {
      statuses.push(status(train, 0, {
        facilityId: null,
        productId: train.cargo?.productId ?? null,
        kind: 'idle',
        blocker: 'not-operating',
        batchUnits: 0,
        batchRevenue: 0,
      }));
      return;
    }
    if (!runtime
      || runtime.derailed
      || runtime.trackUUID === null
      || runtime.trackT === null) {
      statuses.push(blocked(
        train,
        0,
        'derailed',
      ));
      return;
    }
    if (runtime.throttle !== 0
      || runtime.speedWorldUnitsPerSecond > TRANSFER_SPEED_LIMIT) {
      statuses.push(blocked(
        train,
        0,
        'train-moving',
      ));
      return;
    }

    const freightSet = getFreightSet(train.freightSetId);
    if (!freightSet) {
      statuses.push(blocked(
        train,
        0,
        'unknown-freight-set',
      ));
      return;
    }

    const cargoProductId = train.cargo?.productId ?? null;
    const capacityUnits = cargoProductId === null
      ? 0
      : cargoCapacity(freightSet, cargoProductId);
    if (cargoProductId !== null && capacityUnits <= 0) {
      statuses.push(blocked(
        train,
        0,
        'incompatible-product',
        null,
        cargoProductId,
      ));
      return;
    }

    const contained = containedFacilities(runtime, economy.facilities);
    const eligible = eligibleFacilities(
      train,
      freightSet,
      contained,
    );
    const selected = eligible[0];
    if (selected) {
      if (selected.kind === 'loading') {
        const loaded = loadBatch(
          train,
          selected.productId,
          selected.capacityUnits,
          selected.facility,
        );
        if (isFatalTransferFailure(loaded)) {
          fatalFailure = true;
          return;
        }
        if (loaded) {
          statuses.push(loaded);
          changed = true;
          return;
        }
      } else {
        const unloaded = unloadBatch(
          train,
          selected.capacityUnits,
          selected.facility,
          economy,
          company,
          freightProgress,
        );
        if (isFatalTransferFailure(unloaded)) {
          fatalFailure = true;
          return;
        }
        if (unloaded) {
          company = unloaded.company;
          statuses.push(unloaded.status);
          if (unloaded.completedDelivery) {
            completedDeliveries.push(unloaded.completedDelivery);
          }
          changed = true;
          return;
        }
      }
    }

    const nearestContained = contained[0];
    if (nearestContained) {
      const blockedHere = blockerForContainedFacility(
        train,
        freightSet,
        nearestContained.facility,
      );
      statuses.push(blocked(
        train,
        blockedHere.capacityUnits,
        blockedHere.blocker,
        nearestContained.facility.id,
        blockedHere.productId,
      ));
      return;
    }

    const relevant = nearestRelevantFacility(
      train,
      runtime,
      economy.facilities,
      freightSet,
    );
    if (!relevant) {
      statuses.push(blocked(
        train,
        capacityUnits,
        'product-not-accepted',
      ));
      return;
    }
    statuses.push(blocked(
      train,
      cargoCapacity(freightSet, relevant.productId),
      'outside-eligible-facility',
      relevant.facility.id,
      relevant.productId,
    ));
  });

  if (fatalFailure) {
    return deepFreeze({
      company: clonePlainData(input.company),
      economy: clonePlainData(input.economy),
      trains: clonePlainData(input.trains),
      freightProgress: clonePlainData(input.freightProgress),
      statuses: [],
      completedDeliveries: [],
      changed: false,
    });
  }

  return deepFreeze({
    company,
    economy,
    trains,
    freightProgress,
    statuses,
    completedDeliveries,
    changed,
  });
}
