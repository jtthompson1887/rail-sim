import { TerrainChunkManager } from '../../src/systems/TerrainChunkManager';
import { GameConfig } from '../../src/config/GameConfig';
import { makeScene } from '../../__mocks__/phaser';

const CHUNK = GameConfig.WORLD.CHUNK_SIZE; // 4096
const { WIDTH, HEIGHT } = GameConfig.RESOLUTION; // 1920 x 1080

/** Flat terrain stub – never throws. */
const flatTerrain = {
  getHeightAt: () => 50,
  getBandAt:   () => 'LOWLAND',
  slopeAt:     () => 0,
} as any;

function makeManager() {
  const scene = makeScene() as any;
  scene.add.existing = jest.fn();
  return new TerrainChunkManager(scene, flatTerrain, 'temperate');
}

function expectedChunkCountForZoom(zoom: number): number {
  const safeZoom = Math.max(
    GameConfig.CAMERA.MIN_ZOOM,
    Math.min(GameConfig.CAMERA.MAX_ZOOM, Number.isFinite(zoom) ? zoom : 1),
  );
  const neededX = Math.ceil(((WIDTH / safeZoom) / 2) / CHUNK) + 1;
  const neededY = Math.ceil(((HEIGHT / safeZoom) / 2) / CHUNK) + 1;
  const radius = Math.max(2, neededX, neededY);
  return (radius * 2 + 1) ** 2;
}

describe('TerrainChunkManager', () => {
  describe('chunk loading at zoom=1 (default)', () => {
    it('loads at least 1 chunk at the camera centre', () => {
      const mgr = makeManager();
      mgr.update(0, 0, 1);
      expect(mgr.activeChunkCount).toBeGreaterThanOrEqual(1);
    });

    it('loads a 5×5 grid (MIN_RADIUS=2) by default at zoom=1', () => {
      const mgr = makeManager();
      mgr.update(0, 0, 1);
      // At zoom=1 visible half-width = 1920/2 = 960 < CHUNK → neededX = ceil(960/4096)+1 = 1
      // MIN_RADIUS=2 dominates → 5×5 = 25 chunks
      expect(mgr.activeChunkCount).toBe(25);
    });
  });

  describe('chunk loading at reduced zoom (zoomed out)', () => {
    it('loads more chunks when zoomed out to 0.5', () => {
      const mgrDefault = makeManager();
      mgrDefault.update(0, 0, 1);
      const countAt1 = mgrDefault.activeChunkCount;

      const mgrZoomed = makeManager();
      mgrZoomed.update(0, 0, 0.5);
      const countAt05 = mgrZoomed.activeChunkCount;

      expect(countAt05).toBeGreaterThanOrEqual(countAt1);
    });

    it('covers the full viewport at min zoom (0.1) with no gaps', () => {
      const mgr = makeManager();
      mgr.update(0, 0, 0.1);

      // At zoom=0.1: visible half-width = (1920/0.1)/2 = 9600
      // neededX = ceil(9600/4096)+1 = 3+1 = 4  → r=4
      // 9×9 = 81 chunks
      const halfVisW = (WIDTH  / 0.1) / 2;  // 9600
      const halfVisH = (HEIGHT / 0.1) / 2;  // 5400
      const neededX  = Math.ceil(halfVisW / CHUNK) + 1;  // 3+1=4
      const neededY  = Math.ceil(halfVisH / CHUNK) + 1;  // 2+1=3
      const r = Math.max(2, neededX, neededY);           // 4
      const expected = (2 * r + 1) ** 2;                 // 81

      expect(mgr.activeChunkCount).toBe(expected);
    });

    it('covers the viewport fully – left edge chunk is loaded', () => {
      // Camera centre at world origin, zoom=0.1.
      // Left visible edge = 0 - halfVisW = -9600
      // Leftmost visible chunk index = floor(-9600 / 4096) = -3
      // Manager must load chunk cx=-3 (and beyond)
      const mgr = makeManager();
      mgr.update(0, 0, 0.1);

      // 5×5 (radius=2) would only load cx ∈ [-2,+2]. At zoom=0.1 we need cx=-3.
      // Verify by checking count; 25 would imply radius=2 (insufficient), 81 implies radius=4.
      expect(mgr.activeChunkCount).toBeGreaterThan(25);
    });

    it('scales radius smoothly as zoom decreases', () => {
      const zooms = [1.0, 0.5, 0.2, 0.1];
      const counts: number[] = [];

      for (const zoom of zooms) {
        const mgr = makeManager();
        mgr.update(0, 0, zoom);
        counts.push(mgr.activeChunkCount);
      }

      // Chunk count must be non-decreasing as zoom decreases (viewport grows)
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
      }
    });
  });

  describe('chunk unloading', () => {
    it('destroys chunks that scroll out of the view radius', () => {
      const mgr = makeManager();
      mgr.update(0, 0, 1);
      const initialCount = mgr.activeChunkCount;

      // Move camera far away so the initial chunks are no longer needed
      mgr.update(CHUNK * 100, CHUNK * 100, 1);

      expect(mgr.activeChunkCount).toBe(initialCount);  // same count, different chunks
    });

    it('destroyAll clears all chunks', () => {
      const mgr = makeManager();
      mgr.update(0, 0, 1);
      expect(mgr.activeChunkCount).toBeGreaterThan(0);
      mgr.destroyAll();
      expect(mgr.activeChunkCount).toBe(0);
    });
  });

  describe('chunk caching', () => {
    it('does not recreate chunks that are still in view', () => {
      const mgr = makeManager();
      mgr.update(0, 0, 1);
      const count1 = mgr.activeChunkCount;
      // Tiny camera movement – still within same chunk neighbourhood
      mgr.update(10, 10, 1);
      const count2 = mgr.activeChunkCount;
      expect(count2).toBe(count1);
    });
  });

  describe('zoom validation (defensive)', () => {
    it('does not crash with zoom = 0 (division by zero protection)', () => {
      const mgr = makeManager();
      // Should clamp to MIN_ZOOM (0.1) rather than throwing
      expect(() => mgr.update(0, 0, 0)).not.toThrow();
      expect(mgr.activeChunkCount).toBe(expectedChunkCountForZoom(0));
    });

    it('does not crash with zoom = NaN', () => {
      const mgr = makeManager();
      expect(() => mgr.update(0, 0, NaN)).not.toThrow();
      expect(mgr.activeChunkCount).toBe(expectedChunkCountForZoom(NaN));
    });

    it('does not crash with negative zoom', () => {
      const mgr = makeManager();
      expect(() => mgr.update(0, 0, -0.5)).not.toThrow();
      expect(mgr.activeChunkCount).toBe(expectedChunkCountForZoom(-0.5));
    });

    it('does not crash with extremely large zoom', () => {
      const mgr = makeManager();
      expect(() => mgr.update(0, 0, 999)).not.toThrow();
      // At huge zoom, only MIN_RADIUS chunks are needed
      expect(mgr.activeChunkCount).toBe(expectedChunkCountForZoom(999));
    });
  });
});
