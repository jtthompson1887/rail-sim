import {
  createDerailmentHazardState,
  evaluateDerailment,
} from '../../src/physics/DerailmentEvaluator';
import type { DerailmentPhysicsConfig } from '../../src/physics/TrainPhysicsConfig';

const config: DerailmentPhysicsConfig = {
  warningLateralAccelerationMps2: 4,
  hardLateralAccelerationMps2: 6,
  warningCouplerLoadRatio: 0.85,
  hazardPerSecondAtHardBoundary: 2,
  hardCouplerForceN: 1_000,
  hardCollisionImpulseNs: 100,
};

function inputs(lateralAcceleration: number) {
  return {
    speedMps: Math.sqrt(lateralAcceleration),
    curvature: 1,
    peakCouplerForceN: 0,
    collisionImpulseNs: 0,
    routeContinuous: true,
    conditionModifier: 1,
  };
}

describe('evaluateDerailment', () => {
  it('keeps zero hazard below the warning boundary', () => {
    const previous = createDerailmentHazardState('vehicle-1');
    const decision = evaluateDerailment(previous, inputs(3.99), config, 0.1);

    expect(decision).toEqual({ kind: 'safe', hazard: previous });
  });

  it('accumulates warning exposure deterministically', () => {
    const previous = {
      ...createDerailmentHazardState('vehicle-1'),
      seededThreshold: 10,
    };
    const first = evaluateDerailment(previous, inputs(5), config, 0.1);
    const replay = evaluateDerailment(previous, inputs(5), config, 0.1);

    expect(first).toEqual(replay);
    expect(first.kind).toBe('warning');
    expect(first.hazard.accumulatedHazard).toBeCloseTo(0.1, 9);
  });

  it('clears warning exposure and advances the deterministic episode after recovery', () => {
    const initial = {
      ...createDerailmentHazardState('vehicle-1'),
      accumulatedHazard: 0.4,
    };
    const decision = evaluateDerailment(initial, inputs(2), config, 0.1);

    expect(decision.kind).toBe('safe');
    expect(decision.hazard.accumulatedHazard).toBe(0);
    expect(decision.hazard.episodeId).toBe(initial.episodeId + 1);
    expect(decision.hazard.seededThreshold).not.toBe(initial.seededThreshold);
  });

  it('derails on the exact hard lateral boundary', () => {
    const decision = evaluateDerailment(
      createDerailmentHazardState('vehicle-1'),
      inputs(6),
      config,
      1 / 120,
    );

    expect(decision).toMatchObject({ kind: 'derail', cause: 'lateral-acceleration' });
  });

  it('derails immediately on route discontinuity, coupler overload, and collision impulse', () => {
    const previous = createDerailmentHazardState('vehicle-1');

    expect(evaluateDerailment(previous, {
      ...inputs(0),
      routeContinuous: false,
    }, config, 1 / 120)).toMatchObject({ kind: 'derail', cause: 'route-discontinuity' });
    expect(evaluateDerailment(previous, {
      ...inputs(0),
      peakCouplerForceN: 1_000,
    }, config, 1 / 120)).toMatchObject({ kind: 'derail', cause: 'coupler-overload' });
    expect(evaluateDerailment(previous, {
      ...inputs(0),
      collisionImpulseNs: 100,
    }, config, 1 / 120)).toMatchObject({ kind: 'derail', cause: 'collision' });
  });

  it('uses condition modifier one as the neutral future-condition value', () => {
    const previous = createDerailmentHazardState('vehicle-1');
    const neutral = evaluateDerailment(previous, inputs(5), config, 0.1);
    const explicitNeutral = evaluateDerailment(previous, {
      ...inputs(5),
      conditionModifier: 1,
    }, config, 0.1);

    expect(explicitNeutral).toEqual(neutral);
  });
});
