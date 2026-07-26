const { makeScene } = require('../../__mocks__/phaser');
const Phaser = require('phaser');

import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import RailTrack from '../../src/entities/RailTrack';
import { buildCabTrackSpans } from '../../src/cab3d/adapters/CabTrackGraphAdapter';
import { CabPathSampler } from '../../src/cab3d/model/CabPathSampler';
import { CabConfig } from '../../src/cab3d/CabConfig';

function makeStraightTrack(scene: unknown, x1: number, y1: number, x2: number, y2: number): RailTrack {
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1 + (y2 - y1) / 3);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1 + 2 * (y2 - y1) / 3);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  return new RailTrack(scene as any, p0, p1, p2, p3);
}

describe('CabTrackGraphAdapter', () => {
  let scene: any;
  let terrain: TerrainGenerator;

  beforeEach(() => {
    scene = makeScene();
    terrain = new TerrainGenerator('test');
  });

  it('builds a straight path span centred on the train', () => {
    const track = makeStraightTrack(scene, 0, 0, 1000, 0);
    const spans = buildCabTrackSpans(track, 0.5, 0, terrain);
    const path = new CabPathSampler().sample(spans, {
      near: -120,
      far: 400,
      spacing: 2,
    });

    expect(path.length).toBe(261);
    expect(path[0].x).toBeCloseTo(380, 1);
    expect(path[path.length - 1].x).toBeCloseTo(900, 1);

    for (const sample of path) {
      expect(sample.y).toBeCloseTo(0, 1);
      expect(sample.headingRad).toBeCloseTo(0, 5);
      expect(sample.curvature).toBe(0);
    }
  });

  it('uses the vertical profile to set sample elevations', () => {
    const track = makeStraightTrack(scene, 0, 0, 1000, 0);
    track.setConstructionData(
      { profileVersion: 1, knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 20 }] },
      [{ type: 'surface', startT: 0, endT: 1, startElevation: 0, endElevation: 20 }],
      0,
    );

    const spans = buildCabTrackSpans(track, 0.5, 0, terrain);
    const path = new CabPathSampler().sample(spans, { near: -120, far: 400, spacing: 2 });

    const atZero = path.find((s) => s.distance === 0)!;
    expect(atZero.elevation).toBeCloseTo(10, 2);

    const atHundred = path.find((s) => s.distance === 100)!;
    expect(atHundred.elevation).toBeCloseTo(12, 2);
  });

  it('carries structure types from the track', () => {
    const track = makeStraightTrack(scene, 0, 0, 1000, 0);
    track.setConstructionData(
      { profileVersion: 1, knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }] },
      [{ type: 'bridge', startT: 0, endT: 1, startElevation: 0, endElevation: 0 }],
      0,
    );

    const spans = buildCabTrackSpans(track, 0.5, 0, terrain);
    const path = new CabPathSampler().sample(spans, { near: -120, far: 400, spacing: 2 });

    expect(path.every((s) => s.structure === 'bridge')).toBe(true);
  });

  it('follows connected track segments', () => {
    const track1 = makeStraightTrack(scene, 0, 0, 500, 0);
    const track2 = makeStraightTrack(scene, 500, 0, 1000, 0);
    track1.setNext(track2);
    track2.setPrevious(track1);

    const spans = buildCabTrackSpans(track1, 0.5, 0, terrain);
    const path = new CabPathSampler().sample(spans, { near: -120, far: 700, spacing: 2 });

    // Train at x=250, +700 m reaches x=950, inside the two connected tracks.
    const lastSample = path[path.length - 1];
    expect(lastSample.x).toBeCloseTo(950, 1);
  });

  it('falls back to terrain height when no vertical profile is set', () => {
    const track = makeStraightTrack(scene, 0, 0, 1000, 0);
    const spans = buildCabTrackSpans(track, 0.5, 0, terrain);
    const path = new CabPathSampler().sample(spans, { near: 0, far: 0, spacing: 2 });

    expect(path.length).toBe(1);
    // Terrain height at (500,0) for seed 'test' is deterministic.
    expect(path[0].elevation).toEqual(terrain.getHeightAt(500, 0));
  });

  it('returns a single-span fallback when the train heads backward along the track', () => {
    const track = makeStraightTrack(scene, 0, 0, 1000, 0);
    // Heading PI (left) with tangent pointing right -> travel toward t=0.
    const spans = buildCabTrackSpans(track, 0.5, Math.PI, terrain);
    const path = new CabPathSampler().sample(spans, { near: -120, far: 400, spacing: 2 });

    expect(path.length).toBe(261);
    // Travelling backward from x=500, -120 m -> x=380, +400 m -> x=100.
    expect(path[0].x).toBeCloseTo(620, 1);
    expect(path[path.length - 1].x).toBeCloseTo(100, 1);
  });
});
