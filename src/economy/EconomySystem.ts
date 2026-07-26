import type { EconomyStateDef, WorldData } from '../config/WorldData';
import { WorldManager } from '../managers/WorldManager';
import { equalPlainData } from '../utils/PlainData';
import type {
  FacilityId,
  IndustryBlocker,
} from './EconomyData';
import { advanceFacilityRecipe } from './IndustrySystem';
import { advanceMarketTick } from './MarketSystem';
import { getRecipe } from './ProductCatalog';

export const ECONOMY_TICK_MS = 1_000;
export const MAX_ECONOMY_TICKS_PER_FRAME = 4;

export interface EconomyBlockerResult {
  facilityId: FacilityId;
  blocker: IndustryBlocker;
}

export interface EconomyUpdateResult {
  ticksAdvanced: number;
  changedFacilityIds: FacilityId[];
  blockers: EconomyBlockerResult[];
  commitRejected: boolean;
}

export interface EconomyWorldPort {
  readonly world: WorldData | null;
  applyEconomyBatch(
    expectedOperationsRevision: number,
    mutate: (draft: EconomyStateDef) => boolean,
  ): boolean;
}

const emptyResult = (): EconomyUpdateResult => ({
  ticksAdvanced: 0,
  changedFacilityIds: [],
  blockers: [],
  commitRejected: false,
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

  update(deltaMs: number, operating: boolean): EconomyUpdateResult {
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
    let blockers: EconomyBlockerResult[] = [];
    let ticksAdvanced = 0;
    let commitRejected = false;

    for (let tickIndex = 0; tickIndex < tickLimit; tickIndex += 1) {
      const world = this.worldPort.world;
      if (world === null) break;

      const expectedOperationsRevision = world.operationsRevision;
      const seed = world.generationConfig.seed;
      let tickChangedFacilityIds: FacilityId[] = [];
      let tickBlockers: EconomyBlockerResult[] = [];
      const committed = this.worldPort.applyEconomyBatch(
        expectedOperationsRevision,
        (draft) => {
          if (draft.tick >= Number.MAX_SAFE_INTEGER) return false;

          const orderedFacilities = draft.facilities
            .map((facility, index) => ({ facility, index }))
            .sort((left, right) => compareIds(
              left.facility,
              right.facility,
            ));
          for (const { facility, index } of orderedFacilities) {
            const recipe = facility.activeRecipeId === null
              ? undefined
              : getRecipe(facility.activeRecipeId);
            if (recipe === undefined) {
              tickBlockers.push({
                facilityId: facility.id,
                blocker: 'idle',
              });
              continue;
            }

            const result = advanceFacilityRecipe(facility, recipe);
            tickBlockers.push({
              facilityId: facility.id,
              blocker: result.blocker,
            });
            if (!equalPlainData(facility, result.facility)) {
              draft.facilities[index] = result.facility;
              tickChangedFacilityIds.push(facility.id);
            }
          }

          const nextTick = draft.tick + 1;
          draft.tick = nextTick;
          draft.market = advanceMarketTick(draft.market, seed, nextTick);
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
      blockers = tickBlockers;
    }

    return {
      ticksAdvanced,
      changedFacilityIds: Array.from(changedFacilityIds).sort(),
      blockers,
      commitRejected,
    };
  }
}
