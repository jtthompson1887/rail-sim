import { worldToBabylon } from '../model/CabCoordinate';
import { getTerrainColourRgb } from './TerrainColour';
import type { BiomeType } from '../../config/WorldData';

/** Single LOD ring definition. */
export interface TerrainBuildRing {
  /** Outer square extent in metres. */
  readonly extent: number;
  /** Grid spacing in metres. */
  readonly resolution: number;
  /** Inner square hole extent in metres (0 for the innermost ring). */
  readonly innerExtent: number;
}

/** Options for {@link buildTerrainVertexData}. */
export interface TerrainBuildOptions {
  /** World X coordinate of the ring centre. */
  readonly originX: number;
  /** World Y coordinate of the ring centre. */
  readonly originY: number;
  /** Ordered LOD rings, innermost first. */
  readonly rings: ReadonlyArray<TerrainBuildRing>;
  /** Height sampler. */
  readonly getHeightAt: (worldX: number, worldY: number) => number;
  /** Current biome for vertex colours. */
  readonly biome: BiomeType;
  /** How far the outer skirt drops below the terrain surface. */
  readonly skirtDepth: number;
}

/** Vertex data produced for a Babylon mesh. */
export interface TerrainVertexData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
}

/** Snap a value to the nearest multiple of step, switching at the half step. */
export function snapToGrid(value: number, step: number): number {
  return Math.floor(value / step + 0.5) * step;
}

/**
 * Compute a terrain normal at a world position using central differences.
 * The returned normal is unit length and has a positive Y component.
 */
export function computeTerrainNormal(
  getHeightAt: (x: number, y: number) => number,
  worldX: number,
  worldY: number,
  step: number,
): { x: number; y: number; z: number } {
  const dX =
    (getHeightAt(worldX + step, worldY) - getHeightAt(worldX - step, worldY)) /
    (2 * step);
  const dY =
    (getHeightAt(worldX, worldY + step) - getHeightAt(worldX, worldY - step)) /
    (2 * step);

  // Surface y = f(x, -z) => upward normal (-df/dx, 1, df/dy)
  let nx = -dX;
  let ny = 1;
  let nz = dY;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len > 0) {
    nx /= len;
    ny /= len;
    nz /= len;
  }

  return { x: nx, y: ny, z: nz };
}

/**
 * Build the combined vertex data for all LOD rings around the supplied origin.
 *
 * Each ring is a square grid with a centred square hole (except the innermost
 * ring). A 60 m skirt is generated around the outer edge of every ring.
 */
