import Phaser from 'phaser';
import { TerrainValidator } from '../../src/systems/TerrainValidator';
import TrackManager from '../../src/managers/TrackManager';
import RailTrack from '../../src/entities/RailTrack';
import { MAX_ANALYSIS_SAMPLES } from '../../src/config/ConstructionConfig';

const { makeScene } = require('../../__mocks__/phaser');

function v(x: number, y: number): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(x, y);
}

function makeTrack(scene: any, x0: number, y0: number, x3: number, y3: number): RailTrack {
  return new RailTrack(
    scene,
    v(x0, y0),
    v(x0 + (x3 - x0) / 3, y0 + (y3 - y0) / 3),
    v(x0 + (x3 - x0) * 2 / 3, y0 + (y3 - y0) * 2 / 3),
    v(x3, y3),
  );
}

describe('TerrainValidator construction analyser adapter', () => {
  it('derives the two-point form through the canonical automatic cubic authority', () => {
    const validator = new TerrainValidator({ getHeightAt: () => 0 } as any);

    const proposal = validator.canPlaceTrack(v(0, 0), v(900, 0));

    expect(proposal.valid).toBe(true);
    expect(proposal.geometry).toEqual({
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 300, y: 0 },
      p2: { x: 600, y: 0 },
      p3: { x: 900, y: 0 },
    });
    expect(proposal.verticalProfile.profileVersion).toBe(1);
    expect(proposal.structures).toEqual([
      expect.objectContaining({ type: 'surface', startT: 0, endT: 1 }),
    ]);
  });

  it('passes the exact four-point cubic through the single analyser rule set', () => {
    const getHeightAt = jest.fn((_x: number, y: number) => (y > 200 ? 180 : 0));
    const validator = new TerrainValidator({ getHeightAt } as any);
    const controls = [
      v(-1000, 0),
      v(-333, 400),
      v(333, 400),
      v(1000, 0),
    ] as const;

    const proposal = validator.canPlaceTrack(...controls, 4, null);

    expect(proposal.geometry).toEqual({
      geometryVersion: 1,
      p0: { x: -1000, y: 0 },
      p1: { x: -333, y: 400 },
      p2: { x: 333, y: 400 },
      p3: { x: 1000, y: 0 },
    });
    expect(proposal.structures.some((interval) => interval.type === 'tunnel')).toBe(true);
    expect(getHeightAt.mock.calls.length).toBeLessThanOrEqual(MAX_ANALYSIS_SAMPLES);
  });

  it('reports grade and curvature failures using analyser reason codes', () => {
    const gradeValidator = new TerrainValidator({
      getHeightAt: (x: number) => x * 0.1,
    } as any);
    const curvatureValidator = new TerrainValidator({ getHeightAt: () => 0 } as any);

    expect(gradeValidator.canPlaceTrack(v(0, 0), v(640, 0)).reasonCode).toBe('grade');
    expect(curvatureValidator.canPlaceTrack(
      v(0, 0),
      v(0, 50),
      v(50, 50),
      v(50, 0),
      20,
      null,
    ).reasonCode).toBe('curvature');
  });

  it('adapts a nearby Phaser track tangent into the analyser alignment option', () => {
    const scene = makeScene();
    const manager = new TrackManager(scene);
    manager.addTrack(makeTrack(scene, 0, 0, 200, 0));
    const validator = new TerrainValidator({ getHeightAt: () => 0 } as any);
    const angle30 = Math.PI / 6;

    const proposal = validator.canPlaceTrack(
      v(200, 0),
      v(200 + Math.cos(angle30) * 100, Math.sin(angle30) * 100),
      v(200 + Math.cos(angle30) * 200, Math.sin(angle30) * 200),
      v(200 + Math.cos(angle30) * 300, Math.sin(angle30) * 300),
      20,
      manager,
    );

    expect(proposal.valid).toBe(false);
    expect(proposal.reasonCode).toBe('misaligned');
  });
});
