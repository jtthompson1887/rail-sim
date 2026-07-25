import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import {
  createTrackGeometry,
  deriveAutomaticCubic,
} from '../../src/systems/TrackGeometry';

const { makeScene } = require('../../__mocks__/phaser');
const PhaserCubicBezier = require('../../node_modules/phaser/src/curves/CubicBezierCurve');
const PhaserVector2 = require('../../node_modules/phaser/src/math/Vector2');

function makeTrack() {
  const scene = makeScene();
  const controls = {
    p0: new Phaser.Math.Vector2(10, 20),
    p1: new Phaser.Math.Vector2(130, 310),
    p2: new Phaser.Math.Vector2(360, -140),
    p3: new Phaser.Math.Vector2(520, 80),
  };
  return {
    track: new RailTrack(scene, controls.p0, controls.p1, controls.p2, controls.p3),
    controls,
  };
}

describe('canonical track geometry', () => {
  it('matches Phaser cubic Bézier points and tangents at representative parameters', () => {
    const { track, controls } = makeTrack();
    const reference = new PhaserCubicBezier(
      new PhaserVector2(controls.p0.x, controls.p0.y),
      new PhaserVector2(controls.p1.x, controls.p1.y),
      new PhaserVector2(controls.p2.x, controls.p2.y),
      new PhaserVector2(controls.p3.x, controls.p3.y),
    );

    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const actualPoint = track.getCurvePath().getPoint(t);
      const expectedPoint = reference.getPoint(t);
      expect(actualPoint.x).toBeCloseTo(expectedPoint.x, 9);
      expect(actualPoint.y).toBeCloseTo(expectedPoint.y, 9);

      const actualTangent = track.getCurvePath().getTangent(t);
      const expectedTangent = reference.getTangent(t);
      expect(actualTangent.x).toBeCloseTo(expectedTangent.x, 9);
      expect(actualTangent.y).toBeCloseTo(expectedTangent.y, 9);
    }
  });

  it('keeps the pure geometry implementation in parity with Phaser', () => {
    const { controls } = makeTrack();
    const geometry = createTrackGeometry({
      geometryVersion: 1,
      p0: controls.p0,
      p1: controls.p1,
      p2: controls.p2,
      p3: controls.p3,
    });
    const reference = new PhaserCubicBezier(
      new PhaserVector2(controls.p0.x, controls.p0.y),
      new PhaserVector2(controls.p1.x, controls.p1.y),
      new PhaserVector2(controls.p2.x, controls.p2.y),
      new PhaserVector2(controls.p3.x, controls.p3.y),
    );

    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const point = geometry.pointAt(t);
      const tangent = geometry.tangentAt(t);
      const expectedPoint = reference.getPoint(t);
      const expectedTangent = reference.getTangent(t);
      expect(point.x).toBeCloseTo(expectedPoint.x, 9);
      expect(point.y).toBeCloseTo(expectedPoint.y, 9);
      expect(tangent.x).toBeCloseTo(expectedTangent.x, 3);
      expect(tangent.y).toBeCloseTo(expectedTangent.y, 3);
    }
  });

  it('samples endpoints and approximates length with the same cubic points', () => {
    const { controls } = makeTrack();
    const geometry = createTrackGeometry({
      geometryVersion: 1,
      p0: controls.p0,
      p1: controls.p1,
      p2: controls.p2,
      p3: controls.p3,
    });
    const reference = new PhaserCubicBezier(
      new PhaserVector2(controls.p0.x, controls.p0.y),
      new PhaserVector2(controls.p1.x, controls.p1.y),
      new PhaserVector2(controls.p2.x, controls.p2.y),
      new PhaserVector2(controls.p3.x, controls.p3.y),
    );

    const samples = geometry.sample(8);
    expect(samples).toHaveLength(9);
    expect(samples[0]).toEqual({ t: 0, point: { x: controls.p0.x, y: controls.p0.y } });
    expect(samples[8]).toEqual({ t: 1, point: { x: controls.p3.x, y: controls.p3.y } });
    expect(geometry.approximateLength()).toBeCloseTo(reference.getLength(), 9);
  });

  it.each([
    ['minimum clamp', { x: 0, y: 0 }, { x: 30, y: 0 }, 50],
    ['chord third', { x: 0, y: 0 }, { x: 300, y: 0 }, 100],
    ['maximum clamp', { x: 0, y: 0 }, { x: 1500, y: 0 }, 400],
  ])('derives automatic handles using the %s distance', (_label, start, end, distance) => {
    const def = deriveAutomaticCubic({ start, end });
    expect(def).toEqual({
      geometryVersion: 1,
      p0: start,
      p1: { x: distance, y: 0 },
      p2: { x: end.x - distance, y: 0 },
      p3: end,
    });
  });

  it('applies snapped start-outward and end-inward port signs', () => {
    const def = deriveAutomaticCubic({
      start: { x: 0, y: 0 },
      end: { x: 300, y: 0 },
      startOutward: { x: 0, y: 5 },
      endOutward: { x: 0, y: -8 },
    });
    expect(def.p1).toEqual({ x: 0, y: 100 });
    expect(def.p2).toEqual({ x: 300, y: -100 });
    expect(createTrackGeometry(def).tangentAt(0)).toEqual({ x: 0, y: 1 });
    expect(createTrackGeometry(def).tangentAt(1)).toEqual({ x: 0, y: 1 });
  });

  it('is deterministic and tangent-continuous across a shared snapped port', () => {
    const first = deriveAutomaticCubic({
      start: { x: 0, y: 0 },
      end: { x: 300, y: 0 },
    });
    const sharedOutward = { x: 1, y: 0 };
    const second = deriveAutomaticCubic({
      start: { x: 300, y: 0 },
      end: { x: 600, y: 0 },
      startOutward: sharedOutward,
    });
    expect(deriveAutomaticCubic({
      start: { x: 300, y: 0 },
      end: { x: 600, y: 0 },
      startOutward: sharedOutward,
    })).toEqual(second);
    expect(createTrackGeometry(first).tangentAt(1)).toEqual(
      createTrackGeometry(second).tangentAt(0),
    );
  });
});
