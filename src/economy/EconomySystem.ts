import type { WorldData } from '../config/WorldData';
import {
  WorldManager,
  type OperationsDraft,
} from '../managers/WorldManager';
import { clonePlainData, equalPlainData } from '../utils/PlainData';
import type {
  FacilityId,
} from './EconomyData';
import { advanceFacilityRecipe } from './IndustrySystem';
import { advanceMarketTick } from './MarketSystem';
import { getRecipe } from './ProductCatalog';
import {
  proposeCargoTick,
  type CargoBlocker,
  type CargoTransferStatus,
  type FreightDeliveryEvent,
} from '../freight/CargoSystem';
import { proposeRunningCosts } from '../freight/RunningCostSystem';
import type { TrainRuntimeSnapshot } from '../freight/TrainRuntime';
import { TrainSerializer } from '../utils/TrainSerializer';

export const ECONOMY_TICK_MS = 1_000;
export const MAX_ECONOMY_TICKS_PER_FRAME = 4;

export interface EconomyUpdateResult {
  readonly ticksAdvanced: number;
  readonly changedFacilityIds: string[];
  readonly cargoStatuses: readonly CargoTransferStatus[];
  readonly completedDeliveries: readonly FreightDeliveryEvent[];
  readonly runningCostBlockerByTrainId:
    Readonly<Record<string, CargoBlocker | null>>;
  readonly stopTrainIds: readonly string[];
  readonly commitRejected: boolean;
  readonly authoritativeChanged: boolean;
}

export interface EconomyWorldPort {
  readonly world: WorldData | null;
  applyOperationsBatch(
    expectedRevision: number,
    mutate: (draft: OperationsDraft) => boolean,
  ): boolean;
}

const emptyResult = (): EconomyUpdateResult => ({
  ticksAdvanced: 0,
  changedFacilityIds: [],
  cargoStatuses: [],
  completedDeliveries: [],
  runningCostBlockerByTrainId: {},
  stopTrainIds: [],
  commitRejected: false,
  authoritativeChanged: false,
});

const compareIds = (
  left: { id: FacilityId },
  right: { id: FacilityId },
): number => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

export class EconomySystem {
  private accumulatorMs = 0;

  constructor(
    private readonly worldPort: EconomyWorldPort = WorldManager,
  ) {}

