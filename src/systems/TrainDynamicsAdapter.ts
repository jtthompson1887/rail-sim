import type { IVehicle } from '../config/VehicleTypes';
import { GameConfig } from '../config/GameConfig';
import {
  ConsistDynamicsSolver,
  type ConsistState,
} from '../physics/ConsistDynamicsSolver';
import type { CouplerState } from '../physics/CouplerModel';
import {
  createCrashTransition,
  type FreeBodyInitialState,
  type TrainIncidentRecord,
} from '../physics/CrashTransition';
import {
  deriveRailVehiclePose,
  type OnRailVehicleState,
  type RailVehicleDefinition,
  type RailVehiclePose,
} from '../physics/RailVehicleModel';
import type { RouteResolver } from '../physics/RouteCursor';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';
import { EventBus } from '../services/EventBus';

export interface TrainDynamicsBinding {
  vehicle: IVehicle;
  definition: RailVehicleDefinition;
  order: number;
  state: OnRailVehicleState;
}

export interface TrainDynamicsAdapterOptions {
  consistId: string;
  resolver: RouteResolver;
  bindings: readonly TrainDynamicsBinding[];
}

interface RuntimeBinding {
  vehicle: IVehicle;
  definition: RailVehicleDefinition;
  order: number;
  freeBody: boolean;
}

function cloneState(state: ConsistState): ConsistState {
  return {
    id: state.id,
    vehicles: state.vehicles.map((vehicle) => ({
      ...vehicle,
      centre: { ...vehicle.centre },
      hazard: { ...vehicle.hazard },
    })),
    couplers: state.couplers.map((coupler) => ({ ...coupler })),
  };
}

function interpolateAngle(start: number, end: number, alpha: number): number {
  const difference = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + difference * alpha;
}

export class TrainDynamicsAdapter {
  private readonly consistId: string;
  private readonly resolver: RouteResolver;
  private readonly solver = new ConsistDynamicsSolver();
  private readonly bindings = new Map<string, RuntimeBinding>();
  private readonly emittedIncidentIds = new Set<string>();
  private readonly previousPoses = new Map<string, RailVehiclePose>();
  private readonly currentPoses = new Map<string, RailVehiclePose>();
  private state: ConsistState;
  private fixedTick = 0;

  constructor(options: TrainDynamicsAdapterOptions) {
    this.consistId = options.consistId;
    this.resolver = options.resolver;
    const ordered = [...options.bindings].sort((left, right) => left.order - right.order);
    ordered.forEach((binding) => {
      const vehicleId = binding.vehicle.getUUID();
      if (vehicleId !== binding.state.vehicleId) {
        throw new Error(`Dynamics binding id mismatch for "${vehicleId}"`);
      }
      this.bindings.set(vehicleId, {
        vehicle: binding.vehicle,
        definition: binding.definition,
        order: binding.order,
        freeBody: false,
      });
    });
    this.state = {
      id: options.consistId,
      vehicles: ordered.map((binding) => ({
        ...binding.state,
        centre: { ...binding.state.centre },
        hazard: { ...binding.state.hazard },
      })),
      couplers: this.createCouplers(ordered),
    };
    this.rebuildCurrentPoses();
    this.currentPoses.forEach((pose, id) => this.previousPoses.set(id, pose));
    this.setOnRailBodiesStatic();
    this.syncPersistedOnRailStates();
  }

  fixedUpdate(dtSeconds: number): void {
    if (this.state.vehicles.length === 0) return;
    this.currentPoses.forEach((pose, id) => this.previousPoses.set(id, pose));
    const result = this.solver.step(
      this.state,
      new Map(this.state.vehicles.map((vehicle) => [
        vehicle.vehicleId,
        this.requireBinding(vehicle.vehicleId).definition,
      ])),
      {
        throttle: this.throttleInput(),
        brake: 0,
        emergencyBrake: false,
      },
      this.resolver,
      dtSeconds,
    );
    this.state = result.state;
    this.fixedTick += 1;
    this.rebuildCurrentPoses();
    this.setOnRailBodiesStatic();
    this.syncPersistedOnRailStates();

    for (const derailment of result.derailments) {
      const state = this.getOnRailState(derailment.vehicleId);
      const binding = this.bindings.get(derailment.vehicleId);
      const pose = this.currentPoses.get(derailment.vehicleId);
      if (!state || !binding || !pose || binding.freeBody) continue;
      const peakCouplerForceN = this.state.couplers
        .filter((coupler) => (
          coupler.leadingVehicleId === derailment.vehicleId
          || coupler.trailingVehicleId === derailment.vehicleId
        ))
        .reduce((maximum, coupler) => Math.max(maximum, Math.abs(coupler.forceN)), 0);
      const transition = createCrashTransition([{
        vehicleId: derailment.vehicleId,
        definition: binding.definition,
        state,
        pose,
        curvaturePerMetre: pose.curvature * TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre,
        peakCouplerForceN,
        brokenCouplerIds: result.brokenCouplerIds,
      }], {
        kind: 'derail',
        hazard: state.hazard,
        cause: derailment.cause,
      }, this.fixedTick);
      this.transitionToFreeBody(transition.freeBodies[0], transition.incident);
    }

    result.brokenCouplerIds.forEach((couplerId) => {
      const coupler = result.state.couplers.find((item) => item.id === couplerId);
      EventBus.emit('coupler:broken', {
        consistId: this.state.id,
        couplerId,
        forceN: coupler?.forceN ?? 0,
      });
    });
  }

