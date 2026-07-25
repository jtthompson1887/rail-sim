import { TerrainChunk } from '../../src/entities/TerrainChunk';
import { GameConfig } from '../../src/config/GameConfig';
import { makeScene as createMockScene } from '../../__mocks__/phaser';
import Phaser from 'phaser';

const TC    = GameConfig.TERRAIN;
const HALF_W = TC.WORLD_WIDTH  / 2;   // 8192
const HALF_H = TC.WORLD_HEIGHT / 2;   // 8192
const STEP   = TC.SAMPLE_STEP;        // 128
const CHUNK  = GameConfig.WORLD.CHUNK_SIZE; // 4096

/** Flat LOWLAND terrain generator stub. */
const flatTerrain = {
  getHeightAt: (_x: number, _y: number) => 50,    // LOWLAND
  getBandAt:   (_x: number, _y: number) => 'LOWLAND',
  slopeAt:     (_x: number, _y: number) => 0,
} as any;

/** Stub whose heightmap returns the same regardless of coords. */
function makeScene() {
  const scene = createMockScene() as any;
  // Track fillStyle calls so we can inspect rendered colours
  const fillStyleCalls: Array<[number, number]> = [];
  scene.add.existing = jest.fn();
  // We need to override fillStyle on the Graphics object the chunk will use.
  // TerrainChunk extends Graphics directly, so we spy on its prototype.
  return { scene, fillStyleCalls };
}

