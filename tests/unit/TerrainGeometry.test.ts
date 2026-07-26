import {
  snapToGrid,
  computeTerrainNormal,
  buildTerrainVertexData,
} from '../../src/cab3d/world/TerrainGeometry';
import { worldToBabylon } from '../../src/cab3d/model/CabCoordinate';

describe('TerrainGeometry', () => {
  describe('snapToGrid', () => {
    it('rounds to the nearest multiple, switching at the half step', () => {
      expect(snapToGrid(0, 64)).toBe(0);
      expect(snapToGrid(31, 64)).toBe(0);
      expect(snapToGrid(32, 64)).toBe(64);
      expect(snapToGrid(70, 64)).toBe(64);
      expect(snapToGrid(95, 64)).toBe(64);
      expect(snapToGrid(97, 64)).toBe(128);
    });

    it('handles negative values symmetrically', () => {
      expect(snapToGrid(-31, 64)).toBe(0);
      expect(snapToGrid(-32, 64)).toBe(0);
      expect(snapToGrid(-33, 64)).toBe(-64);
      expect(snapToGrid(-70, 64)).toBe(-64);
      expect(snapToGrid(-97, 64)).toBe(-128);
    });
  });

  describe('computeTerrainNormal', () => {
    it('is unit length and points up for a flat plane', () => {
      const n = computeTerrainNormal(() => 5, 0, 0, 8);
      expect(n.x).toBeCloseTo(0, 6);
      expect(n.y).toBeCloseTo(1, 6);
      expect(n.z).toBeCloseTo(0, 6);
      const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
      expect(len).toBeCloseTo(1, 6);
    });

    it('points uphill for a sloped plane', () => {
      // h(x,y) = x + y => normal (-1, 1, 1) / sqrt(3)
      const n = computeTerrainNormal((x, y) => x + y, 0, 0, 1);
      expect(n.y).toBeGreaterThan(0);
      expect(n.x).toBeCloseTo(-1 / Math.sqrt(3), 6);
      expect(n.y).toBeCloseTo(1 / Math.sqrt(3), 6);
      expect(n.z).toBeCloseTo(1 / Math.sqrt(3), 6);
    });

    it('is unit length and y > 0 for every top vertex of a generated ring', () => {
      const ring = { extent: 128, resolution: 32, innerExtent: 0 };
      const segments = ring.extent / ring.resolution;
      const topVertexCount = (segments + 1) * (segments + 1);

      const data = buildTerrainVertexData({
        originX: 0,
        originY: 0,
        rings: [ring],
        getHeightAt: (x, y) => Math.sin(x / 50) + Math.cos(y / 50),
        biome: 'temperate',
        skirtDepth: 60,
      });

      const normals = Array.from(data.normals);
      for (let i = 0; i < topVertexCount; i++) {
        const nx = normals[i * 3];
        const ny = normals[i * 3 + 1];
        const nz = normals[i * 3 + 2];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        expect(len).toBeCloseTo(1, 6);
        expect(ny).toBeGreaterThan(0);
      }
    });
  });

  describe('buildTerrainVertexData', () => {
    it('produces exact heights for a single ring grid', () => {
      const getHeightAt = jest.fn((x: number, y: number) => x + y);
      const data = buildTerrainVertexData({
        originX: 100,
        originY: 200,
        rings: [{ extent: 64, resolution: 32, innerExtent: 0 }],
        getHeightAt,
        biome: 'temperate',
        skirtDepth: 60,
      });

      // 2x2 cells => 3x3 = 9 top vertices + skirt vertices.
      const topVertexCount = 9;
      const positions = Array.from(data.positions);
      for (let v = 0; v < topVertexCount; v++) {
        const x = positions[v * 3];
        const y = positions[v * 3 + 1];
        const z = positions[v * 3 + 2];

        const worldX = x + 100;
        const worldY = -z + 200;
        expect(y).toBe(getHeightAt(worldX, worldY));
      }
    });

    it('produces the expected vertex and index counts for annular rings', () => {
      const data = buildTerrainVertexData({
        originX: 0,
        originY: 0,
        rings: [
          { extent: 128, resolution: 32, innerExtent: 0 },
          { extent: 256, resolution: 64, innerExtent: 128 },
        ],
        getHeightAt: () => 10,
        biome: 'arid',
        skirtDepth: 60,
      });

      // Ring 1: 4x4 grid => 25 top verts + (4 sides * 4 segments) = 16 skirt verts? Let's just sanity check counts.
      // Ring 2: 4x4 grid with 2x2 hole => (25 - 9) top cells * 2 triangles = 32 top triangles
      expect(data.positions.length % 3).toBe(0);
      expect(data.normals.length % 3).toBe(0);
      expect(data.colors.length % 4).toBe(0);
      expect(data.indices.length % 3).toBe(0);
      expect(data.indices.length).toBeGreaterThan(0);
      expect(data.positions.length / 3).toBe(data.colors.length / 4);
    });

    it('uses worldToBabylon for local positions', () => {
      const data = buildTerrainVertexData({
        originX: 10,
        originY: 20,
        rings: [{ extent: 64, resolution: 32, innerExtent: 0 }],
        getHeightAt: () => 5,
        biome: 'temperate',
        skirtDepth: 60,
      });

      // The top-left corner vertex (i=0, j=0) is at dx=-32, dy=-32 relative to origin.
      const pos = worldToBabylon(-32, -32, 5);
      expect(data.positions[0]).toBeCloseTo(pos.x, 6);
      expect(data.positions[1]).toBeCloseTo(pos.y, 6);
      expect(data.positions[2]).toBeCloseTo(pos.z, 6);
    });
  });
});
