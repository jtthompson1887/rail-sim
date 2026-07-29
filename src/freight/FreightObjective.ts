import type { WorldData } from '../config/WorldData';
import { getProduct } from '../economy/ProductCatalog';
import type { FacilityEconomyDef } from '../economy/EconomyData';
import type { TrackTopologySnapshot } from '../managers/TrackManager';
import {
  capacityForProduct,
  FLATBED_FREIGHT_SET_ID,
  getFreightSet,
} from './FreightSetCatalog';
import { queryRailAccessConnectivity } from './RailAccessConnectivity';

export type FreightObjectiveId =
  | 'first-profitable-route'
  | 'structural-timber-link';

export type FreightObjectiveStepId =
  | 'connect-route'
  | 'buy-train'
  | 'load-logs'
  | 'deliver-logs'
  | 'run-profitably'
  | 'produce-structural-timber'
  | 'connect-prefabrication-plant'
  | 'load-structural-timber'
  | 'deliver-structural-timber-profitably';

export interface FreightObjectiveStep {
  readonly id: FreightObjectiveStepId;
  readonly label: string;
  readonly state: 'complete' | 'current' | 'pending';
}

export interface FreightObjectiveDto {
  readonly objectiveVersion: 1;
  readonly id: FreightObjectiveId;
  readonly title: string;
  readonly status: string;
  readonly achieved: boolean;
  readonly steps: readonly FreightObjectiveStep[];
}

interface StepDefinition {
  readonly id: FreightObjectiveStepId;
  readonly label: string;
}

const freezeStepDefinitions = (
  steps: readonly StepDefinition[],
): readonly StepDefinition[] => Object.freeze(
  steps.map((step) => Object.freeze(step)),
);

const FIRST_ROUTE_STEPS = freezeStepDefinitions([
  { id: 'connect-route', label: 'Connect the route' },
  { id: 'buy-train', label: 'Buy the train' },
  { id: 'load-logs', label: 'Load logs' },
  { id: 'deliver-logs', label: 'Deliver logs' },
  { id: 'run-profitably', label: 'Run profitably' },
]);

const STRUCTURAL_TIMBER_STEPS = freezeStepDefinitions([
  {
    id: 'produce-structural-timber',
    label: 'Produce structural timber',
  },
  {
    id: 'connect-prefabrication-plant',
    label: 'Connect the Prefabrication Plant',
  },
  { id: 'load-structural-timber', label: 'Load structural timber' },
  {
    id: 'deliver-structural-timber-profitably',
    label: 'Deliver profitably',
  },
]);

function findFacility(
  world: WorldData,
  definitionId: string,
): FacilityEconomyDef | undefined {
  return world.economy.facilities.find(
    (facility) => facility.definitionId === definitionId,
  );
}

function facilitiesAreConnected(
  world: WorldData,
  topology: TrackTopologySnapshot,
  source: FacilityEconomyDef | undefined,
  destination: FacilityEconomyDef | undefined,
): boolean {
  if (!source || !destination) return false;
  return queryRailAccessConnectivity(
    world.tracks,
    topology,
    { facilityId: source.id, ...source.railAccess },
    { facilityId: destination.id, ...destination.railAccess },
  ).connected;
}

function deriveSteps(
  definitions: readonly StepDefinition[],
  facts: readonly boolean[],
  achieved: boolean,
): readonly FreightObjectiveStep[] {
  const firstIncomplete = facts.indexOf(false);
  return Object.freeze(definitions.map(
    ({ id, label }, index): FreightObjectiveStep => Object.freeze({
      id,
      label,
      state: achieved || index < firstIncomplete
        ? 'complete'
        : index === firstIncomplete
          ? 'current'
          : 'pending',
    }),
  ));
}

