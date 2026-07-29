import {
  evaluateCoupler,
  type CouplerState,
} from './CouplerModel';
import type {
  OnRailVehicleState,
  RailVehicleDefinition,
} from './RailVehicleModel';
import {
  RouteCursor,
  type RouteResolver,
} from './RouteCursor';
import {
  TRAIN_PHYSICS_CONFIG,
  type TrainPhysicsConfig,
} from './TrainPhysicsConfig';

export interface ConsistState {
  id: string;
  vehicles: OnRailVehicleState[];
  couplers: CouplerState[];
}

export interface ConsistControl {
  throttle: number;
  brake: number;
  emergencyBrake: boolean;
}

export interface VehicleForceBreakdown {
  tractionN: number;
  brakingN: number;
  rollingResistanceN: number;
  aerodynamicDragN: number;
  gradientN: number;
  leadingCouplerN: number;
  trailingCouplerN: number;
  netN: number;
}

export interface ConsistStepResult {
  state: ConsistState;
  forcesByVehicleId: Readonly<Record<string, VehicleForceBreakdown>>;
  brokenCouplerIds: readonly string[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function emptyBreakdown(): VehicleForceBreakdown {
  return {
    tractionN: 0,
    brakingN: 0,
    rollingResistanceN: 0,
    aerodynamicDragN: 0,
    gradientN: 0,
    leadingCouplerN: 0,
    trailingCouplerN: 0,
    netN: 0,
  };
}

function cloneState(state: Readonly<ConsistState>): ConsistState {
  return {
    id: state.id,
    vehicles: state.vehicles.map((vehicle) => ({
      ...vehicle,
      centre: { ...vehicle.centre },
    })),
    couplers: state.couplers.map((coupler) => ({ ...coupler })),
  };
}

export class ConsistDynamicsSolver {
  constructor(
    private readonly config: Readonly<TrainPhysicsConfig> = TRAIN_PHYSICS_CONFIG,
  ) {}

  step(
    state: Readonly<ConsistState>,
    definitions: ReadonlyMap<string, RailVehicleDefinition>,
    control: Readonly<ConsistControl>,
    resolver: RouteResolver,
    dtSeconds: number,
  ): ConsistStepResult {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      throw new Error('Consist step duration must be a positive finite number');
    }

    let working = cloneState(state);
    let remaining = dtSeconds;
    let finalForces: Record<string, VehicleForceBreakdown> = {};
    const brokenCouplerIds = new Set<string>();
    while (remaining > 1e-12) {
      const substep = Math.min(this.config.fixedStepSeconds, remaining);
      const result = this.substep(working, definitions, control, resolver, substep);
      working = result.state;
      finalForces = result.forces;
      result.brokenCouplerIds.forEach((id) => brokenCouplerIds.add(id));
      remaining -= substep;
    }

    return {
      state: working,
      forcesByVehicleId: finalForces,
      brokenCouplerIds: Array.from(brokenCouplerIds),
    };
  }

  private substep(
    state: ConsistState,
    definitions: ReadonlyMap<string, RailVehicleDefinition>,
    control: Readonly<ConsistControl>,
    resolver: RouteResolver,
    dtSeconds: number,
  ): {
    state: ConsistState;
    forces: Record<string, VehicleForceBreakdown>;
    brokenCouplerIds: string[];
  } {
    const throttle = clamp(control.throttle, -1, 1);
    const brake = control.emergencyBrake ? 1 : clamp(control.brake, 0, 1);
    const forces: Record<string, VehicleForceBreakdown> = {};
    const definitionsByVehicleId = new Map<string, RailVehicleDefinition>();

    for (const vehicle of state.vehicles) {
      const definition = definitions.get(vehicle.vehicleId);
      if (!definition) {
        throw new Error(`Missing rail vehicle definition for "${vehicle.vehicleId}"`);
      }
      definitionsByVehicleId.set(vehicle.vehicleId, definition);
      const speedSign = Math.sign(vehicle.speedMps);
      const breakdown = emptyBreakdown();
      breakdown.tractionN = definition.maxTractiveEffortN * throttle;
      breakdown.brakingN = speedSign === 0
        ? 0
        : -speedSign * definition.maxBrakeForceN * brake;
      breakdown.rollingResistanceN = speedSign === 0
        ? 0
        : -speedSign * this.config.rollingResistancePerKg * definition.massKg;
      breakdown.aerodynamicDragN = -this.config.aerodynamicDrag
        * vehicle.speedMps
        * Math.abs(vehicle.speedMps);
      breakdown.gradientN = this.gradientForceN(vehicle, definition, resolver);
      forces[vehicle.vehicleId] = breakdown;
    }

    const nextCouplers: CouplerState[] = [];
    const brokenCouplerIds: string[] = [];
    for (const coupler of state.couplers) {
      const evaluation = evaluateCoupler(coupler, this.config.coupler);
      const leadingForces = forces[coupler.leadingVehicleId];
      const trailingForces = forces[coupler.trailingVehicleId];
      if (!leadingForces || !trailingForces) {
        throw new Error(`Coupler "${coupler.id}" references a missing vehicle`);
      }
      leadingForces.trailingCouplerN += evaluation.forceOnLeadingN;
      trailingForces.leadingCouplerN += evaluation.forceOnTrailingN;
      nextCouplers.push(evaluation.state);
      if (evaluation.brokeThisStep) brokenCouplerIds.push(coupler.id);
    }

    const nextVehicles = state.vehicles.map((vehicle) => {
      const definition = definitionsByVehicleId.get(vehicle.vehicleId)!;
      const breakdown = forces[vehicle.vehicleId];
      breakdown.netN = breakdown.tractionN
        + breakdown.brakingN
        + breakdown.rollingResistanceN
        + breakdown.aerodynamicDragN
        + breakdown.gradientN
        + breakdown.leadingCouplerN
        + breakdown.trailingCouplerN;
      let speedMps = vehicle.speedMps + (breakdown.netN / definition.massKg) * dtSeconds;
      const brakingAcrossZero = vehicle.speedMps !== 0
        && breakdown.brakingN !== 0
        && Math.sign(speedMps) !== 0
        && Math.sign(speedMps) !== Math.sign(vehicle.speedMps);
      const resistanceAcrossZero = vehicle.speedMps !== 0
        && breakdown.tractionN === 0
        && Math.sign(speedMps) !== 0
        && Math.sign(speedMps) !== Math.sign(vehicle.speedMps);
      if (brakingAcrossZero || resistanceAcrossZero) speedMps = 0;

      const cursor = new RouteCursor(vehicle.centre, resolver);
      const centre = cursor.movedBy(
        speedMps * dtSeconds * this.config.worldUnitsPerMetre,
      ).state;
      return { ...vehicle, centre, speedMps };
    });

    const vehiclesById = new Map(
      nextVehicles.map((vehicle) => [vehicle.vehicleId, vehicle]),
    );
    const integratedCouplers = nextCouplers.map((coupler) => {
      if (coupler.broken) return coupler;
      const leading = vehiclesById.get(coupler.leadingVehicleId)!;
      const trailing = vehiclesById.get(coupler.trailingVehicleId)!;
      const relativeSpeed = leading.speedMps - trailing.speedMps;
      return {
        ...coupler,
        extension: coupler.extension + relativeSpeed * dtSeconds,
        relativeSpeed,
      };
    });

    return {
      state: {
        id: state.id,
        vehicles: nextVehicles,
        couplers: integratedCouplers,
      },
      forces,
      brokenCouplerIds,
    };
  }

  private gradientForceN(
    vehicle: OnRailVehicleState,
    definition: RailVehicleDefinition,
    resolver: RouteResolver,
  ): number {
    const track = resolver.trackByUUID(vehicle.centre.trackUUID);
    const profile = track?.verticalProfile;
    if (!track || !profile || profile.knots.length < 2) return 0;

    const index = track.getArcLengthIndex();
    let start = profile.knots[0];
    let end = profile.knots[1];
    for (let knotIndex = 1; knotIndex < profile.knots.length; knotIndex++) {
      end = profile.knots[knotIndex];
      if (vehicle.centre.distance <= index.distanceAtParameter(end.t)) break;
      start = end;
    }
    const startDistance = index.distanceAtParameter(start.t);
    const endDistance = index.distanceAtParameter(end.t);
    const horizontalDistance = endDistance - startDistance;
    if (Math.abs(horizontalDistance) <= 1e-12) return 0;

    const gradeAlongTrack = (end.elevation - start.elevation) / horizontalDistance;
    const gradeAlongTravel = gradeAlongTrack * vehicle.centre.direction;
    const sineOfSlope = gradeAlongTravel / Math.sqrt(1 + gradeAlongTravel ** 2);
    return -definition.massKg * 9.81 * sineOfSlope;
  }
}