export function buildTerrainVertexData(
  options: TerrainBuildOptions,
): TerrainVertexData {
  const { originX, originY, rings, getHeightAt, biome, skirtDepth } = options;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  let vertexOffset = 0;

  for (const ring of rings) {
    const segments = Math.round(ring.extent / ring.resolution);
    const half = segments / 2;
    const innerSegments = Math.round(ring.innerExtent / ring.resolution);
    const innerStart = innerSegments > 0 ? (segments - innerSegments) / 2 : 0;
    const innerEnd = innerStart + innerSegments - 1;
    const gridVerts = (segments + 1) * (segments + 1);

    const getTopIdx = (i: number, j: number): number =>
      j * (segments + 1) + i;

    // Top-surface vertices
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i <= segments; i++) {
        const dx = (i - half) * ring.resolution;
        const dy = (j - half) * ring.resolution;
        const worldX = originX + dx;
        const worldY = originY + dy;
        const h = getHeightAt(worldX, worldY);

        const pos = worldToBabylon(dx, dy, h);
        positions.push(pos.x, pos.y, pos.z);

        const n = computeTerrainNormal(getHeightAt, worldX, worldY, ring.resolution);
        normals.push(n.x, n.y, n.z);

        const col = getTerrainColourRgb(h, biome);
        colors.push(col.r, col.g, col.b, 1);
      }
    }

    // Top-surface indices, skipping the inner hole
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        if (
          innerSegments > 0 &&
          i >= innerStart &&
          i <= innerEnd &&
          j >= innerStart &&
          j <= innerEnd
        ) {
          continue;
        }

        const a = vertexOffset + getTopIdx(i, j);
        const b = vertexOffset + getTopIdx(i + 1, j);
        const c = vertexOffset + getTopIdx(i, j + 1);
        const d = vertexOffset + getTopIdx(i + 1, j + 1);

        indices.push(a, b, d, a, d, c);
      }
    }

    // Skirt vertices and indices around the outer edge
    const skirtMap = new Int32Array(gridVerts).fill(-1);
    const skirtPositions: number[] = [];
    const skirtColors: number[] = [];
    const skirtNormalsAcc: { x: number; y: number; z: number }[] = [];

    const getOrCreateSkirt = (
      topIdx: number,
      normal: { x: number; y: number; z: number },
    ): number => {
      if (skirtMap[topIdx] === -1) {
        skirtMap[topIdx] = skirtNormalsAcc.length;
        const baseX = positions[(vertexOffset + topIdx) * 3];
        const baseY = positions[(vertexOffset + topIdx) * 3 + 1];
        const baseZ = positions[(vertexOffset + topIdx) * 3 + 2];
        skirtPositions.push(baseX, baseY - skirtDepth, baseZ);
        skirtColors.push(
          colors[(vertexOffset + topIdx) * 4],
          colors[(vertexOffset + topIdx) * 4 + 1],
          colors[(vertexOffset + topIdx) * 4 + 2],
          1,
        );
        skirtNormalsAcc.push({ x: 0, y: 0, z: 0 });
      }

      const idx = skirtMap[topIdx];
      skirtNormalsAcc[idx].x += normal.x;
      skirtNormalsAcc[idx].y += normal.y;
      skirtNormalsAcc[idx].z += normal.z;
      return idx;
    };

    const addSide = (verts: Array<[number, number]>): void => {
      for (let k = 0; k < verts.length - 1; k++) {
        const [i0, j0] = verts[k];
        const [i1, j1] = verts[k + 1];

        let n: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
        if (j0 === 0 && j1 === 0) {
          // Bottom edge (positive Z in world), inward is -Z
          n = { x: 0, y: 0, z: -1 };
        } else if (j0 === segments && j1 === segments) {
          // Top edge (negative Z in world), inward is +Z
          n = { x: 0, y: 0, z: 1 };
        } else if (i0 === 0 && i1 === 0) {
          // Left edge, inward is +X
          n = { x: 1, y: 0, z: 0 };
        } else if (i0 === segments && i1 === segments) {
          // Right edge, inward is -X
          n = { x: -1, y: 0, z: 0 };
        }

        const v0 = getTopIdx(i0, j0);
        const v1 = getTopIdx(i1, j1);
        const s0 = getOrCreateSkirt(v0, n);
        const s1 = getOrCreateSkirt(v1, n);

        const a = vertexOffset + v0;
        const b = vertexOffset + v1;
        const sa = vertexOffset + gridVerts + s0;
        const sb = vertexOffset + gridVerts + s1;

        indices.push(a, b, sb, a, sb, sa);
      }
    };

    const sideVerts: Array<[number, number][]> = [
      Array.from({ length: segments + 1 }, (_, i) => [i, 0] as [number, number]),
      Array.from({ length: segments + 1 }, (_, j) => [segments, j] as [number, number]),
      Array.from({ length: segments + 1 }, (_, k) => [segments - k, segments] as [number, number]),
      Array.from({ length: segments + 1 }, (_, k) => [0, segments - k] as [number, number]),
    ];

    for (const side of sideVerts) {
      addSide(side);
    }

    // Append skirt vertices with averaged normals
    for (let s = 0; s < skirtNormalsAcc.length; s++) {
      const n = skirtNormalsAcc[s];
      const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
      if (len > 0) {
        n.x /= len;
        n.y /= len;
        n.z /= len;
      }

      positions.push(skirtPositions[s * 3], skirtPositions[s * 3 + 1], skirtPositions[s * 3 + 2]);
      normals.push(n.x, n.y, n.z);
      colors.push(skirtColors[s * 4], skirtColors[s * 4 + 1], skirtColors[s * 4 + 2], 1);
    }

    vertexOffset += gridVerts + skirtNormalsAcc.length;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
