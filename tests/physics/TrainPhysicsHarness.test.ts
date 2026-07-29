import {
  compareTrainPhysicsConfigs,
  runTrainPhysicsScenario,
  sweepTrainPhysicsConfig,
  type TrainPhysicsScenario,
} from '../../src/physics/TrainPhysicsHarness';
import {
  STRAIGHT_ACCELERATION_BRAKING_SCENARIO,
  TRAIN_PHYSICS_SCENARIOS,
} from '../../src/physics/TrainPhysicsScenarios';
import { TRAIN_PHYSICS_CONFIG } from '../../src/physics/TrainPhysicsConfig';

describe('TrainPhysicsHarness', () => {
  it('owns a fixed 120 Hz timestep and produces deterministic replay hashes', () => {
    let controlCalls = 0;
    const scenario: TrainPhysicsScenario = {
      ...STRAIGHT_ACCELERATION_BRAKING_SCENARIO,
      id: 'fixed-step-proof',
      durationSeconds: 0.1,
      controlAt(tick) {
        controlCalls += 1;
        return STRAIGHT_ACCELERATION_BRAKING_SCENARIO.controlAt(tick);
      },
    };

    const first = runTrainPhysicsScenario(scenario);
    const second = runTrainPhysicsScenario(scenario);

    expect(controlCalls).toBe(24);
    expect(first.replayHash).toMatch(/^[0-9a-f]{8}$/);
    expect(second.replayHash).toBe(first.replayHash);
  });

  it('measures bogie adherence, transition continuity, forces, acceleration and jerk', () => {
    const metrics = runTrainPhysicsScenario(STRAIGHT_ACCELERATION_BRAKING_SCENARIO);

    expect(metrics.maxFrontBogieError).toBeLessThan(0.01);
    expect(metrics.maxRearBogieError).toBeLessThan(0.01);
    expect(metrics.maxWheelbaseError).toBeLessThan(0.01);
    expect(metrics.maxTransitionJump).toBeLessThan(0.1);
    expect(metrics.maxCouplerForceN).toBeGreaterThan(0);
    expect(metrics.maxAccelerationMps2).toBeGreaterThan(0);
    expect(Number.isFinite(metrics.maxJerkMps3)).toBe(true);
    expect(metrics.derailmentTick).toBeNull();
  });

  it('uses plain route fixtures rather than a Phaser scene update loop', () => {
    const state = STRAIGHT_ACCELERATION_BRAKING_SCENARIO.build();
    const routeTrack = state.resolver.trackByUUID(state.consist.vehicles[0].centre.trackUUID);

    expect(routeTrack).not.toBeNull();
    expect(routeTrack).not.toHaveProperty('scene');
  });

  it('compares and sweeps explicit physics configurations', () => {
    const candidate = { ...TRAIN_PHYSICS_CONFIG, aerodynamicDrag: 60 };
    const comparison = compareTrainPhysicsConfigs(
      STRAIGHT_ACCELERATION_BRAKING_SCENARIO,
      TRAIN_PHYSICS_CONFIG,
      candidate,
    );
    const sweep = sweepTrainPhysicsConfig(
      [STRAIGHT_ACCELERATION_BRAKING_SCENARIO],
      TRAIN_PHYSICS_CONFIG,
      [{ aerodynamicDrag: 60 }, { rollingResistancePerKg: 0.03 }],
    );

    expect(comparison.candidate.replayHash).not.toBe(comparison.baseline.replayHash);
    expect(sweep).toHaveLength(2);
    expect(Object.keys(sweep[0].metricsByScenario)).toEqual([
      STRAIGHT_ACCELERATION_BRAKING_SCENARIO.id,
    ]);
  });

  it('runs the standard scenario corpus with finite bounded metrics', () => {
    expect(TRAIN_PHYSICS_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'straight-acceleration-braking',
      'safe-constant-radius-curve',
      's-curve',
      'connected-segments',
      'active-junction',
      'gradient-transition',
      'mixed-power-consist',
      '40-car-acceptance',
    ]);

    for (const scenario of TRAIN_PHYSICS_SCENARIOS) {
      const metrics = runTrainPhysicsScenario(scenario);
      expect(Number.isFinite(metrics.maxAccelerationMps2)).toBe(true);
      expect(metrics.maxFrontBogieError).toBeLessThan(0.01);
      expect(metrics.maxRearBogieError).toBeLessThan(0.01);
    }
  });
});
