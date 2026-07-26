import type { TrainDef } from '../config/WorldData';
import type { CompanyStateDef } from '../economy/EconomyData';
import { postLedgerEntry } from '../economy/FinanceLedger';
import { clonePlainData } from '../utils/PlainData';
import type { CargoBlocker } from './CargoSystem';
import { getFreightSet } from './FreightSetCatalog';
import type { TrainRuntimeSnapshot } from './TrainRuntime';

export interface RunningCostTickProposal {
  readonly company: CompanyStateDef;
  readonly trains: readonly TrainDef[];
  readonly activeTrainIds: readonly string[];
  readonly stopTrainIds: readonly string[];
  readonly aggregateCost: number;
  readonly blockerByTrainId: Readonly<Record<string, CargoBlocker | null>>;
  readonly changed: boolean;
}

interface RunningCostTickInput {
  readonly tick: number;
  readonly company: CompanyStateDef;
  readonly trains: readonly TrainDef[];
  readonly runtime: readonly TrainRuntimeSnapshot[];
}

interface TrainCostUpdate {
  readonly train: TrainDef;
  readonly currentTripRunningCost: number;
  readonly lifetimeRunningCost: number;
}

const STOP_SPEED_LIMIT = 2;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    const record = value as unknown as Record<string, unknown>;
    Object.keys(record).forEach((key) => deepFreeze(record[key]));
    Object.freeze(value);
  }
  return value;
};

const safeAdd = (left: number, right: number): number | null => {
  const total = left + right;
  return Number.isSafeInteger(total) ? total : null;
};

const isActive = (runtime: TrainRuntimeSnapshot): boolean =>
  !runtime.derailed
  && (
    runtime.throttle !== 0
    || runtime.speedWorldUnitsPerSecond > STOP_SPEED_LIMIT
  );

export function proposeRunningCosts(
  input: RunningCostTickInput,
): RunningCostTickProposal {
  const company = clonePlainData(input.company);
  const trains = [...clonePlainData(input.trains)];
  const runtimeByTrainId = new Map(
    input.runtime.map((snapshot) => [snapshot.trainId, snapshot]),
  );
  const activeTrains = trains
    .filter((train) => {
      const runtime = runtimeByTrainId.get(train.id);
      return runtime !== undefined && isActive(runtime);
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const activeTrainIds = activeTrains.map((train) => train.id);
  const blockerByTrainId: Record<string, CargoBlocker | null> = {};
  [...trains]
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((train) => {
      blockerByTrainId[train.id] = null;
    });

  const unchanged = (
    aggregateCost: number,
    stopTrainIds: readonly string[] = [],
  ): RunningCostTickProposal => deepFreeze({
    company,
    trains,
    activeTrainIds,
    stopTrainIds,
    aggregateCost,
    blockerByTrainId,
    changed: false,
  });

  let aggregateCost = 0;
  const updates: TrainCostUpdate[] = [];
  for (const train of activeTrains) {
    const freightSet = getFreightSet(train.freightSetId);
    if (!freightSet
      || !Number.isSafeInteger(freightSet.runningCostPerActiveTick)
      || freightSet.runningCostPerActiveTick <= 0) {
      return unchanged(0);
    }

    const nextAggregate = safeAdd(
      aggregateCost,
      freightSet.runningCostPerActiveTick,
    );
    const currentTripRunningCost = safeAdd(
      train.operations.currentTripRunningCost,
      freightSet.runningCostPerActiveTick,
    );
    const lifetimeRunningCost = safeAdd(
      train.operations.lifetimeRunningCost,
      freightSet.runningCostPerActiveTick,
    );
    if (nextAggregate === null
      || currentTripRunningCost === null
      || lifetimeRunningCost === null) {
      return unchanged(nextAggregate ?? 0);
    }

    aggregateCost = nextAggregate;
    updates.push({
      train,
      currentTripRunningCost,
      lifetimeRunningCost,
    });
  }

  if (aggregateCost === 0) return unchanged(0);

  const posted = postLedgerEntry(company, {
    magnitude: aggregateCost,
    category: 'train-running-cost',
    tick: input.tick,
    referenceId: `active-trains:${input.tick}`,
    direction: 'forward',
  });
  if (posted.ok === false) {
    if (posted.code === 'insufficient-cash') {
      activeTrainIds.forEach((trainId) => {
        blockerByTrainId[trainId] =
          'Insufficient cash for running costs';
      });
      return unchanged(aggregateCost, activeTrainIds);
    }
    return unchanged(aggregateCost);
  }

  updates.forEach((update) => {
    update.train.operations.currentTripRunningCost =
      update.currentTripRunningCost;
    update.train.operations.lifetimeRunningCost =
      update.lifetimeRunningCost;
  });

  return deepFreeze({
    company: posted.company,
    trains,
    activeTrainIds,
    stopTrainIds: [],
    aggregateCost,
    blockerByTrainId,
    changed: true,
  });
}
