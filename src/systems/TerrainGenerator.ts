import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';

/** Terrain band identifier. */
export type TerrainBand = 'WATER' | 'LOWLAND' | 'MIDLAND' | 'HIGHLAND' | 'PEAK';

const TC = GameConfig.TERRAIN;

/**
 * TerrainGenerator
 *
 * Produces a seeded, deterministic heightmap using fractional Brownian motion
 * (fBm) built from value noise. The heightmap is sampled at SAMPLE_STEP
 * intervals and queried via bilinear interpolation.
 *
 * All public methods are pure functions of world coordinates and the seed,
 * so the same seed always yields identical terrain.
 */
export class TerrainGenerator {
  private readonly rng: Phaser.Math.RandomDataGenerator;
  /** Doubled permutation table (length 512) for wrapping. */
  private readonly perm: Uint8Array;

  private readonly widthSamples: number;
  private readonly heightSamples: number;
  private readonly heightmap: Float32Array;

  private readonly halfW: number;
  private readonly halfH: number;

  constructor(seed: string) {
    this.rng = new Phaser.Math.RandomDataGenerator([seed]);

    // Build permutation table
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher–Yates shuffle seeded via RNG
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(this.rng.frac() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    // Double for wrapping
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];

    this.halfW = TC.WORLD_WIDTH / 2;
    this.halfH = TC.WORLD_HEIGHT / 2;
    this.widthSamples  = Math.floor(TC.WORLD_WIDTH  / TC.SAMPLE_STEP) + 1;
    this.heightSamples = Math.floor(TC.WORLD_HEIGHT / TC.SAMPLE_STEP) + 1;
    this.heightmap = new Float32Array(this.widthSamples * this.heightSamples);

    this.bakeHeightmap();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Height at an arbitrary world position in world-units, using bilinear
   * interpolation between the nearest four sample points.
   */
  getHeightAt(worldX: number, worldY: number): number {
    // Convert world → sample-space (clamped to grid bounds)
    const sx = (worldX + this.halfW) / TC.SAMPLE_STEP;
    const sy = (worldY + this.halfH) / TC.SAMPLE_STEP;

    const x0 = Math.max(0, Math.min(this.widthSamples  - 2, Math.floor(sx)));
    const y0 = Math.max(0, Math.min(this.heightSamples - 2, Math.floor(sy)));
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const tx = sx - x0;
    const ty = sy - y0;

    const h00 = this.heightmap[y0 * this.widthSamples + x0];
    const h10 = this.heightmap[y0 * this.widthSamples + x1];
    const h01 = this.heightmap[y1 * this.widthSamples + x0];
    const h11 = this.heightmap[y1 * this.widthSamples + x1];

    return this.lerp(
      this.lerp(h00, h10, tx),
      this.lerp(h01, h11, tx),
      ty,
    );
  }

  /**
   * Terrain slope magnitude at a world position in degrees (central-difference
   * gradient using SAMPLE_STEP as the finite-difference step).
   */
  slopeAt(worldX: number, worldY: number): number {
    const step = TC.SAMPLE_STEP;
    const dX = (this.getHeightAt(worldX + step, worldY) - this.getHeightAt(worldX - step, worldY)) / (2 * step);
    const dY = (this.getHeightAt(worldX, worldY + step) - this.getHeightAt(worldX, worldY - step)) / (2 * step);
    const grad = Math.sqrt(dX * dX + dY * dY);
    return Math.atan(grad) * (180 / Math.PI);
  }

  /**
   * Terrain slope in degrees along a specific bearing (world X-axis = 0°,
   * positive Y downward). Positive result = uphill in that direction.
   */
  slopeAlongBearing(worldX: number, worldY: number, angleDeg: number): number {
    const step = TC.SAMPLE_STEP;
    const rad = angleDeg * (Math.PI / 180);
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const rise = this.getHeightAt(worldX + dx * step, worldY + dy * step)
               - this.getHeightAt(worldX - dx * step, worldY - dy * step);
    return Math.atan(rise / (2 * step)) * (180 / Math.PI);
  }

  /**
   * Rise-over-run gradient (percent) along a bearing.
   * Matches the unit expected by `TERRAIN.MAX_SLOPE_PERCENT`.
   */
  gradientPercent(worldX: number, worldY: number, angleDeg: number): number {
    const step = TC.SAMPLE_STEP;
    const rad = angleDeg * (Math.PI / 180);
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const rise = this.getHeightAt(worldX + dx * step, worldY + dy * step)
               - this.getHeightAt(worldX - dx * step, worldY - dy * step);
    return (rise / (2 * step)) * 100;
  }

  /** Classify a height value into one of the five terrain bands. */
  getTerrainBand(height: number): TerrainBand {
    const b = TC.BANDS;
    if (height < b.WATER.max)    return 'WATER';
    if (height < b.LOWLAND.max)  return 'LOWLAND';
    if (height < b.MIDLAND.max)  return 'MIDLAND';
    if (height < b.HIGHLAND.max) return 'HIGHLAND';
    return 'PEAK';
  }

  /** Classify terrain at an arbitrary world position. */
  getBandAt(worldX: number, worldY: number): TerrainBand {
    return this.getTerrainBand(this.getHeightAt(worldX, worldY));
  }

  /**
   * Sample the raw heightmap at grid indices (not world coordinates).
   * Used by chunk rendering for fast rasterisation.
   */
  getHeightAtGrid(xi: number, yi: number): number {
    const xc = Math.max(0, Math.min(this.widthSamples  - 1, xi));
    const yc = Math.max(0, Math.min(this.heightSamples - 1, yi));
    return this.heightmap[yc * this.widthSamples + xc];
  }

  /** Number of heightmap samples along the X axis. */
  get samplesX(): number { return this.widthSamples; }
  /** Number of heightmap samples along the Y axis. */
  get samplesY(): number { return this.heightSamples; }

  // ── Internal baking ────────────────────────────────────────────────────────

  /** Pre-bake the entire heightmap into a flat Float32Array. */
  private bakeHeightmap(): void {
    for (let yi = 0; yi < this.heightSamples; yi++) {
      for (let xi = 0; xi < this.widthSamples; xi++) {
        const wx = xi * TC.SAMPLE_STEP - this.halfW;
        const wy = yi * TC.SAMPLE_STEP - this.halfH;
        this.heightmap[yi * this.widthSamples + xi] = this.fbm(wx, wy);
      }
    }
  }

  // ── fBm value noise ────────────────────────────────────────────────────────

  private fbm(worldX: number, worldY: number): number {
    let total = 0;
    let amplitude = 1;
    let frequency = TC.FREQUENCY;
    let maxValue  = 0;

    for (let i = 0; i < TC.OCTAVES; i++) {
      total    += this.valueNoise(worldX * frequency, worldY * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= TC.PERSISTENCE;
      frequency *= TC.LACUNARITY;
    }

    return (total / maxValue) * TC.AMPLITUDE;
  }

  private valueNoise(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u  = this.fade(xf);
    const v  = this.fade(yf);

    const p = this.perm;
    // Four corner hash values
    const a  = p[xi     + p[yi    ]];
    const b  = p[xi + 1 + p[yi    ]];
    const c  = p[xi     + p[yi + 1]];
    const d  = p[xi + 1 + p[yi + 1]];

    // Map to [-1, 1] range
    const va = (a / 128) - 1;
    const vb = (b / 128) - 1;
    const vc = (c / 128) - 1;
    const vd = (d / 128) - 1;

    return this.lerp(
      this.lerp(va, vb, u),
      this.lerp(vc, vd, u),
      v,
    );
  }

  /** Quintic smoothing curve (Ken Perlin's improved fade). */
  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }
}
