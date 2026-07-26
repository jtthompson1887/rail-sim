import { TerrainChunk } from '../../src/entities/TerrainChunk';
import { GameConfig } from '../../src/config/GameConfig';

const { makeScene } = require('../../__mocks__/phaser');
import type { BiomeType } from '../../src/config/WorldData';
import {
  getTerrainColour,
  getTerrainColourRgb,
} from '../../src/cab3d/world/TerrainColour';

const TC = GameConfig.TERRAIN;
const HALF_W = TC.WORLD_WIDTH / 2;
const CHUNK = GameConfig.WORLD.CHUNK_SIZE;
const BIOMES: BiomeType[] = ['temperate', 'alpine', 'arid', 'tropical'];

describe('TerrainColour', () => {
  it('matches TerrainChunk private bandColor for 200 heights × 4 biomes', () => {
    const scene = makeScene();
    // Place the chunk fully out of bounds so render() short-circuits.
    const chunk = new TerrainChunk(
      scene,
      HALF_W + CHUNK,
      0,
      {
        getHeightAt: () => 0,
        getBandAt: () => 'LOWLAND',
        slopeAt: () => 0,
      } as any,
      'temperate',
    ) as any;

    const heights = Array.from({ length: 200 }, (_, i) => -80 + i * 3.5);

    for (const biome of BIOMES) {
      for (const h of heights) {
        expect(getTerrainColour(h, biome)).toBe(chunk.bandColor(h, biome));
      }
    }
  });

  it('returns the expected base band colour for each biome', () => {
    expect(getTerrainColour(-50, 'temperate')).toBe(0x1e4d7a);
    expect(getTerrainColour(50, 'temperate')).toBe(0x3a6e2e);
    expect(getTerrainColour(160, 'temperate')).toBe(0x5a7a3a);
    expect(getTerrainColour(280, 'temperate')).toBe(0x7a6a50);
    expect(getTerrainColour(400, 'temperate')).toBe(0xd0cfc8);

    expect(getTerrainColour(50, 'alpine')).toBe(0x2a5a38);
    expect(getTerrainColour(400, 'arid')).toBe(0xb09080);
    expect(getTerrainColour(50, 'tropical')).toBe(0x2a8a2a);
  });

  it('returns normalised RGB components', () => {
    const c = getTerrainColourRgb(50, 'temperate');
    expect(c.r).toBeCloseTo(0.227, 2);
    expect(c.g).toBeCloseTo(0.431, 2);
    expect(c.b).toBeCloseTo(0.18, 2);
    expect(c.r).toBeGreaterThanOrEqual(0);
    expect(c.r).toBeLessThanOrEqual(1);
  });
});