  update(
    deltaMs: number,
    operating: boolean,
    runtime: readonly TrainRuntimeSnapshot[],
  ): EconomyUpdateResult {
    if (!operating
      || !Number.isFinite(deltaMs)
      || deltaMs < 0) {
      return emptyResult();
    }

    const accumulatedMs = this.accumulatorMs + deltaMs;
    this.accumulatorMs = Number.isFinite(accumulatedMs)
      ? Math.min(accumulatedMs, Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    const wholeTicks = Math.floor(this.accumulatorMs / ECONOMY_TICK_MS);
    if (wholeTicks === 0) return emptyResult();

    const tickLimit = Math.min(
      wholeTicks,
      MAX_ECONOMY_TICKS_PER_FRAME,
    );
    const changedFacilityIds = new Set<FacilityId>();
    const cargoStatusByTrainId = new Map<string, CargoTransferStatus>();
    const completedDeliveries: FreightDeliveryEvent[] = [];
    const runningCostBlockerByTrainId =
      new Map<string, CargoBlocker | null>();
    const stopTrainIds = new Set<string>();
    let ticksAdvanced = 0;
    let commitRejected = false;

    for (let tickIndex = 0; tickIndex < tickLimit; tickIndex += 1) {
      const world = this.worldPort.world;
      if (world === null) break;

      const expectedRevision = world.revision;
      const seed = world.generationConfig.seed;
      const runtimeByTrainId = new Map(
        runtime.map((snapshot) => [
          snapshot.trainId,
          clonePlainData(snapshot),
        ]),
      );
      const tickRuntime = Array.from(runtimeByTrainId.values()).sort(
        (left, right) => left.trainId.localeCompare(right.trainId),
      );
      let tickChangedFacilityIds: FacilityId[] = [];
      let tickCargoStatuses: readonly CargoTransferStatus[] = [];
      let tickCompletedDeliveries: readonly FreightDeliveryEvent[] = [];
      let tickRunningCostBlockerByTrainId:
        Readonly<Record<string, CargoBlocker | null>> = {};
      let tickStopTrainIds: readonly string[] = [];
      const committed = this.worldPort.applyOperationsBatch(
        expectedRevision,
        (draft) => {
          if (draft.economy.tick >= Number.MAX_SAFE_INTEGER) return false;
          const operationTick = draft.economy.tick + 1;
          draft.economy.tick = operationTick;
          const facilitiesBefore = clonePlainData(
            draft.economy.facilities,
          );

          draft.trains = draft.trains.map((authoritative) => {
            const snapshot = runtimeByTrainId.get(authoritative.id);
            const merged = snapshot
              ? TrainSerializer.mergeRuntime(authoritative, snapshot)
              : null;
            return clonePlainData(merged ?? authoritative);
          });

          const cargo = proposeCargoTick({
            operating: true,
            company: draft.company,
            economy: draft.economy,
            trains: draft.trains,
            freightProgress: draft.freightProgress,
            runtime: tickRuntime,
          });
          draft.company = clonePlainData(cargo.company);
          draft.economy = clonePlainData(cargo.economy);
          draft.freightProgress = clonePlainData(
            cargo.freightProgress,
          );
          draft.trains = cargo.trains.map(clonePlainData);

          const costs = proposeRunningCosts({
            tick: operationTick,
            company: draft.company,
            trains: draft.trains,
            runtime: tickRuntime,
          });
          draft.company = clonePlainData(costs.company);
          draft.trains = costs.trains.map(clonePlainData);

          const orderedFacilities = draft.economy.facilities
            .map((facility, index) => ({ facility, index }))
            .sort((left, right) => compareIds(
              left.facility,
              right.facility,
            ));
          for (const { facility, index } of orderedFacilities) {
            const recipe = facility.activeRecipeId === null
              ? undefined
              : getRecipe(facility.activeRecipeId);
            if (recipe === undefined) continue;

            const result = advanceFacilityRecipe(facility, recipe);
            if (!equalPlainData(facility, result.facility)) {
              draft.economy.facilities[index] = result.facility;
            }
          }

          draft.economy.market = advanceMarketTick(
            draft.economy.market,
            seed,
            operationTick,
          );
          const beforeById = new Map(
            facilitiesBefore.map((facility) => [facility.id, facility]),
          );
          tickChangedFacilityIds = draft.economy.facilities
            .filter((facility) => !equalPlainData(
              beforeById.get(facility.id),
              facility,
            ))
            .map(({ id }) => id)
            .sort();
          tickCargoStatuses = cargo.statuses;
          tickCompletedDeliveries = cargo.completedDeliveries;
          tickRunningCostBlockerByTrainId = costs.blockerByTrainId;
          tickStopTrainIds = costs.stopTrainIds;
          return true;
        },
      );

      if (!committed) {
        commitRejected = true;
        break;
      }

      this.accumulatorMs -= ECONOMY_TICK_MS;
      ticksAdvanced += 1;
      tickChangedFacilityIds.forEach((facilityId) => {
        changedFacilityIds.add(facilityId);
      });
      tickCargoStatuses.forEach((status) => {
        cargoStatusByTrainId.set(
          status.trainId,
          clonePlainData(status),
        );
      });
      tickCompletedDeliveries.forEach((event) => {
        completedDeliveries.push(clonePlainData(event));
      });
      Object.keys(tickRunningCostBlockerByTrainId)
        .sort()
        .forEach((trainId) => {
          const blocker = tickRunningCostBlockerByTrainId[trainId];
          if (!runningCostBlockerByTrainId.has(trainId)) {
            runningCostBlockerByTrainId.set(trainId, null);
          }
          if (blocker !== null) {
            runningCostBlockerByTrainId.set(trainId, blocker);
          }
        });
      tickStopTrainIds.forEach((trainId) => stopTrainIds.add(trainId));
    }

    const runningCostBlockers: Record<string, CargoBlocker | null> = {};
    Array.from(runningCostBlockerByTrainId.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([trainId, blocker]) => {
        runningCostBlockers[trainId] = blocker;
      });
    return {
      ticksAdvanced,
      changedFacilityIds: Array.from(changedFacilityIds).sort(),
      cargoStatuses: Array.from(cargoStatusByTrainId.values())
        .sort((left, right) => left.trainId.localeCompare(right.trainId)),
      completedDeliveries,
      runningCostBlockerByTrainId: runningCostBlockers,
      stopTrainIds: Array.from(stopTrainIds).sort(),
      commitRejected,
      authoritativeChanged: ticksAdvanced > 0,
    };
  }
}
