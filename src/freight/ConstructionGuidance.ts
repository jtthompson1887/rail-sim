import type { WorldData } from '../config/WorldData';
import {
  AGGREGATE_HOPPER_SET_ID,
  COVERED_CEMENT_SET_ID,
  FLATBED_FREIGHT_SET_ID,
  getFreightSet,
  OPERATING_RESERVE,
} from './FreightSetCatalog';

export type ConstructionGuidancePhase =
  | 'first-route'
  | 'structural-timber'
  | 'limestone'
  | 'cement'
  | 'achieved';

export interface ConstructionGuidanceDto {
  readonly guidanceVersion: 1;
  readonly phase: ConstructionGuidancePhase;
  readonly objective: string;
  readonly reserve: number;
  readonly reservePurpose: string;
  readonly requiredFreightSetIds: readonly string[];
}

interface GuidancePhaseDefinition {
  readonly phase: ConstructionGuidancePhase;
  readonly objective: string;
  readonly requiredFreightSetIds: readonly string[];
}

const guidancePhase = (
  world: WorldData,
): GuidancePhaseDefinition => {
  if (!world.freightProgress.profitableLogDeliveryCompleted) {
    return {
      phase: 'first-route',
      objective: 'Connect Managed Forest to Sawmill.',
      requiredFreightSetIds: [FLATBED_FREIGHT_SET_ID],
    };
  }
  if (!world.freightProgress.profitableStructuralTimberDeliveryCompleted) {
    return {
      phase: 'structural-timber',
      objective: 'Connect Sawmill to Prefabrication Plant.',
      requiredFreightSetIds: [FLATBED_FREIGHT_SET_ID],
    };
  }
  if (!world.freightProgress.profitableLimestoneDeliveryCompleted) {
    return {
      phase: 'limestone',
      objective: 'Connect Quarry to Cement Works.',
      requiredFreightSetIds: [
        AGGREGATE_HOPPER_SET_ID,
        COVERED_CEMENT_SET_ID,
      ],
    };
  }
  if (!world.freightProgress.profitableCementDeliveryCompleted) {
    return {
      phase: 'cement',
      objective: 'Connect Cement Works to Prefabrication Plant.',
      requiredFreightSetIds: [COVERED_CEMENT_SET_ID],
    };
  }
  return {
    phase: 'achieved',
    objective: 'Cement secured · Prefabrication awaits steel.',
    requiredFreightSetIds: [],
  };
};

const article = (name: string): string =>
  /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;

const reservePurpose = (
  names: readonly string[],
): string => {
  if (names.length === 0) return 'operating reserve';
  if (names.length === 1) {
    return `${article(names[0])} and operating reserve`;
  }
  return `${names.map(article).join(', ')}, and operating reserve`;
};

export function deriveConstructionGuidance(
  world: WorldData,
): ConstructionGuidanceDto {
  const phase = guidancePhase(world);
  const ownedSetIds = new Set(
    world.trains.map(({ freightSetId }) => freightSetId),
  );
  const requiredSets = phase.requiredFreightSetIds
    .filter((setId) => !ownedSetIds.has(setId))
    .map((setId) => getFreightSet(setId))
    .filter((set): set is NonNullable<typeof set> => set !== undefined);
  const requiredFreightSetIds = Object.freeze(
    requiredSets.map(({ id }) => id),
  );
  const reserve = requiredSets.reduce(
    (total, set) => total + set.purchasePrice,
    OPERATING_RESERVE,
  );

  return Object.freeze({
    guidanceVersion: 1,
    phase: phase.phase,
    objective: phase.objective,
    reserve,
    reservePurpose: reservePurpose(
      requiredSets.map(({ displayName }) => displayName),
    ),
    requiredFreightSetIds,
  });
}
