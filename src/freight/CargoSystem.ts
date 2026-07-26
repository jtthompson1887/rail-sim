import type {
  EconomyStateDef,
  FirstRouteProgressDef,
  TrainDef,
} from '../config/WorldData';
import type {
  CompanyStateDef,
  FacilityEconomyDef,
  InventorySlotDef,
} from '../economy/EconomyData';
import { postLedgerEntry } from '../economy/FinanceLedger';
import { quoteLocalProduct } from '../economy/MarketSystem';
import { getProduct } from '../economy/ProductCatalog';
import { clonePlainData } from '../utils/PlainData';
import {
  capacityForProduct,
  getFreightSet,
} from './FreightSetCatalog';
import type { TrainRuntimeSnapshot } from './TrainRuntime';

export type CargoBlocker =
  | 'Stop the train to transfer cargo'
  | 'Move inside Managed Forest rail access'
  | 'Move inside Sawmill rail access'
  | 'Waiting for logs'
  | 'Timber set is full'
  | 'Sawmill input storage is full'
  | 'Cargo is not accepted here'
  | 'Insufficient cash for running costs'
  | 'Re-rail the train before operating';

export interface CargoTransferStatus {
  readonly trainId: string;
  readonly facilityId: string | null;
  readonly kind: 'loading' | 'unloading' | 'blocked' | 'idle';
  readonly blocker: CargoBlocker | null;
  readonly batchUnits: number;
  readonly cargoUnits: number;
  readonly capacityUnits: number;
  readonly batchRevenue: number;
}

export interface FreightDeliveryEvent {
  readonly trainId: string;
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
  readonly firstRouteProgress: FirstRouteProgressDef;
  readonly statuses: readonly CargoTransferStatus[];
  readonly completedDeliveries: readonly FreightDeliveryEvent[];
  readonly changed: boolean;
}

export interface CargoTickInput {
  readonly operating: boolean;
  readonly company: CompanyStateDef;
  readonly economy: EconomyStateDef;
  readonly trains: readonly TrainDef[];
  readonly firstRouteProgress: FirstRouteProgressDef;
  readonly runtime: readonly TrainRuntimeSnapshot[];
}

interface ContainedFacility {
  facility: FacilityEconomyDef;
  distance: number;
}

interface EligibleFacility extends ContainedFacility {
  kind: 'loading' | 'unloading';
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

const cargoCapacity = (train: TrainDef, productId: string): number => {
  const freightSet = getFreightSet(train.freightSetId);
  const product = getProduct(productId);
  if (!freightSet || !product) return 0;
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
    'facilityId' | 'kind' | 'blocker' | 'batchUnits' | 'batchRevenue'
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
  blocker: CargoBlocker,
  facilityId: string | null = null,
): CargoTransferStatus => status(train, capacityUnits, {
  facilityId,
  kind: 'blocked',
  blocker,
  batchUnits: 0,
  batchRevenue: 0,
});

const sourceSlot = (
  facility: FacilityEconomyDef,
): InventorySlotDef | null => facility.definitionId === 'managed-forest'
  ? facility.inventories.logs ?? null
  : null;

const destinationSlot = (
  facility: FacilityEconomyDef,
  productId: string,
): InventorySlotDef | null => facility.definitionId === 'sawmill'
  ? facility.inventories[productId] ?? null
  : null;

const sourceAvailability = (slot: InventorySlotDef): number =>
  slot.quantity - slot.reservedQuantity;

const canLoadAt = (
  train: TrainDef,
  capacityUnits: number,
  facility: FacilityEconomyDef,
): boolean => {
  const slot = sourceSlot(facility);
  const compatibleCargo = train.cargo === null
    || train.cargo.productId === 'logs';
  return slot !== null
    && compatibleCargo
    && capacityUnits > currentCargoUnits(train)
    && sourceAvailability(slot) > 0;
};

const canUnloadAt = (
  train: TrainDef,
  capacityUnits: number,
  facility: FacilityEconomyDef,
): boolean => {
  if (!train.cargo || capacityUnits <= 0) return false;
  const slot = destinationSlot(facility, train.cargo.productId);
  return slot !== null && slot.quantity < slot.capacity;
};

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
  capacityUnits: number,
  economy: EconomyStateDef,
  contained: readonly ContainedFacility[],
): EligibleFacility[] => {
  const eligible: EligibleFacility[] = [];
  contained.forEach((candidate) => {
    if (canLoadAt(train, capacityUnits, candidate.facility)) {
      eligible.push({ ...candidate, kind: 'loading' });
    }
    if (canUnloadAt(
      train,
      capacityUnits,
      candidate.facility,
    )) {
      eligible.push({ ...candidate, kind: 'unloading' });
    }
  });
  return eligible.sort(compareFacility);
};