describe('TerrainChunk', () => {
  describe('in-bounds chunk (world centre)', () => {
    it('constructs without throwing', () => {
      const { scene } = makeScene();
      expect(() => new TerrainChunk(scene, 0, 0, flatTerrain, 'temperate')).not.toThrow();
    });

    it('has correct originX / originY', () => {
      const { scene } = makeScene();
      const chunk = new TerrainChunk(scene, 256, -512, flatTerrain, 'temperate');
      expect(chunk.originX).toBe(256);
      expect(chunk.originY).toBe(-512);
    });
  });

  describe('out-of-bounds chunk (beyond world edge)', () => {
    it('constructs without throwing for a chunk entirely outside world bounds (right edge)', () => {
      const { scene } = makeScene();
      // chunkX = HALF_W + CHUNK: every wx >= HALF_W
      expect(() => new TerrainChunk(scene, HALF_W + CHUNK, 0, flatTerrain, 'temperate')).not.toThrow();
    });

    it('constructs without throwing for a chunk entirely outside world bounds (left edge)', () => {
      const { scene } = makeScene();
      expect(() => new TerrainChunk(scene, -HALF_W - CHUNK * 2, 0, flatTerrain, 'temperate')).not.toThrow();
    });

    it('constructs without throwing for a chunk entirely outside world bounds (bottom edge)', () => {
      const { scene } = makeScene();
      expect(() => new TerrainChunk(scene, 0, HALF_H + CHUNK, flatTerrain, 'temperate')).not.toThrow();
    });

    it('constructs without throwing for a chunk entirely outside world bounds (top edge)', () => {
      const { scene } = makeScene();
      expect(() => new TerrainChunk(scene, 0, -HALF_H - CHUNK * 2, flatTerrain, 'temperate')).not.toThrow();
    });

    it('constructs without throwing for a chunk at the far corner of the world', () => {
      const { scene } = makeScene();
      expect(() => new TerrainChunk(scene, HALF_W * 3, HALF_H * 3, flatTerrain, 'temperate')).not.toThrow();
    });
  });

  describe('boundary chunk (straddles world edge)', () => {
    it('constructs without throwing when chunk partially overlaps the world', () => {
      const { scene } = makeScene();
      // chunkX = HALF_W - STEP: first few cells are in-bounds, rest are out
      expect(() => new TerrainChunk(scene, HALF_W - STEP, 0, flatTerrain, 'temperate')).not.toThrow();
    });

    it('constructs without throwing when chunk partially overlaps the world on the Y axis', () => {
      const { scene } = makeScene();
      expect(() => new TerrainChunk(scene, 0, HALF_H - STEP, flatTerrain, 'temperate')).not.toThrow();
    });
  });

  describe('fillStyle call inspection', () => {
    it('renders a fully out-of-bounds chunk only as deep ocean with no overlays', () => {
      const fillStyle = jest.spyOn(Phaser.GameObjects.Graphics.prototype, 'fillStyle');
      const strokeRect = jest.spyOn(Phaser.GameObjects.Graphics.prototype, 'strokeRect');
      const terrain = {
        getHeightAt: jest.fn(),
        getBandAt: jest.fn(),
        slopeAt: jest.fn(),
      } as any;

      const { scene } = makeScene();
      new TerrainChunk(scene, HALF_W + CHUNK, 0, terrain, 'temperate');

      expect(fillStyle).toHaveBeenCalled();
      expect(fillStyle.mock.calls.every(([colour, alpha]) =>
        colour === 0x153d5f && alpha === 1,
      )).toBe(true);
      expect(fillStyle).not.toHaveBeenCalledWith(0x2a6aaa, 0.25);
      expect(strokeRect).not.toHaveBeenCalled();
      expect(terrain.getHeightAt).not.toHaveBeenCalled();
      expect(terrain.slopeAt).not.toHaveBeenCalled();

      fillStyle.mockRestore();
      strokeRect.mockRestore();
    });

    it('does NOT call getHeightAt for quads that are out of bounds', () => {
      // A terrain whose getHeightAt would throw if called for OOB coords gives us
      // hard proof that OOB quads bypass heightmap sampling.
      const strictTerrain = {
        getHeightAt: (x: number, y: number) => {
          if (x < -HALF_W || x >= HALF_W || y < -HALF_H || y >= HALF_H) {
            throw new Error(`getHeightAt called with OOB coords (${x}, ${y})`);
          }
          return 50;
        },
        getBandAt: () => 'LOWLAND',
        slopeAt: (x: number, y: number) => {
          if (x < -HALF_W || x >= HALF_W || y < -HALF_H || y >= HALF_H) {
            throw new Error(`slopeAt called with OOB coords (${x}, ${y})`);
          }
          return 0;
        },
      } as any;

      const { scene } = makeScene();

      // Chunk entirely beyond the right edge: all wx >= HALF_W
      expect(() =>
        new TerrainChunk(scene, HALF_W + CHUNK, 0, strictTerrain, 'temperate'),
      ).not.toThrow();
    });

    it('does NOT call getHeightAt for quads out of bounds on the left edge', () => {
      const strictTerrain = {
        getHeightAt: (x: number, y: number) => {
          if (x < -HALF_W || x >= HALF_W || y < -HALF_H || y >= HALF_H) {
            throw new Error(`OOB: (${x}, ${y})`);
          }
          return 50;
        },
        getBandAt: () => 'LOWLAND',
        slopeAt: (x: number, y: number) => {
          if (x < -HALF_W || x >= HALF_W || y < -HALF_H || y >= HALF_H) {
            throw new Error(`OOB slope: (${x}, ${y})`);
          }
          return 0;
        },
      } as any;

      const { scene } = makeScene();
      expect(() =>
        new TerrainChunk(scene, -HALF_W - CHUNK * 2, 0, strictTerrain, 'temperate'),
      ).not.toThrow();
    });

    it('does NOT call getHeightAt for quads out of bounds on the bottom edge', () => {
      const strictTerrain = {
        getHeightAt: (x: number, y: number) => {
          if (x < -HALF_W || x >= HALF_W || y < -HALF_H || y >= HALF_H) {
            throw new Error(`OOB: (${x}, ${y})`);
          }
          return 50;
        },
        getBandAt: () => 'LOWLAND',
        slopeAt: (x: number, y: number) => {
          if (x < -HALF_W || x >= HALF_W || y < -HALF_H || y >= HALF_H) {
            throw new Error(`OOB slope: (${x}, ${y})`);
          }
          return 0;
        },
      } as any;

      const { scene } = makeScene();
      expect(() =>
        new TerrainChunk(scene, 0, HALF_H + CHUNK, strictTerrain, 'temperate'),
      ).not.toThrow();
    });
  });
});
