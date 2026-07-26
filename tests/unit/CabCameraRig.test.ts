import { CabCameraRig } from '../../src/cab3d/camera/CabCameraRig';
import type { CabWorldSnapshot } from '../../src/cab3d/model/CabWorldSnapshot';

describe('CabCameraRig', () => {
  function makeSnapshot(
    grade = 0,
    curvature = 0,
    speedMps = 10,
  ): CabWorldSnapshot {
    const samples = [];
    for (let d = -120; d <= 800; d += 2) {
      const x = 100 + d;
      const y = 200;
      const elevation = d * grade;
      samples.push({
        x,
        y,
        elevation,
        headingRad: 0,
        curvature,
        structure: 'surface' as const,
        distance: d,
      });
    }

    return {
      valid: true,
      seed: 'test',
      biome: 'temperate',
      vehicle: {
        id: 'train-1',
        x: 100,
        y: 200,
        headingRad: 0,
        speedMps,
        throttle: 0.5,
        derailed: false,
        onTrack: true,
      },
      path: samples,
      elapsedSecs: 0,
      weather: null,
    };
  }

  it('returns a zero transform for an invalid snapshot', () => {
    const rig = new CabCameraRig();
    const transform = rig.update(16, { ...makeSnapshot(), valid: false });
    expect(transform.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(transform.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('places the eye above the rail at the forward offset', () => {
    const rig = new CabCameraRig();
    const transform = rig.update(16, makeSnapshot());

    // Vehicle at (100,200); eye 8.5 m forward along heading 0 -> x=108.5.
    // Driver sits -0.58 m left, so worldY = 199.42 -> Babylon Z = -199.42.
    // Eye height = 2.40.
    expect(transform.position.x).toBeCloseTo(108.5, 1);
    expect(transform.position.y).toBeCloseTo(2.4, 2);
    expect(transform.position.z).toBeCloseTo(-199.4, 1);

    // Body node stays at rail head (track centreline).
    expect(transform.body.position.x).toBeCloseTo(108.5, 1);
    expect(transform.body.position.y).toBeCloseTo(0, 2);
    expect(transform.body.position.z).toBeCloseTo(-200, 1);
  });

  it('pitches the camera up for an uphill grade', () => {
    const rig = new CabCameraRig();
    const transform = rig.update(16, makeSnapshot(0.02));

    // Positive grade -> positive physical pitch -> negative camera pitch.
    expect(transform.rotation.x).toBeLessThan(0);
  });

  it('rolls the camera for a left-hand curve', () => {
    const rig = new CabCameraRig();
    const curvature = 1 / 300;
    const speed = 10;
    const expectedRoll = -0.055 * curvature * speed * speed;

    const transform = rig.update(16, makeSnapshot(0, curvature, speed));
    expect(transform.rotation.z).toBeCloseTo(expectedRoll, 5);
  });
});
