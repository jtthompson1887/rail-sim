import type { WorldData } from '../config/WorldData';
import type { TrackTopologySnapshot } from '../managers/TrackManager';
import { TIMBER_FREIGHT_SET_ID } from './FreightSetCatalog';
import { queryRailAccessConnectivity } from './RailAccessConnectivity';

export type FirstRouteStepId =
  | 'connect-route'
  | 'buy-train'
  | 'load-logs'
  | 'deliver-logs'
  | 'run-profitably';

export interface FirstRouteObjectiveStep {
  readonly id: FirstRouteStepId;
  readonly label: string;
  readonly state: 'complete' | 'current' | 'pending';
}

export interface FirstRouteObjectiveDto {
  readonly objectiveVersion: 1;
  readonly achieved: boolean;
  readonly steps: readonly FirstRouteObjectiveStep[];
}

const TIMBER_LOG_CAPACITY_UNITS = 60;

const STEP_DEFINITIONS: ReadonlyArray<Readonly<{
  id: FirstRouteStepId;
  label: string;
}>> = [
  { id: 'connect-route', label: 'Connect the route' },
  { id: 'buy-train', label: 'Buy the train' },
  { id: 'load-logs', label: 'Load logs' },
  { id: 'deliver-logs', label: 'Deliver logs' },
  { id: 'run-profitably', label: 'Run profitably' },
];

function routeIsConnected(
  world: WorldData,
  topology: TrackTopologySnapshot,
): boolean {
  const forest = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'managed-forest',
  );
  const sawmill = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'sawmill',
  );
  if (!forest || !sawmill) return false;

  return queryRailAccessConnectivity(
    world.tracks,
    topology,
    { facilityId: forest.id, ...forest.railAccess },
    { facilityId: sawmill.id, ...sawmill.railAccess },
  ).connected;
}

export function deriveFirstRouteObjective(
  world: WorldData,
  topology: TrackTopologySnapshot,
): FirstRouteObjectiveDto {
  const achieved = world.freightProgress.profitableLogDeliveryCompleted;
  const timberTrains = world.trains.filter(
    ({ freightSetId }) => freightSetId === TIMBER_FREIGHT_SET_ID,
  );
  const hasDeliveredTimber = timberTrains.some(
    ({ operations }) => operations.lifetimeDeliveredUnits > 0,
  );
  const facts = [
    routeIsConnected(world, topology),
    timberTrains.length > 0,
    hasDeliveredTimber || timberTrains.some(({ cargo }) => (
      cargo?.productId === 'logs'
      && cargo.units === TIMBER_LOG_CAPACITY_UNITS
    )),
    timberTrains.some(({ operations }) => (
      operations.lastTripRevenue > 0
      && operations.lifetimeDeliveredUnits > 0
    )),
    achieved,
  ];
  const firstIncomplete = facts.indexOf(false);
  const steps = Object.freeze(STEP_DEFINITIONS.map(
    ({ id, label }, index): FirstRouteObjectiveStep => Object.freeze({
      id,
      label,
      state: achieved || index < firstIncomplete
        ? 'complete'
        : index === firstIncomplete
          ? 'current'
          : 'pending',
    }),
  ));

  return Object.freeze({
    objectiveVersion: 1,
    achieved,
    steps,
  });
}

export class FirstRouteCelebrationSession {
  private readonly celebratedWorldIds = new Set<string>();

  consume(worldId: string, dto: FirstRouteObjectiveDto): boolean {
    if (worldId.trim().length === 0
      || !dto.achieved
      || this.celebratedWorldIds.has(worldId)) {
      return false;
    }
    this.celebratedWorldIds.add(worldId);
    return true;
  }
}

export const firstRouteCelebrationSession =
  new FirstRouteCelebrationSession();