const blockerForContainedFacility = (
  train: TrainDef,
  capacityUnits: number,
  facility: FacilityEconomyDef,
): CargoBlocker => {
  if (facility.definitionId === 'managed-forest') {
    if (train.cargo !== null && train.cargo.productId !== 'logs') {
      return 'Cargo is not accepted here';
    }
    if (capacityUnits <= currentCargoUnits(train)) {
      return 'Timber set is full';
    }
    const slot = sourceSlot(facility);
    if (slot && sourceAvailability(slot) <= 0) return 'Waiting for logs';
    return 'Cargo is not accepted here';
  }

  if (facility.definitionId === 'sawmill') {
    if (!train.cargo || capacityUnits <= 0) {
      return 'Cargo is not accepted here';
    }
    const slot = destinationSlot(facility, train.cargo.productId);
    if (!slot) return 'Cargo is not accepted here';
    if (slot.quantity >= slot.capacity) {
      return 'Sawmill input storage is full';
    }
  }
  return 'Cargo is not accepted here';
};

const nearestRelevantFacility = (
  train: TrainDef,
  runtime: TrainRuntimeSnapshot,
  facilities: readonly FacilityEconomyDef[],
): ContainedFacility | null => {
  const relevantDefinition = train.cargo === null
    ? 'managed-forest'
    : 'sawmill';
  return facilities
    .filter(({ definitionId }) => definitionId === relevantDefinition)
    .map((facility) => ({
      facility,
      distance: distanceToFacility(runtime, facility),
    }))
    .sort(compareFacility)[0] ?? null;
};

const safeSum = (...values: number[]): number | null => {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total : null;
};

