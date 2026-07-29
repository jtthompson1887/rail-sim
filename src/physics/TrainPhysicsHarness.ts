import {
  ConsistDynamicsSolver,
  type ConsistControl,
  type ConsistState,
} from './ConsistDynamicsSolver';
import {
  deriveRailVehiclePose,
  type RailVehicleDefinition,
} from './RailVehicleModel';
import {
  RouteCursor,
  type RouteResolver,
} from './RouteCursor';
import {
  TRAIN_PHYSICS_CONFIG,
  type TrainPhysicsConfig,
} from './TrainPhysicsConfig';

export interface TrainPhysicsMetrics {
  replayHash: string;
  maxFrontBogieError: number;
  maxRearBogieError: number;
  maxWheelbaseError: number;
  maxTransitionJump: number;
  maxCouplerForceN: number;
  maxAccelerationMps2: number;
  maxJerkMps3: number;
  derailmentTick: number | null;
  durationMs: number;
}

export interface TrainPhysicsScenarioState {
  consist: ConsistState;
  definitions: ReadonlyMap<string, RailVehicleDefinition>;
  resolver: RouteResolver;
}

export interface TrainPhysicsScenario {
  id: string;
  durationSeconds: number;
  build(): TrainPhysicsScenarioState;
  controlAt(tick: number): ConsistControl;
  assert(metrics: TrainPhysicsMetrics): void;
}

function distance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function hashReplay(value: unknown): string {
  const serialised = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialised.length; index++) {
    hash ^= serialised.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `00000000${(hash >>> 0).toString(16)}`.slice(-8);
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export function runTrainPhysicsScenario(
  scenario: TrainPhysicsScenario,
  config: Readonly<TrainPhysicsConfig> = TRAIN_PHYSICS_CONFIG,
): TrainPhysicsMetrics {
  const started = now();
  const built = scenario.build();
  const solver = new ConsistDynamicsSolver(config);
  const tickCount = Math.round(scenario.durationSeconds / config.fixedStepSeconds);
  let state = built.consist;
  let maxFrontBogieError = 0;
  let maxRearBogieError = 0;
  let maxWheelbaseError = 0;
  let maxTransitionJump = 0;
  let maxCouplerForceN = 0;
  let maxAccelerationMps2 = 0;
  let maxJerkMps3 = 0;
  let derailmentTick: number | null = null;
  const previousAcceleration = new Map<string, number>();
  const previousCentre = new Map<string, { x: number; y: number }>();

  for (let tick = 0; tick < tickCount; tick++) {
    const previousSpeeds = new Map(
      state.vehicles.map((vehicle) => [vehicle.vehicleId, vehicle.speedMps]),
    );
    const result = solver.step(
      state,
      built.definitions,
      scenario.controlAt(tick),
      built.resolver,
      config.fixedStepSeconds,
    );
    state = result.state;
    if (derailmentTick === null && result.derailments.length > 0) {
      derailmentTick = tick;
    }

    for (const vehicle of state.vehicles) {
      const definition = built.definitions.get(vehicle.vehicleId);
      if (!definition) throw new Error(`Scenario is missing definition "${vehicle.vehicleId}"`);
      const pose = deriveRailVehiclePose(definition, vehicle, built.resolver);
      const centreCursor = new RouteCursor(vehicle.centre, built.resolver);
      const expectedFront = centreCursor.movedBy(definition.wheelbase / 2).pose().point;
      const expectedRear = centreCursor.movedBy(-definition.wheelbase / 2).pose().point;
      const replayedRear = centreCursor
        .movedBy(definition.wheelbase / 2)
        .movedBy(-definition.wheelbase)
        .pose()
        .point;
      maxFrontBogieError = Math.max(maxFrontBogieError, distance(pose.frontBogie, expectedFront));
      maxRearBogieError = Math.max(maxRearBogieError, distance(pose.rearBogie, expectedRear));
      maxWheelbaseError = Math.max(maxWheelbaseError, distance(replayedRear, expectedRear));

      const priorPoint = previousCentre.get(vehicle.vehicleId);
      if (priorPoint) {
        const maximumTravel = Math.abs(vehicle.speedMps)
          * config.fixedStepSeconds
          * config.worldUnitsPerMetre;
        maxTransitionJump = Math.max(
          maxTransitionJump,
          Math.max(0, distance(priorPoint, pose.centre) - maximumTravel),
        );
      }
      previousCentre.set(vehicle.vehicleId, pose.centre);

      const priorSpeed = previousSpeeds.get(vehicle.vehicleId) ?? vehicle.speedMps;
      const acceleration = (vehicle.speedMps - priorSpeed) / config.fixedStepSeconds;
      maxAccelerationMps2 = Math.max(maxAccelerationMps2, Math.abs(acceleration));
      const priorAcceleration = previousAcceleration.get(vehicle.vehicleId);
      if (priorAcceleration !== undefined) {
        maxJerkMps3 = Math.max(
          maxJerkMps3,
          Math.abs(acceleration - priorAcceleration) / config.fixedStepSeconds,
        );
      }
      previousAcceleration.set(vehicle.vehicleId, acceleration);
    }

    for (const coupler of state.couplers) {
      maxCouplerForceN = Math.max(maxCouplerForceN, Math.abs(coupler.forceN));
    }
  }

  const replayHash = hashReplay({
    scenarioId: scenario.id,
    config,
    state,
    maxFrontBogieError,
    maxRearBogieError,
    maxWheelbaseError,
    maxTransitionJump,
    maxCouplerForceN,
    maxAccelerationMps2,
    maxJerkMps3,
  });
  const metrics: TrainPhysicsMetrics = {
    replayHash,
    maxFrontBogieError,
    maxRearBogieError,
    maxWheelbaseError,
    maxTransitionJump,
    maxCouplerForceN,
    maxAccelerationMps2,
    maxJerkMps3,
    derailmentTick,
    durationMs: now() - started,
  };
  scenario.assert(metrics);
  return metrics;
}

export function compareTrainPhysicsConfigs(
  scenario: TrainPhysicsScenario,
  baseline: Readonly<TrainPhysicsConfig>,
  candidate: Readonly<TrainPhysicsConfig>,
): { baseline: TrainPhysicsMetrics; candidate: TrainPhysicsMetrics } {
  return {
    baseline: runTrainPhysicsScenario(scenario, baseline),
    candidate: runTrainPhysicsScenario(scenario, candidate),
  };
}

export function sweepTrainPhysicsConfig(
  scenarios: readonly TrainPhysicsScenario[],
  base: Readonly<TrainPhysicsConfig>,
  variants: readonly Partial<TrainPhysicsConfig>[],
): readonly {
  overrides: Partial<TrainPhysicsConfig>;
  metricsByScenario: Readonly<Record<string, TrainPhysicsMetrics>>;
}[] {
  return variants.map((overrides) => {
    const config: TrainPhysicsConfig = {
      ...base,
      ...overrides,
      coupler: overrides.coupler ?? base.coupler,
      derailment: overrides.derailment ?? base.derailment,
    };
    const metricsByScenario: Record<string, TrainPhysicsMetrics> = {};
    scenarios.forEach((scenario) => {
      metricsByScenario[scenario.id] = runTrainPhysicsScenario(scenario, config);
    });
    return { overrides, metricsByScenario };
  });
}
