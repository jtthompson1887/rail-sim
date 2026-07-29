import { TrackArcLengthIndex } from '../../src/physics/TrackArcLengthIndex';
import type { TrackGeometryDef } from '../../src/systems/TrackGeometry';

const nonUniformStraight: TrackGeometryDef = {
  geometryVersion: 1,
  p0: { x: 0, y: 0 },
  p1: { x: 10, y: 0 },
  p2: { x: 50, y: 0 },
  p3: { x: 300, y: 0 },
};

const curved: TrackGeometryDef = {
  geometryVersion: 1,
  p0: { x: 0, y: 0 },
  p1: { x: 0, y: 120 },
  p2: { x: 180, y: 160 },
  p3: { x: 260, y: 20 },
};

describe('TrackArcLengthIndex', () => {
  it('queries a non-uniform Bezier by travelled distance rather than raw t', () => {
    const index = new TrackArcLengthIndex(nonUniformStraight, 4);

    expect(index.length).toBeCloseTo(300, 8);
    const half = index.poseAtDistance(index.length / 2);
    expect(half.point.x).toBeCloseTo(150, 6);
    expect(half.point.y).toBe(0);
    expect(half.tangent).toEqual({ x: 1, y: 0 });
    expect(half.curvature).toBe(0);
  });

  it('returns exact endpoints and clamps distances outside the track', () => {
    const index = new TrackArcLengthIndex(curved, 4);

    expect(index.poseAtDistance(-50).point).toEqual(curved.p0);
    expect(index.poseAtDistance(index.length + 50).point).toEqual(curved.p3);
  });

  it('returns unit tangents, signed curvature, and replays nearest distance', () => {
    const index = new TrackArcLengthIndex(curved, 4);
    const expectedDistance = index.length * 0.57;
    const pose = index.poseAtDistance(expectedDistance);

    expect(Math.hypot(pose.tangent.x, pose.tangent.y)).toBeCloseTo(1, 8);
    expect(Number.isFinite(pose.curvature)).toBe(true);
    expect(Math.abs(pose.curvature)).toBeGreaterThan(0.0001);
    expect(index.distanceForPoint(pose.point)).toBeCloseTo(expectedDistance, 1);
  });

  it('projects points onto a straight track and clamps beyond its ends', () => {
    const index = new TrackArcLengthIndex(nonUniformStraight, 4);

    expect(index.distanceForPoint({ x: 120, y: 80 })).toBeCloseTo(120, 1);
    expect(index.distanceForPoint({ x: -20, y: 0 })).toBe(0);
    expect(index.distanceForPoint({ x: 350, y: 0 })).toBeCloseTo(300, 8);
  });

  it('rejects non-finite geometry and invalid sample spacing', () => {
    expect(() => new TrackArcLengthIndex({
      ...curved,
      p2: { x: Number.NaN, y: 20 },
    }, 4)).toThrow(/finite/i);
    expect(() => new TrackArcLengthIndex(curved, 0)).toThrow(/sample spacing/i);
  });
});