const loadBatch = (
  train: TrainDef,
  capacityUnits: number,
  facility: FacilityEconomyDef,
): CargoTransferStatus | null => {
  const slot = sourceSlot(facility);
  if (!slot) return null;
  const accepted = Math.min(
    BATCH_UNITS,
    sourceAvailability(slot),
    capacityUnits - currentCargoUnits(train),
  );
  const recentOutflow = safeSum(slot.recentOutflow, accepted);
  if (accepted <= 0 || recentOutflow === null) return null;

  slot.quantity -= accepted;
  slot.recentOutflow = recentOutflow;
  if (train.cargo) {
    train.cargo.units += accepted;
  } else {
    train.cargo = {
      productId: 'logs',
      units: accepted,
      originFacilityId: facility.id,
    };
  }
  return status(train, capacityUnits, {
    facilityId: facility.id,
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
  progress: FirstRouteProgressDef,
): UnloadResult | null => {
  const cargo = train.cargo;
  if (!cargo) return null;
  const slot = destinationSlot(facility, cargo.productId);
  if (!slot) return null;

  const quote = quoteLocalProduct(cargo.productId, economy.market, slot);
  if (quote.ok === false) return null;
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
  if (accepted <= 0
    || !Number.isSafeInteger(batchRevenue)
    || batchRevenue <= 0
    || destinationQuantity === null
    || recentInflow === null
    || tripRevenue === null
    || lifetimeDeliveredUnits === null
    || lifetimeRevenue === null) {
    return null;
  }

  const runningCost = train.operations.currentTripRunningCost;
  const operatingProfit = tripRevenue - runningCost;
  if (!Number.isSafeInteger(operatingProfit)) return null;
  const posted = postLedgerEntry(company, {
    category: 'delivery-revenue',
    magnitude: batchRevenue,
    tick: economy.tick,
    referenceId: `${train.id}:${economy.tick}:${facility.id}`,
    direction: 'forward',
  });
  if (posted.ok === false) return null;

  slot.quantity = destinationQuantity;
  slot.recentInflow = recentInflow;
  cargo.units -= accepted;
  train.operations.currentTripRevenue = tripRevenue;
  train.operations.lifetimeDeliveredUnits = lifetimeDeliveredUnits;
  train.operations.lifetimeRevenue = lifetimeRevenue;

  let completedDelivery: FreightDeliveryEvent | null = null;
  if (cargo.units === 0) {
    const profitable = tripRevenue > runningCost;
    train.operations.lastTripRevenue = tripRevenue;
    train.operations.lastTripRunningCost = runningCost;
    train.operations.currentTripRevenue = 0;
    train.operations.currentTripRunningCost = 0;
    progress.profitableDeliveryCompleted ||= profitable;
    train.cargo = null;
    completedDelivery = {
      trainId: train.id,
      destinationFacilityId: facility.id,
      tick: economy.tick,
      revenue: tripRevenue,
      runningCost,
      operatingProfit,
    };
  }

  return {
    company: posted.company,
    completedDelivery,
    status: status(train, capacityUnits, {
      facilityId: facility.id,
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
  const trains = [...clonePlainData(input.trains)]
    .sort((left, right) => left.id.localeCompare(right.id));
  const firstRouteProgress = clonePlainData(input.firstRouteProgress);
  const runtimeByTrainId = new Map(
    input.runtime.map((snapshot) => [snapshot.trainId, snapshot]),
  );
  const statuses: CargoTransferStatus[] = [];
  const completedDeliveries: FreightDeliveryEvent[] = [];
  let changed = false;

  trains.forEach((train) => {
    const productId = train.cargo?.productId ?? 'logs';
    const capacityUnits = cargoCapacity(train, productId);
    const runtime = runtimeByTrainId.get(train.id);
    if (!runtime
      || runtime.derailed
      || runtime.trackUUID === null
      || runtime.trackT === null) {
      statuses.push(blocked(
        train,
        capacityUnits,
        'Re-rail the train before operating',
      ));
      return;
    }
    if (runtime.throttle !== 0
      || runtime.speedWorldUnitsPerSecond > TRANSFER_SPEED_LIMIT) {
      statuses.push(blocked(
        train,
        capacityUnits,
        'Stop the train to transfer cargo',
      ));
      return;
    }
    if (!input.operating) {
      statuses.push(status(train, capacityUnits, {
        facilityId: null,
        kind: 'idle',
        blocker: null,
        batchUnits: 0,
        batchRevenue: 0,
      }));
      return;
    }

    const contained = containedFacilities(runtime, economy.facilities);
    const eligible = eligibleFacilities(
      train,
      capacityUnits,
      economy,
      contained,
    );
    const selected = eligible[0];
    if (selected) {
      if (selected.kind === 'loading') {
        const loaded = loadBatch(
          train,
          capacityUnits,
          selected.facility,
        );
        if (loaded) {
          statuses.push(loaded);
          changed = true;
          return;
        }
      } else {
        const unloaded = unloadBatch(
          train,
          capacityUnits,
          selected.facility,
          economy,
          company,
          firstRouteProgress,
        );
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
      statuses.push(blocked(
        train,
        capacityUnits,
        blockerForContainedFacility(
          train,
          capacityUnits,
          nearestContained.facility,
        ),
        nearestContained.facility.id,
      ));
      return;
    }

    const relevant = nearestRelevantFacility(
      train,
      runtime,
      economy.facilities,
    );
    if (!relevant) {
      statuses.push(blocked(
        train,
        capacityUnits,
        'Cargo is not accepted here',
      ));
      return;
    }
    statuses.push(blocked(
      train,
      capacityUnits,
      train.cargo === null
        ? 'Move inside Managed Forest rail access'
        : 'Move inside Sawmill rail access',
      relevant.facility.id,
    ));
  });

  return deepFreeze({
    company,
    economy,
    trains,
    firstRouteProgress,
    statuses,
    completedDeliveries,
    changed,
  });
}
