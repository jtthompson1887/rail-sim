import { CabRideModel } from '../../src/cab3d/camera/CabRideModel';
import { degToRad } from '../../src/cab3d/model/CabCoordinate';
import { CabConfig } from '../../src/cab3d/CabConfig';

describe('CabRideModel', () => {
  it('produces vertical bounce with the configured amplitude', () => {
    const model = new CabRideModel();
    // Choose a time where the 4.3 Hz harmonic is at a zero crossing so the
    // fundamental 2.1 Hz component dominates.
    const elapsedSecs = 0.5 / CabConfig.BOUNCE_HARMONIC_FREQ_HZ;
    const state = model.update(16, {
      elapsedSecs,
      speedMps: 0,
      curvature: 0,
      grade: 0,
    });
    const expectedY = CabConfig.BOUNCE_AMP_M
      * Math.sin(2 * Math.PI * CabConfig.BOUNCE_FREQ_HZ * elapsedSecs);
    expect(state.position.y).toBeCloseTo(expectedY, 3);
    expect(state.position.z).toBe(0);
  });

  it('produces lateral sway with the configured amplitude', () => {
    const model = new CabRideModel();
    const state = model.update(16, {
      elapsedSecs: 1 / (4 * 1.3),
      speedMps: 0,
      curvature: 0,
      grade: 0,
    });
    // At the first peak of the 1.3 Hz sine wave.
    expect(state.position.x).toBeCloseTo(0.009, 3);
  });

  it('computes curve roll from curvature and speed', () => {
    const model = new CabRideModel();
    const curvature = 1 / 300;
    const speed = 10;
    const expectedRoll = -0.055 * curvature * speed * speed;

    const state = model.update(16, {
      elapsedSecs: 0,
      speedMps: speed,
      curvature,
      grade: 0,
    });

    expect(state.rotation.roll).toBeCloseTo(expectedRoll, 5);
  });

  it('clamps curve roll to the configured limit', () => {
    const model = new CabRideModel();
    const state = model.update(16, {
      elapsedSecs: 0,
      speedMps: 200,
      curvature: 1,
      grade: 0,
    });

    expect(Math.abs(state.rotation.roll)).toBeCloseTo(degToRad(2.5), 5);
  });

  it('computes grade pitch from grade', () => {
    const model = new CabRideModel();
    const grade = 0.02;
    const state = model.update(16, {
      elapsedSecs: 0,
      speedMps: 0,
      curvature: 0,
      grade,
    });

    expect(state.rotation.pitch).toBeCloseTo(Math.atan(grade), 5);
  });

  it('scales output by the motionScale parameter', () => {
    const model = new CabRideModel();
    const unscaled = model.update(16, {
      elapsedSecs: 1 / (4 * 1.3),
      speedMps: 0,
      curvature: 0,
      grade: 0,
    });
    const scaled = model.update(16, {
      elapsedSecs: 1 / (4 * 1.3),
      speedMps: 0,
      curvature: 0,
      grade: 0,
      motionScale: 0.15,
    });
    expect(scaled.position.x).toBeCloseTo(unscaled.position.x * 0.15, 6);
    expect(scaled.position.y).toBeCloseTo(unscaled.position.y * 0.15, 6);
  });

  it('clamps grade pitch to the configured limit', () => {
    const model = new CabRideModel();
    const state = model.update(16, {
      elapsedSecs: 0,
      speedMps: 0,
      curvature: 0,
      grade: 1,
    });

    expect(state.rotation.pitch).toBeCloseTo(degToRad(1.5), 5);
  });

  it('adds a rail-joint impulse every 18.29 m and decays it', () => {
    const model = new CabRideModel();
    const tau = CabConfig.RAIL_JOINT_DECAY_TAU_S;

    // Move one joint spacing (18.29 m) in a single 16 ms frame.
    const speed = CabConfig.RAIL_JOINT_SPACING_M / 0.016;
    const state1 = model.update(16, {
      elapsedSecs: 0,
      speedMps: speed,
      curvature: 0,
      grade: 0,
    });
    const expectedImpulse1 = CabConfig.RAIL_JOINT_IMPULSE_M * Math.exp(-0.016 / tau);
    expect(state1.position.y).toBeCloseTo(expectedImpulse1, 3);

    // Stop and let the impulse decay for 100 ms.
    const state2 = model.update(100, {
      elapsedSecs: 0,
      speedMps: 0,
      curvature: 0,
      grade: 0,
    });
    const expectedImpulse2 = CabConfig.RAIL_JOINT_IMPULSE_M * Math.exp(-(0.016 + 0.1) / tau);
    expect(state2.position.y).toBeCloseTo(expectedImpulse2, 3);
  });
});