function deriveFirstObjective(
  world: WorldData,
  topology: TrackTopologySnapshot,
): FreightObjectiveDto {
  const achieved = world.freightProgress.profitableLogDeliveryCompleted;
  const timberTrains = world.trains.filter(
    ({ freightSetId }) => freightSetId === FLATBED_FREIGHT_SET_ID,
  );
  const hasDeliveredTimber = timberTrains.some(
    ({ operations }) => operations.lifetimeDeliveredUnits > 0,
  );
  const freightSet = getFreightSet(FLATBED_FREIGHT_SET_ID);
  const logs = getProduct('logs');
  const capacity = freightSet && logs
    ? capacityForProduct(freightSet, logs)
    : null;
  const logCapacityUnits = capacity?.ok === true
    ? capacity.capacityUnits
    : null;
  const facts = [
    facilitiesAreConnected(
      world,
      topology,
      findFacility(world, 'managed-forest'),
      findFacility(world, 'sawmill'),
    ),
    timberTrains.length > 0,
    hasDeliveredTimber || timberTrains.some(({ cargo }) => (
      logCapacityUnits !== null
      && cargo?.productId === 'logs'
      && cargo.units === logCapacityUnits
    )),
    timberTrains.some(({ operations }) => (
      operations.lastTripRevenue > 0
      && operations.lifetimeDeliveredUnits > 0
    )),
    achieved,
  ];

  return Object.freeze({
    objectiveVersion: 1,
    id: 'first-profitable-route',
    title: 'First freight route',
    status: achieved
      ? 'Route profitable'
      : 'Complete the timber service',
    achieved,
    steps: deriveSteps(FIRST_ROUTE_STEPS, facts, achieved),
  });
}

function hasStructuralTimberProductionEvidence(
  world: WorldData,
  sawmill: FacilityEconomyDef | undefined,
  prefab: FacilityEconomyDef | undefined,
): boolean {
  const sawmillTimber = sawmill?.inventories['structural-timber'];
  const prefabTimber = prefab?.inventories['structural-timber'];
  return (sawmillTimber?.quantity ?? 0) > 0
    || (sawmillTimber?.recentInflow ?? 0) > 0
    || world.trains.some(({ cargo }) => (
      cargo?.productId === 'structural-timber'
      && cargo.units > 0
    ))
    || (prefabTimber?.recentInflow ?? 0) > 0
    || world.freightProgress
      .profitableStructuralTimberDeliveryCompleted;
}

function deriveStructuralTimberObjective(
  world: WorldData,
  topology: TrackTopologySnapshot,
): FreightObjectiveDto {
  const achieved = world.freightProgress
    .profitableStructuralTimberDeliveryCompleted;
  const sawmill = findFacility(world, 'sawmill');
  const prefab = findFacility(world, 'prefabrication-plant');
  const facts = [
    hasStructuralTimberProductionEvidence(world, sawmill, prefab),
    facilitiesAreConnected(world, topology, sawmill, prefab),
    world.trains.some(({ cargo }) => (
      cargo?.productId === 'structural-timber'
      && cargo.units > 0
    )),
    achieved,
  ];

  return Object.freeze({
    objectiveVersion: 1,
    id: 'structural-timber-link',
    title: 'Extend the timber chain',
    status: achieved
      ? 'Timber link profitable · Prefabrication awaits cement and steel'
      : 'Use the development grant to reach the Prefabrication Plant',
    achieved,
    steps: deriveSteps(STRUCTURAL_TIMBER_STEPS, facts, achieved),
  });
}

export function deriveFreightObjective(
  world: WorldData,
  topology: TrackTopologySnapshot,
): FreightObjectiveDto {
  return world.freightProgress.profitableLogDeliveryCompleted
    ? deriveStructuralTimberObjective(world, topology)
    : deriveFirstObjective(world, topology);
}

export class FreightObjectiveCelebrationSession {
  private readonly celebratedKeys = new Set<string>();

  consume(
    worldId: string,
    objectiveId: FreightObjectiveId,
    achieved: boolean,
  ): boolean {
    if (worldId.trim().length === 0 || !achieved) return false;
    const key = `${worldId}\u0000${objectiveId}`;
    if (this.celebratedKeys.has(key)) return false;
    this.celebratedKeys.add(key);
    return true;
  }
}

export const freightObjectiveCelebrationSession =
  new FreightObjectiveCelebrationSession();
