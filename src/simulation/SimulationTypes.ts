import type { TrainDef, TrackDef, JunctionDef, WorldData, WorldStationDef } from '../config/WorldData';
import type { FreightDeliveryEvent } from '../freight/CargoSystem';
import { createPassengerState, type PassengerState, type PassengerArrivalEvent } from '../region/PassengerSystem';
export type { PassengerState } from '../region/PassengerSystem';

export type SimulationSpeed = 0 | 1 | 2 | 4;
export interface ServiceStop {
  targetId: string;
  targetKind: 'facility' | 'station';
  loadRule: 'full' | 'available' | 'unload' | 'none';
  maxWaitSeconds: number;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  trainId: string;
  kind: 'freight' | 'passenger';
  stops: ServiceStop[];
  frequencySeconds: number;
  departureOffsetSeconds: number;
  priority: number;
  enabled: boolean;
}

export type StoppedReasonCode = 'disabled' | 'scheduled' | 'loading' | 'unloading'
  | 'no-supply' | 'destination-full' | 'route-disconnected' | 'track-occupied'
  | 'junction-occupied' | 'insufficient-cash' | 'unsuitable-train' | 'missing-train'
  | 'derailed' | 'no-passengers' | 'platform-too-short' | 'deadlock';

export interface StoppedReason {
  code: StoppedReasonCode;
  message: string;
  relatedEntityId?: string;
  remedy: string;
}

export interface ServiceRuntimeState {
  nextStopIndex: number;
  phase: 'travelling' | 'dwelling' | 'blocked' | 'scheduled';
  dwellSeconds: number;
  nextDepartureSeconds: number;
  calls: number;
  completedCycles: number;
  distanceWorldUnits: number;
  delaySeconds: number;
  stoppedReason: StoppedReason | null;
}

export interface ManagementState {
  managementVersion: 1;
  clockSeconds: number;
  speed: SimulationSpeed;
  services: ServiceDefinition[];
  serviceStates: Record<string, ServiceRuntimeState>;
  passengers: PassengerState;
}

/** No presentation or persistence dependencies enter the authoritative session. */
export type ManagedWorld = WorldData & { management?: ManagementState };
export type SimulationEvent =
  | ({ type: 'freight-delivery'; originFacilityId?: string } & FreightDeliveryEvent)
  | ({ type: 'passenger-arrival' } & PassengerArrivalEvent)
  | { type: 'service-call'; serviceId: string; trainId: string; targetId: string; targetKind: 'facility' | 'station'; clockSeconds: number }
  | { type: 'passenger-delivery'; serviceId: string; trainId: string; originStationId: string; destinationStationId: string; units: number; revenue: number; clockSeconds: number };

export interface SimulationTrainSnapshot {
  trainId: string;
  trackUUID: string;
  distance: number;
  trackT: number;
  facing: 1 | -1;
  speedMps: number;
  x: number;
  y: number;
  angleRad: number;
  derailed?: boolean;
  serviceId: string | null;
  stoppedReason: StoppedReason | null;
}

export interface SimulationAdvanceResult {
  steps: number;
  changed: boolean;
  events: readonly SimulationEvent[];
  trains: readonly SimulationTrainSnapshot[];
}

export interface BlueprintDraft {
  blueprintVersion: 1;
  id: string;
  name: string;
  sourceWorldId: string;
  sourceRevision: number;
  tracks: TrackDef[];
  junctions: JunctionDef[];
  stations: WorldStationDef[];
  trains: TrainDef[];
  services: ServiceDefinition[];
  removedTrackIds?: string[];
  constructionCost: number;
}

export interface RehearsalRequest {
  requestId: string;
  world: ManagedWorld;
  draft?: BlueprintDraft;
  horizonSeconds?: number;
  sampleIntervalSeconds?: number;
}

export interface GhostSample {
  clockSeconds: number;
  trains: readonly SimulationTrainSnapshot[];
}

export interface RehearsalResult {
  requestId: string;
  sourceRevision: number;
  status: 'complete' | 'cancelled' | 'invalid';
  elapsedSeconds: number;
  samples: GhostSample[];
  engineering: {
    deliveredUnits: number;
    passengersDelivered: number;
    runningCosts: number;
    revenue: number;
    completedCycles: number;
    waitingSeconds: number;
    blockers: Array<{ serviceId: string; reason: StoppedReason; seconds: number }>;
  };
  forecast: {
    label: 'Demand forecast';
    assumptions: string[];
    demandRange: [number, number];
  };
  errors: string[];
}

export function createManagementState(): ManagementState {
  return {
    managementVersion: 1,
    clockSeconds: 0,
    speed: 1,
    services: [],
    serviceStates: {},
    passengers: createPassengerState(),
  };
}

export function createServiceRuntimeState(): ServiceRuntimeState {
  return { nextStopIndex: 0, phase: 'travelling', dwellSeconds: 0, nextDepartureSeconds: 0,
    calls: 0, completedCycles: 0, distanceWorldUnits: 0, delaySeconds: 0, stoppedReason: null };
}
