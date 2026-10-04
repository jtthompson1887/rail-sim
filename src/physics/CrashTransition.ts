import type {
  DerailmentCause,
  DerailmentDecision,
} from './DerailmentEvaluator';
import type { RailCollision } from './RailCollisionDetector';
import type {
  OnRailVehicleState,
  RailVehicleDefinition,
  RailVehiclePose,
} from './RailVehicleModel';

export interface FreeBodyInitialState {
  mode: 'free-body';
  vehicleId: string;
  x: number;
  y: number;
  angleRad: number;
  velocity: { x: number; y: number };
  angularVelocityRadPerSec: number;
  initiatingImpulse: { x: number; y: number };
}

export interface TrainIncidentRecord {
  incidentId: string;
  fixedTick: number;
  cause: DerailmentCause;
  involvedVehicleIds: readonly string[];
  derailmentSpeedMps: number;
  lateralAccelerationMps2: number;
  collisionImpulseNs: number;
  deltaVelocityMps: number;
  absorbedEnergyJ: number;
  angularImpulseNms: number;
  rolloverSeverity: number;
  peakCouplerForceN: number;
  brokenCouplerIds: readonly string[];
  secondaryImpacts: readonly {
    otherVehicleId: string | null;
    impulseNs: number;
    absorbedEnergyJ: number;
  }[];
  durationSeconds: number;
}

export interface CrashTransitionVehicle {
  vehicleId: string;
  definition: RailVehicleDefinition;
  state: OnRailVehicleState;
  pose: RailVehiclePose;
  curvaturePerMetre: number;
  peakCouplerForceN: number;
  brokenCouplerIds: readonly string[];
}

function stableIncidentId(fixedTick: number, vehicleIds: readonly string[]): string {
  const seed = `${fixedTick}:${[...vehicleIds].sort().join(',')}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `incident-${(`00000000${(hash >>> 0).toString(16)}`).slice(-8)}`;
}

function isCollision(
  trigger: DerailmentDecision | RailCollision,
): trigger is RailCollision {
  return 'vehicleAId' in trigger;
}

export function createCrashTransition(
  vehicles: readonly CrashTransitionVehicle[],
  trigger: DerailmentDecision | RailCollision,
  fixedTick: number,
): {
  freeBodies: readonly FreeBodyInitialState[];
  incident: TrainIncidentRecord;
} {
  if (!Number.isInteger(fixedTick) || fixedTick < 0) {
    throw new Error('Crash transition fixed tick must be a non-negative integer');
  }
  if (!isCollision(trigger) && trigger.kind !== 'derail') {
    throw new Error('Crash transition requires a derailment or rail collision trigger');
  }

  const collision = isCollision(trigger) ? trigger : null;
  const cause: DerailmentCause = collision
    ? 'collision'
    : (trigger as Extract<DerailmentDecision, { kind: 'derail' }>).cause;
  const involved = collision
    ? vehicles.filter((vehicle) => (
      vehicle.vehicleId === collision.vehicleAId
      || vehicle.vehicleId === collision.vehicleBId
    ))
    : [...vehicles];
  const impulseFor = (vehicleId: string): { x: number; y: number } => {
    const scaled = (value: number): number => (value === 0 ? 0 : value);
    if (!collision) return { x: 0, y: 0 };
    if (vehicleId === collision.vehicleAId) {
      return {
        x: scaled(-collision.normal.x * collision.impulseNs),
        y: scaled(-collision.normal.y * collision.impulseNs),
      };
    }
    if (vehicleId === collision.vehicleBId) {
      return {
        x: scaled(collision.normal.x * collision.impulseNs),
        y: scaled(collision.normal.y * collision.impulseNs),
      };
    }
    return { x: 0, y: 0 };
  };

  const freeBodies = involved.map((vehicle): FreeBodyInitialState => ({
    mode: 'free-body',
    vehicleId: vehicle.vehicleId,
    x: vehicle.pose.centre.x,
    y: vehicle.pose.centre.y,
    angleRad: vehicle.pose.angleRad,
    velocity: {
      x: Math.cos(vehicle.pose.angleRad) * vehicle.state.speedMps,
      y: Math.sin(vehicle.pose.angleRad) * vehicle.state.speedMps,
    },
    angularVelocityRadPerSec: vehicle.state.speedMps * vehicle.curvaturePerMetre,
    initiatingImpulse: impulseFor(vehicle.vehicleId),
  }));

  const collisionImpulseNs = collision?.impulseNs ?? 0;
  const combinedMass = involved.reduce((sum, vehicle) => sum + vehicle.definition.massKg, 0);
  const reducedMass = collision && involved.length === 2
    ? (
      involved[0].definition.massKg * involved[1].definition.massKg
      / combinedMass
    )
    : 0;
  const absorbedEnergyJ = collision
    ? 0.5 * reducedMass * collision.closingSpeedMps ** 2
    : 0;
  const averageLeverArm = involved.length > 0
    ? involved.reduce((sum, vehicle) => sum + vehicle.definition.bodyLength / 2, 0)
      / involved.length
    : 0;
  const angularImpulseNms = collisionImpulseNs * averageLeverArm;
  const rolloverDenominator = involved.reduce(
    (sum, vehicle) => sum + vehicle.definition.massKg * vehicle.definition.bodyLength,
    0,
  );
  const involvedVehicleIds = involved.map((vehicle) => vehicle.vehicleId);
  const incident: TrainIncidentRecord = {
    incidentId: stableIncidentId(fixedTick, involvedVehicleIds),
    fixedTick,
    cause,
    involvedVehicleIds,
    derailmentSpeedMps: involved.reduce(
      (maximum, vehicle) => Math.max(maximum, Math.abs(vehicle.state.speedMps)),
      0,
    ),
    lateralAccelerationMps2: involved.reduce(
      (maximum, vehicle) => Math.max(
        maximum,
        vehicle.state.speedMps ** 2 * Math.abs(vehicle.curvaturePerMetre),
      ),
      0,
    ),
    collisionImpulseNs,
    deltaVelocityMps: involved.reduce(
      (maximum, vehicle) => Math.max(
        maximum,
        collisionImpulseNs / vehicle.definition.massKg,
      ),
      0,
    ),
    absorbedEnergyJ,
    angularImpulseNms,
    rolloverSeverity: rolloverDenominator > 0
      ? angularImpulseNms / rolloverDenominator
      : 0,
    peakCouplerForceN: involved.reduce(
      (maximum, vehicle) => Math.max(maximum, vehicle.peakCouplerForceN),
      0,
    ),
    brokenCouplerIds: Array.from(new Set(
      involved.reduce<string[]>(
        (ids, vehicle) => ids.concat(vehicle.brokenCouplerIds),
        [],
      ),
    )).sort(),
    secondaryImpacts: [],
    durationSeconds: 0,
  };
  return { freeBodies, incident };
}
