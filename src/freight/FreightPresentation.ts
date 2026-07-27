import type { WorldData } from '../config/WorldData';
import type { CompanyStateDef } from '../economy/EconomyData';
import { summariseProfitAndLoss } from '../economy/FinanceLedger';
import type {
  CargoTransferStatus,
} from './CargoSystem';
import {
  FLATBED_FREIGHT_SET_ID,
  FREIGHT_SETS,
} from './FreightSetCatalog';
import type { FreightPurchaseQuote } from './FreightPurchaseService';
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
  readonly compatibleCargoLabel: 'Logs, Structural Timber';
  readonly capacityLabel: '60 tonnes';
  readonly runningCostLabel: '£20 / active tick';
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
    readonly productLabel: 'Logs' | 'Empty';
    readonly units: number;
    readonly capacityUnits: 60;
    readonly text: string;
  };
  readonly nearestEligibleFacility: string | null;
  readonly transfer: CargoTransferStatus;
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

const PURCHASE_REMEDIES = {
  'no-track': 'Click on player track to place the General Flatbed Set',
  'outside-forest-access': 'Place inside Managed Forest rail access',
  'disconnected-route': 'Connect Managed Forest and Sawmill first',
  'insufficient-cash': 'Insufficient cash for General Flatbed Set',
  'duplicate-gesture': 'Purchase already in progress',
} as const;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    const record = value as unknown as Record<string, unknown>;
    Object.keys(record).forEach((key) => deepFreeze(record[key]));
    Object.freeze(value);
  }
  return value;
};

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
  cargoUnits: number,
): string | null => {
  const explicit = transfer.facilityId
    ? world.economy.facilities.find(({ id }) => id === transfer.facilityId)
    : undefined;
  if (explicit) return explicit.name;

  const definitionId = cargoUnits > 0 ? 'sawmill' : 'managed-forest';
  const candidates = world.economy.facilities
    .filter((facility) => facility.definitionId === definitionId)
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
  if (!train || train.freightSetId !== FLATBED_FREIGHT_SET_ID
    || transfer.trainId !== runtime.trainId) return null;

  const units = train.cargo?.units ?? 0;
  const productLabel = train.cargo?.productId === 'logs'
    ? 'Logs' as const
    : 'Empty' as const;
  const operations = train.operations;
  return deepFreeze({
    trainId: train.id,
    displayName: FREIGHT_SETS[0].displayName,
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
      units,
      capacityUnits: 60 as const,
      text: productLabel === 'Logs'
        ? `Logs ${units.toLocaleString('en-GB')} / 60 t`
        : 'Empty 0 / 60 t',
    },
    nearestEligibleFacility: relevantFacilityName(
      world,
      runtime,
      transfer,
      units,
    ),
    transfer: { ...transfer },
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
  const freightSet = FREIGHT_SETS[0];
  const blocker = quote?.blocker ?? 'no-track';
  return Object.freeze({
    freightSetId: FLATBED_FREIGHT_SET_ID,
    displayName: freightSet.displayName,
    price: freightSet.purchasePrice,
    compatibleCargoLabel: 'Logs, Structural Timber',
    capacityLabel: '60 tonnes',
    runningCostLabel: '£20 / active tick',
    cashAfter: quote?.cashAfter ?? cash - freightSet.purchasePrice,
    affordable: quote?.affordable ?? cash >= freightSet.purchasePrice,
    validPlacement: quote?.valid ?? false,
    remedy: blocker === null
      ? ''
      : PURCHASE_REMEDIES[
        blocker as keyof typeof PURCHASE_REMEDIES
      ] ?? 'General Flatbed Set purchase could not be completed',
  });
}
