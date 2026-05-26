import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { BIOME_PALETTES } from '../config/SceneryConfig';
import type { TerrainGenerator } from '../systems/TerrainGenerator';
import type { BiomeType, BandName } from '../config/SceneryConfig';

const TC  = GameConfig.TERRAIN;
const CHUNK = GameConfig.WORLD.CHUNK_SIZE;
const STEP  = TC.SAMPLE_STEP;

/** Band-name order for palette lookups. */
const BAND_ORDER: BandName[] = ['WATER', 'LOWLAND', 'MIDLAND', 'HIGHLAND', 'PEAK'];
const BAND_MAX: number[] = [
  TC.BANDS.WATER.max,
  TC.BANDS.LOWLAND.max,
  TC.BANDS.MIDLAND.max,
  TC.BANDS.HIGHLAND.max,
  TC.BANDS.PEAK.max,
];

/**
 * TerrainChunk
 *
 * Renders a single CHUNK_SIZE × CHUNK_SIZE region of terrain using
 * Phaser.GameObjects.Graphics. Each heightmap cell is drawn as a coloured
 * quad whose colour is derived from the terrain band, blended smoothly at
 * band boundaries, and optionally darkened by an ambient-occlusion factor.
 *
 * Depth is fixed at −100 so terrain appears below all game objects.
 */
export class TerrainChunk extends Phaser.GameObjects.Graphics {
  private readonly chunkX: number;
  private readonly chunkY: number;

  constructor(
    scene: Phaser.Scene,
    chunkX: number,
    chunkY: number,
    terrain: TerrainGenerator,
    biome: BiomeType,
  ) {
    super(scene);
    scene.add.existing(this);
    this.chunkX = chunkX;
    this.chunkY = chunkY;
    this.setDepth(-100);
    this.render(terrain, biome);
  }

  /** World-space X coordinate of the chunk origin (top-left corner). */
  get originX(): number { return this.chunkX; }
  /** World-space Y coordinate of the chunk origin (top-left corner). */
  get originY(): number { return this.chunkY; }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private render(terrain: TerrainGenerator, biome: BiomeType): void {
    this.clear();

    const samplesPerChunk = Math.ceil(CHUNK / STEP) + 1;

    for (let yi = 0; yi < samplesPerChunk - 1; yi++) {
      for (let xi = 0; xi < samplesPerChunk - 1; xi++) {
        // World coordinates of the top-left corner of this quad
        const wx = this.chunkX + xi * STEP;
        const wy = this.chunkY + yi * STEP;

        const h = terrain.getHeightAt(wx, wy);

        // Blended colour from band palette
        const baseColor = this.bandColor(h, biome);

        // Ambient occlusion: darken cells facing away from the sun
        const ao = this.computeAO(terrain, wx, wy);

        const finalColor = this.applyAO(baseColor, ao);
        this.fillStyle(finalColor, 1);
        this.fillRect(wx, wy, STEP, STEP);
      }
    }

    // Water overlay – semi-transparent blue tint on water cells
    for (let yi = 0; yi < samplesPerChunk - 1; yi++) {
      for (let xi = 0; xi < samplesPerChunk - 1; xi++) {
        const wx = this.chunkX + xi * STEP;
        const wy = this.chunkY + yi * STEP;
        if (terrain.getHeightAt(wx, wy) < TC.BANDS.WATER.max) {
          this.fillStyle(0x2a6aaa, 0.25);
          this.fillRect(wx, wy, STEP, STEP);
        }
      }
    }

    // Cliff-edge shadow strips
    for (let yi = 0; yi < samplesPerChunk - 1; yi++) {
      for (let xi = 0; xi < samplesPerChunk - 1; xi++) {
        const wx = this.chunkX + xi * STEP;
        const wy = this.chunkY + yi * STEP;
        const slope = terrain.slopeAt(wx, wy);
        if (slope > TC.CLIFF_SLOPE_DEG) {
          this.lineStyle(2, 0x000000, 0.35);
          this.strokeRect(wx, wy, STEP, STEP);
        }
      }
    }
  }

  // ── Colour helpers ──────────────────────────────────────────────────────────

  /**
   * Return the colour for a height value within the given biome, blending
   * smoothly within BAND_BLEND_RANGE of a band boundary.
   */
  private bandColor(height: number, biome: BiomeType): number {
    const palette = BIOME_PALETTES[biome];
    const blend   = TC.BAND_BLEND_RANGE;

    for (let i = 0; i < BAND_MAX.length - 1; i++) {
      const threshold = BAND_MAX[i];
      if (threshold === Infinity) break;
      if (height < threshold + blend) {
        const bandName = BAND_ORDER[i];
        const nextName = BAND_ORDER[i + 1];
        if (height > threshold - blend) {
          // Blend between this band and the next
          const t = (height - (threshold - blend)) / (2 * blend);
          return this.lerpColor(palette[bandName], palette[nextName], Math.max(0, Math.min(1, t)));
        }
        return palette[bandName];
      }
    }

    return palette['PEAK'];
  }

  /** Linearly interpolate two 24-bit RGB colours. */
  private lerpColor(c0: number, c1: number, t: number): number {
    const r0 = (c0 >> 16) & 0xff; const g0 = (c0 >> 8) & 0xff; const b0 = c0 & 0xff;
    const r1 = (c1 >> 16) & 0xff; const g1 = (c1 >> 8) & 0xff; const b1 = c1 & 0xff;
    const r  = Math.round(r0 + (r1 - r0) * t);
    const g  = Math.round(g0 + (g1 - g0) * t);
    const b  = Math.round(b0 + (b1 - b0) * t);
    return (r << 16) | (g << 8) | b;
  }

  // ── Ambient occlusion ───────────────────────────────────────────────────────

  /**
   * Simple dot-product ambient occlusion. Computes the surface normal from
   * central-difference gradients then dots with the sun direction.
   * Returns a value in [0, 1] where 0 is fully in shadow and 1 is fully lit.
   */
  private computeAO(terrain: TerrainGenerator, wx: number, wy: number): number {
    const dx = (terrain.getHeightAt(wx + STEP, wy) - terrain.getHeightAt(wx - STEP, wy)) / (2 * STEP);
    const dy = (terrain.getHeightAt(wx, wy + STEP) - terrain.getHeightAt(wx, wy - STEP)) / (2 * STEP);

    // Surface normal (unnormalised, z = 1)
    const nx = -dx;
    const ny = -dy;
    const nz = 1;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

    // Sun direction (normalised) – from GameConfig
    const sl = Math.sqrt(TC.SUN_DIR_X ** 2 + TC.SUN_DIR_Y ** 2 + 1);
    const dot = (nx * TC.SUN_DIR_X + ny * TC.SUN_DIR_Y + nz) / (len * sl);

    return Math.max(0, Math.min(1, dot));
  }

  /**
   * Apply ambient occlusion factor to a 24-bit RGB colour.
   * AO = 1 → fully lit; AO = 0 → darkened by AO_STRENGTH.
   */
  private applyAO(color: number, ao: number): number {
    const factor = 1 - TC.AO_STRENGTH * (1 - ao);
    const r = Math.round(((color >> 16) & 0xff) * factor);
    const g = Math.round(((color >>  8) & 0xff) * factor);
    const b = Math.round(( color        & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
  }
}
