import {
  buildTrainPhysicsLabReport,
  mergeTrainPhysicsLabConfig,
} from '../../src/ui/TrainPhysicsLabOverlay';
import { TRAIN_PHYSICS_CONFIG } from '../../src/physics/TrainPhysicsConfig';
import type { TrainPhysicsMetrics } from '../../src/physics/TrainPhysicsHarness';

describe('train physics browser laboratory', () => {
  it('merges candidate overrides without dropping nested safety limits', () => {
    const candidate = mergeTrainPhysicsLabConfig(TRAIN_PHYSICS_CONFIG, {
      aerodynamicDrag: 8,
      coupler: {
        ...TRAIN_PHYSICS_CONFIG.coupler,
        dampingNsPerMetre: 95_000,
      },
    });

    expect(candidate.aerodynamicDrag).toBe(8);
    expect(candidate.coupler.dampingNsPerMetre).toBe(95_000);
    expect(candidate.coupler.breakForceN).toBe(4_000_000);
    expect(candidate.derailment).toEqual(TRAIN_PHYSICS_CONFIG.derailment);
  });

  it('exports a finite deterministic comparison report', () => {
    const metrics: TrainPhysicsMetrics = {
      replayHash: 'deadbeef',
      maxFrontBogieError: 0,
      maxRearBogieError: 0,
      maxWheelbaseError: 0,
      maxTransitionJump: 0,
      maxCouplerForceN: 125_000,
      maxAccelerationMps2: 1.25,
      maxJerkMps3: 3.5,
      derailmentTick: null,
      durationMs: 12,
    };

    const report = buildTrainPhysicsLabReport(
      'safe-constant-radius-curve',
      metrics,
      metrics,
    );

    expect(report).toEqual({
      scenarioId: 'safe-constant-radius-curve',
      baseline: metrics,
      candidate: metrics,
      replayMatches: true,
      allMetricsFinite: true,
    });
  });
});
