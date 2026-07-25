import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { GameConfig } from '../../src/config/GameConfig';

const TC = GameConfig.TERRAIN;

/**
 * Unit tests for TerrainGenerator.
 */
describe('TerrainGenerator', () => {
  let generator: TerrainGenerator;

  beforeEach(() => {
    generator = new TerrainGenerator('test-seed');
  });

  describe('getHeightAt', () => {
    it('returns a height for a point inside the world bounds', () => {
      const h = generator.getHeightAt(0, 0);
      expect(typeof h).toBe('number');
      expect(Number.isFinite(h)).toBe(true);
    });

    it('returns the same height for points beyond the right edge (clamp-to-edge)', () => {
      const edgeX = TC.WORLD_WIDTH / 2;   // 8192
      const beyondX = edgeX + TC.SAMPLE_STEP * 4; // well outside
      const y = 0;

      const edgeH = generator.getHeightAt(edgeX, y);
      const beyondH = generator.getHeightAt(beyondX, y);

      expect(beyondH).toBe(edgeH);
    });

    it('returns the same height for points beyond the left edge (clamp-to-edge)', () => {
      const edgeX = -TC.WORLD_WIDTH / 2; // -8192
      const beyondX = edgeX - TC.SAMPLE_STEP * 4;
      const y = 0;

      const edgeH = generator.getHeightAt(edgeX, y);
      const beyondH = generator.getHeightAt(beyondX, y);

      expect(beyondH).toBe(edgeH);
    });

    it('returns the same height for points beyond the top edge (clamp-to-edge)', () => {
      const edgeY = TC.WORLD_HEIGHT / 2; // 8192
      const beyondY = edgeY + TC.SAMPLE_STEP * 4;
      const x = 0;

      const edgeH = generator.getHeightAt(x, edgeY);
      const beyondH = generator.getHeightAt(x, beyondY);

      expect(beyondH).toBe(edgeH);
    });

    it('returns the same height for points beyond the bottom edge (clamp-to-edge)', () => {
      const edgeY = -TC.WORLD_HEIGHT / 2; // -8192
      const beyondY = edgeY - TC.SAMPLE_STEP * 4;
      const x = 0;

      const edgeH = generator.getHeightAt(x, edgeY);
      const beyondH = generator.getHeightAt(x, beyondY);

      expect(beyondH).toBe(edgeH);
    });

    it('returns the same height for the far corner beyond the world', () => {
      const edgeH = generator.getHeightAt(
        TC.WORLD_WIDTH / 2,
        TC.WORLD_HEIGHT / 2,
      );
      const beyondH = generator.getHeightAt(
        TC.WORLD_WIDTH * 2,
        TC.WORLD_HEIGHT * 2,
      );

      expect(beyondH).toBe(edgeH);
    });

    it('does not produce runaway extrapolation beyond the edge', () => {
      const edgeX = TC.WORLD_WIDTH / 2;
      const y = 0;
      const edgeH = generator.getHeightAt(edgeX, y);
      const nearH = generator.getHeightAt(edgeX + TC.SAMPLE_STEP, y);

      // Without clamping, nearH would extrapolate linearly and differ from edgeH.
      // With clamping it must equal the edge value.
      expect(nearH).toBe(edgeH);
    });
  });

  describe('slopeAt', () => {
    it('returns a finite slope inside the world', () => {
      const slope = generator.slopeAt(0, 0);
      expect(Number.isFinite(slope)).toBe(true);
      expect(slope).toBeGreaterThanOrEqual(0);
    });

    it('returns a finite slope at the world edge', () => {
      const edgeX = TC.WORLD_WIDTH / 2;
      const slope = generator.slopeAt(edgeX, 0);
      expect(Number.isFinite(slope)).toBe(true);
    });
  });

  describe('getTerrainBand', () => {
    it('classifies water correctly', () => {
      expect(generator.getTerrainBand(-100)).toBe('WATER');
      expect(generator.getTerrainBand(TC.BANDS.WATER.max - 1)).toBe('WATER');
    });

    it('classifies peak correctly', () => {
      expect(generator.getTerrainBand(TC.BANDS.HIGHLAND.max + 1)).toBe('PEAK');
      expect(generator.getTerrainBand(10000)).toBe('PEAK');
    });
  });

  describe('getBandAt', () => {
    it('returns a valid band for any world coordinate', () => {
      const band = generator.getBandAt(0, 0);
      expect(['WATER', 'LOWLAND', 'MIDLAND', 'HIGHLAND', 'PEAK']).toContain(band);
    });

    it('returns a valid band beyond world edges', () => {
      const band = generator.getBandAt(TC.WORLD_WIDTH * 2, TC.WORLD_HEIGHT * 2);
      expect(['WATER', 'LOWLAND', 'MIDLAND', 'HIGHLAND', 'PEAK']).toContain(band);
    });
  });

  describe('getHeightAtGrid', () => {
    it('returns the heightmap value at valid grid indices', () => {
      const h = generator.getHeightAtGrid(0, 0);
      expect(Number.isFinite(h)).toBe(true);
    });

    it('clamps to the edge for negative indices', () => {
      const hNeg = generator.getHeightAtGrid(-10, -10);
      const hEdge = generator.getHeightAtGrid(0, 0);
      expect(hNeg).toBe(hEdge);
    });

    it('clamps to the edge for oversized indices', () => {
      const maxXi = generator.samplesX - 1;
      const maxYi = generator.samplesY - 1;
      const hOver = generator.getHeightAtGrid(maxXi + 10, maxYi + 10);
      const hEdge = generator.getHeightAtGrid(maxXi, maxYi);
      expect(hOver).toBe(hEdge);
    });
  });
});