  render(rawAlpha: number): void {
    const alpha = Math.max(0, Math.min(1, rawAlpha));
    for (const state of this.state.vehicles) {
      const binding = this.bindings.get(state.vehicleId);
      const current = this.currentPoses.get(state.vehicleId);
      const previous = this.previousPoses.get(state.vehicleId) ?? current;
      if (!binding || binding.freeBody || !current || !previous) continue;
      const x = previous.centre.x + (current.centre.x - previous.centre.x) * alpha;
      const y = previous.centre.y + (current.centre.y - previous.centre.y) * alpha;
      const angle = interpolateAngle(previous.angleRad, current.angleRad, alpha);
      const body = binding.vehicle.getMatterBody();
      body.setPosition(x, y);
      body.setAngle(angle * 180 / Math.PI);
      body.setVelocity(0, 0);
      body.setAngularVelocity(0);
      const matterBody = body.body as any;
      matterBody.isStatic = true;
      if (matterBody.force) {
        matterBody.force.x = 0;
        matterBody.force.y = 0;
      }
    }
  }

  transitionToFreeBody(
    freeBodyState: FreeBodyInitialState,
    incident: TrainIncidentRecord,
  ): void {
    const binding = this.bindings.get(freeBodyState.vehicleId);
    if (!binding || binding.freeBody) return;
    binding.freeBody = true;
    binding.vehicle.derailed = true;
    binding.vehicle.persistedDynamics = {
      mode: 'free-body',
      x: freeBodyState.x,
      y: freeBodyState.y,
      angleRad: freeBodyState.angleRad,
      velocityX: freeBodyState.velocity.x,
      velocityY: freeBodyState.velocity.y,
      angularVelocityRadPerSec: freeBodyState.angularVelocityRadPerSec,
    };
    const body = binding.vehicle.getMatterBody();
    body.setPosition(freeBodyState.x, freeBodyState.y);
    body.setAngle(freeBodyState.angleRad * 180 / Math.PI);
    body.setVelocity(freeBodyState.velocity.x, freeBodyState.velocity.y);
    body.setAngularVelocity(freeBodyState.angularVelocityRadPerSec);
    const matterBody = body.body as any;
    matterBody.isStatic = false;
    matterBody.railInitiatingImpulse = { ...freeBodyState.initiatingImpulse };
    if (matterBody.force) {
      matterBody.force.x = 0;
      matterBody.force.y = 0;
    }

    this.state = {
      ...this.state,
      vehicles: this.state.vehicles.filter(
        (vehicle) => vehicle.vehicleId !== freeBodyState.vehicleId,
      ),
      couplers: this.state.couplers.filter((coupler) => (
        coupler.leadingVehicleId !== freeBodyState.vehicleId
        && coupler.trailingVehicleId !== freeBodyState.vehicleId
      )),
    };
    this.previousPoses.delete(freeBodyState.vehicleId);
    this.currentPoses.delete(freeBodyState.vehicleId);
    if (!this.emittedIncidentIds.has(incident.incidentId)) {
      this.emittedIncidentIds.add(incident.incidentId);
      EventBus.emit('train:incident', incident);
    }
  }

  getConsistState(): ConsistState {
    return cloneState(this.state);
  }

  getOnRailState(vehicleId: string): OnRailVehicleState | null {
    const state = this.state.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId);
    return state
      ? {
        ...state,
        centre: { ...state.centre },
        hazard: { ...state.hazard },
      }
      : null;
  }

  hasVehicle(vehicleId: string): boolean {
    return this.bindings.has(vehicleId);
  }

  private requireBinding(vehicleId: string): RuntimeBinding {
    const binding = this.bindings.get(vehicleId);
    if (!binding) throw new Error(`Missing runtime binding for "${vehicleId}"`);
    return binding;
  }

  private createCouplers(bindings: readonly TrainDynamicsBinding[]): CouplerState[] {
    const couplers: CouplerState[] = [];
    for (let index = 1; index < bindings.length; index++) {
      couplers.push({
        id: `${this.consistId}:coupler-${index - 1}`,
        leadingVehicleId: bindings[index - 1].state.vehicleId,
        trailingVehicleId: bindings[index].state.vehicleId,
        extension: 0,
        relativeSpeed: bindings[index - 1].state.speedMps - bindings[index].state.speedMps,
        forceN: 0,
        broken: false,
      });
    }
    return couplers;
  }

  private rebuildCurrentPoses(): void {
    this.currentPoses.clear();
    for (const state of this.state.vehicles) {
      const binding = this.requireBinding(state.vehicleId);
      this.currentPoses.set(
        state.vehicleId,
        deriveRailVehiclePose(binding.definition, state, this.resolver),
      );
    }
  }

  private setOnRailBodiesStatic(): void {
    for (const state of this.state.vehicles) {
      const binding = this.requireBinding(state.vehicleId);
      const matterBody = binding.vehicle.getMatterBody().body as any;
      matterBody.isStatic = true;
      if (matterBody.force) {
        matterBody.force.x = 0;
        matterBody.force.y = 0;
      }
    }
  }

  private throttleInput(): number {
    let strongest = 0;
    for (const state of this.state.vehicles) {
      const binding = this.requireBinding(state.vehicleId);
      if (binding.definition.maxTractiveEffortN <= 0) continue;
      const throttle = binding.vehicle.enginePower / GameConfig.TRAIN.ENGINE_POWER;
      if (Math.abs(throttle) > Math.abs(strongest)) strongest = throttle;
    }
    return Math.max(-1, Math.min(1, strongest));
  }

  private syncPersistedOnRailStates(): void {
    for (const state of this.state.vehicles) {
      const binding = this.requireBinding(state.vehicleId);
      binding.vehicle.persistedDynamics = {
        mode: 'on-rail',
        trackUUID: state.centre.trackUUID,
        distance: state.centre.distance,
        direction: state.centre.direction,
        speedMps: state.speedMps,
        consistId: this.consistId,
        consistOrder: binding.order,
      };
    }
  }
}
