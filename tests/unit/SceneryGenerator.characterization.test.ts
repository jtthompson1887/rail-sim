import Phaser from 'phaser';
import { GameConfig } from '../../src/config/GameConfig';
import { SceneryGenerator } from '../../src/systems/SceneryGenerator';

describe('SceneryGenerator deterministic placement contracts', () => {
  function flatLowland() {
    return {
      getBandAt: jest.fn(() => 'LOWLAND'),
      slopeAt: jest.fn(() => 0),
    };
  }

  it('replays an identical, bounded placement set for the same seed and chunk', () => {
    const terrain = flatLowland();
    const generator = new SceneryGenerator(terrain as any);

    const first = generator.generateForChunk(0, 0, 'repeatable-seed', 'temperate');
    const replay = generator.generateForChunk(0, 0, 'repeatable-seed', 'temperate');

    expect(first.length).toBeGreaterThan(0);
    expect(replay).toEqual(first);
    for (const def of first) {
      expect(def.id).toBe(`0_0_${Math.floor(def.x)}_${Math.floor(def.y)}`);
      expect(def.x).toBeGreaterThanOrEqual(0);
      expect(def.x).toBeLessThan(GameConfig.WORLD.CHUNK_SIZE);
      expect(def.y).toBeGreaterThanOrEqual(0);
      expect(def.y).toBeLessThan(GameConfig.WORLD.CHUNK_SIZE);
      expect(def.scale).toBeGreaterThan(0);
      expect(def.variant).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(def.variant)).toBe(true);
      expect(Number.isFinite(def.rotation)).toBe(true);
    }
    expect(terrain.getBandAt).toHaveBeenCalled();
    expect(terrain.slopeAt).toHaveBeenCalledTimes(terrain.getBandAt.mock.calls.length);
  });

  it('returns no placements or terrain queries for a chunk wholly outside the finite world', () => {
    const terrain = flatLowland();
    const generator = new SceneryGenerator(terrain as any);
    const halfWidth = GameConfig.TERRAIN.WORLD_WIDTH / 2;

    expect(generator.generateForChunk(halfWidth, 0, 'edge-seed', 'temperate'))
      .toEqual([]);
    expect(terrain.getBandAt).not.toHaveBeenCalled();
    expect(terrain.slopeAt).not.toHaveBeenCalled();
  });

  it('produces Poisson candidates inside the requested chunk with minimum separation', () => {
    const generator = new SceneryGenerator(flatLowland() as any);
    const rng = new Phaser.Math.RandomDataGenerator(['poisson-fixture']);

    const points = generator.poissonDisk(4096, -4096, rng);

    expect(points.length).toBeGreaterThan(1);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(4096);
      expect(point.x).toBeLessThan(8192);
      expect(point.y).toBeGreaterThanOrEqual(-4096);
      expect(point.y).toBeLessThan(0);
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        expect(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y))
          .toBeGreaterThanOrEqual(GameConfig.TERRAIN.SCENERY_MIN_DIST - 1e-9);
      }
    }
  });

  it('rejects terrain with no eligible assets and filters excessive slopes', () => {
    const generator = new SceneryGenerator(flatLowland() as any);
    const rng = { frac: jest.fn(() => 0) } as any;

    expect(generator.pickAsset(0, 0, 'WATER', 0, 'temperate', rng)).toBeNull();
    expect(generator.pickAsset(0, 0, 'LOWLAND', 100, 'temperate', rng)).toBeNull();
    expect(generator.pickAsset(0, 0, 'LOWLAND', 0, 'temperate', rng)?.type)
      .toBe('tree_oak');
  });

  it('applies biome weights during deterministic weighted selection', () => {
    const generator = new SceneryGenerator(flatLowland() as any);
    const midRoll = { frac: jest.fn(() => 0.56) } as any;

    const temperate = generator.pickAsset(0, 0, 'LOWLAND', 0, 'temperate', midRoll);
    const arid = generator.pickAsset(0, 0, 'LOWLAND', 0, 'arid', midRoll);

    expect(temperate?.type).toBe('tree_birch');
    expect(arid?.type).toBe('terrain_mound');
  });
});
