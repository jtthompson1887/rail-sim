import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { SCENERY_ASSETS, effectiveWeight } from '../config/SceneryConfig';
import type { TerrainGenerator } from './TerrainGenerator';
import type { SceneryObjectDef, SceneryType, BiomeType } from '../config/WorldData';

const TC = GameConfig.TERRAIN;
const CHUNK = GameConfig.WORLD.CHUNK_SIZE;

/**
 * SceneryGenerator
 *
 * Produces seeded, deterministic scenery placements for a given world chunk
 * using a Poisson-disk sampling algorithm with cluster-bias noise.
 *
 * Algorithm:
 *  1. Bridson's Poisson-disk sampling produces candidate positions with a
 *     guaranteed minimum separation, preventing grid-like clustering.
 *  2. For each candidate the terrain band and slope are queried to filter out
 *     unsuitable assets and select the most appropriate type.
 *  3. Per-asset rotation, scale, and variant are hashed from position so
 *     identical results are produced for the same seed + chunk every time.
 */
export class SceneryGenerator {
  private readonly terrain: TerrainGenerator;

  constructor(terrain: TerrainGenerator) {
    this.terrain = terrain;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Generate scenery definitions for the chunk whose top-left corner is at
   * (chunkX, chunkY) in world coordinates.
   * The result is deterministic for a fixed seed + biome + chunk position.
   */
  generateForChunk(
    chunkX: number,
    chunkY: number,
    seed: string,
    biome: BiomeType,
  ): SceneryObjectDef[] {
    // Seed includes chunk coordinates so adjacent chunks are independent
    const chunkSeed = `${seed}:${chunkX}:${chunkY}`;
    const rng = new Phaser.Math.RandomDataGenerator([chunkSeed]);

    const candidates = this.poissonDisk(chunkX, chunkY, rng);
    const defs: SceneryObjectDef[] = [];

    for (const { x, y } of candidates) {
      if (rng.frac() > TC.SCENERY_DENSITY) continue;

      const band  = this.terrain.getBandAt(x, y);
      const slope = this.terrain.slopeAt(x, y);

      const assetDef = this.pickAsset(x, y, band, slope, biome, rng);
      if (!assetDef) continue;

      // Stable rotation / scale / variant hashed from position
      const rotation = assetDef.freeRotation
        ? (this.posHash(x, y, 1) / 0xffff) * Math.PI * 2
        : (this.posHash(x, y, 1) / 0xffff - 0.5) * (15 * Math.PI / 180) * 2;

      const scale = assetDef.minScale
        + (this.posHash(x, y, 2) / 0xffff) * (assetDef.maxScale - assetDef.minScale);

      const variant = Math.floor(
        (this.posHash(x, y, 3) / 0xffff) * assetDef.variantCount,
      );

      defs.push({
        id: `${chunkX}_${chunkY}_${Math.floor(x)}_${Math.floor(y)}`,
        type: assetDef.type,
        x,
        y,
        rotation,
        scale,
        variant,
      });
    }

    return defs;
  }

  // ── Poisson-disk sampling (Bridson's algorithm) ────────────────────────────

  /**
   * Generate candidate positions within a chunk using Bridson's algorithm.
   * Returns only the positions; terrain/asset filtering happens afterwards.
   */
  poissonDisk(
    chunkOriginX: number,
    chunkOriginY: number,
    rng: Phaser.Math.RandomDataGenerator,
  ): Array<{ x: number; y: number }> {
    const minDist = TC.SCENERY_MIN_DIST;
    const k       = TC.POISSON_K;
    const cellSize = minDist / Math.SQRT2;
    const cols = Math.ceil(CHUNK / cellSize);
    const rows = Math.ceil(CHUNK / cellSize);

    // 2-D grid of booleans (whether cell is occupied)
    const grid: Array<{ x: number; y: number } | null> = new Array(cols * rows).fill(null);

    const cellIndex = (lx: number, ly: number): number =>
      Math.floor(lx / cellSize) + Math.floor(ly / cellSize) * cols;

    const active: Array<{ x: number; y: number }> = [];
    const result: Array<{ x: number; y: number }> = [];

    // Initial seed point (random within chunk)
    const ix = rng.frac() * CHUNK;
    const iy = rng.frac() * CHUNK;
    const init = { x: ix, y: iy };
    active.push(init);
    result.push({ x: chunkOriginX + ix, y: chunkOriginY + iy });
    grid[cellIndex(ix, iy)] = init;

    while (active.length > 0) {
      const idx = Math.floor(rng.frac() * active.length);
      const base = active[idx];
      let found = false;

      for (let attempt = 0; attempt < k; attempt++) {
        const angle = rng.frac() * Math.PI * 2;
        const dist  = minDist + rng.frac() * minDist;
        const nx    = base.x + Math.cos(angle) * dist;
        const ny    = base.y + Math.sin(angle) * dist;

        if (nx < 0 || ny < 0 || nx >= CHUNK || ny >= CHUNK) continue;

        if (!this.tooClose(nx, ny, grid, cols, rows, cellSize, minDist)) {
          const candidate = { x: nx, y: ny };
          active.push(candidate);
          result.push({ x: chunkOriginX + nx, y: chunkOriginY + ny });
          grid[cellIndex(nx, ny)] = candidate;
          found = true;
          break;
        }
      }

      if (!found) {
        active.splice(idx, 1);
      }
    }

    return result;
  }

  // ── Asset selection ────────────────────────────────────────────────────────

  /**
   * Pick the most appropriate scenery asset for a position using weighted
   * random selection from assets that prefer the terrain band and tolerate
   * the current slope.
   */
  pickAsset(
    x: number,
    y: number,
    band: string,
    slope: number,
    biome: BiomeType,
    rng: Phaser.Math.RandomDataGenerator,
  ): (typeof SCENERY_ASSETS)[0] | null {
    // Filter to eligible assets
    const eligible = SCENERY_ASSETS.filter(
      (a) => a.preferredBands.includes(band) && slope <= a.maxSlopeDeg,
    );

    if (eligible.length === 0) return null;

    // Weighted random selection with biome multipliers
    const weights = eligible.map((a) => effectiveWeight(a, biome));
    const total   = weights.reduce((s, w) => s + w, 0);

    let roll = rng.frac() * total;
    for (let i = 0; i < eligible.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return eligible[i];
    }

    return eligible[eligible.length - 1];
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private tooClose(
    x: number,
    y: number,
    grid: Array<{ x: number; y: number } | null>,
    cols: number,
    rows: number,
    cellSize: number,
    minDist: number,
  ): boolean {
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);

    const searchR = 2;
    for (let dy = -searchR; dy <= searchR; dy++) {
      for (let dx = -searchR; dx <= searchR; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const neighbour = grid[ny * cols + nx];
        if (!neighbour) continue;
        const dist = Math.sqrt((x - neighbour.x) ** 2 + (y - neighbour.y) ** 2);
        if (dist < minDist) return true;
      }
    }

    return false;
  }

  /**
   * Deterministic position hash — returns a value in [0, 0xffff] given a
   * world position and an integer salt.
   */
  private posHash(x: number, y: number, salt: number): number {
    // Integer-friendly hash based on Wang hash
    let h = (Math.round(x) * 1664525 + Math.round(y) * 1013904223 + salt * 22695477) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0;
    h ^= h >>> 16;
    return h & 0xffff;
  }
}
