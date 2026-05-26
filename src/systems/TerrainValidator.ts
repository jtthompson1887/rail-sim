import Phaser from 'phaser';
import type { TerrainGenerator } from './TerrainGenerator';
import { GameConfig } from '../config/GameConfig';

export interface TrackValidationResult {
  valid: boolean;
  /** Human-readable reason when valid is false. */
  reason: string;
  /** True when the track passes through terrain and should be a tunnel. */
  requiresTunnel: boolean;
  /** Average elevation sampled along the proposed segment. */
  averageElevation: number;
}

const TC = GameConfig.TERRAIN;

/**
 * TerrainValidator
 *
 * The single gate between the editor tools and the track graph. A proposed
 * track segment must pass this validator before it is committed.
 *
 * All methods accept world-space Phaser.Math.Vector2 points and a sample
 * count that controls accuracy vs. performance.
 */
export class TerrainValidator {
  private readonly terrain: TerrainGenerator;

  constructor(terrain: TerrainGenerator) {
    this.terrain = terrain;
  }

  // ── Primary validation ──────────────────────────────────────────────────────

  /**
   * Validate a proposed track segment defined by its start and end points.
   * Internally samples `sampleCount` evenly-spaced points along the segment.
   *
   * Returns `valid: false` with a descriptive reason if any constraint fails.
   */
  canPlaceTrack(
    p0: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    sampleCount: number = 20,
  ): TrackValidationResult {
    const gradientResult = this.exceedsMaxGradient(p0, p3, sampleCount);
    if (gradientResult.exceeds) {
      return {
        valid: false,
        reason: `Too steep — gradient ${gradientResult.maxGradient.toFixed(1)} % exceeds limit of ${TC.MAX_SLOPE_PERCENT} %.`,
        requiresTunnel: false,
        averageElevation: gradientResult.averageElevation,
      };
    }

    const cliffResult = this.intersectsCliff(p0, p3, sampleCount);
    if (cliffResult.intersects) {
      return {
        valid: false,
        reason: 'Route crosses a cliff face — choose a different path or build a tunnel.',
        requiresTunnel: false,
        averageElevation: gradientResult.averageElevation,
      };
    }

    const tunnelResult = this.requiresTunnel(p0, p3, sampleCount);

    return {
      valid: true,
      reason: '',
      requiresTunnel: tunnelResult.needed,
      averageElevation: gradientResult.averageElevation,
    };
  }

  // ── Individual checks ───────────────────────────────────────────────────────

  /**
   * Check whether the rise/run gradient along the segment exceeds the
   * configured maximum. Samples the segment and compares the slope of each
   * step to `TERRAIN.MAX_SLOPE_PERCENT`.
   */
  exceedsMaxGradient(
    p0: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    sampleCount: number = 20,
  ): { exceeds: boolean; maxGradient: number; averageElevation: number } {
    const pts = this.sampleSegment(p0, p3, sampleCount);
    let maxGradient = 0;
    let elevTotal   = 0;

    for (let i = 0; i < pts.length; i++) {
      const h = this.terrain.getHeightAt(pts[i].x, pts[i].y);
      elevTotal += h;

      if (i > 0) {
        const dX = pts[i].x - pts[i - 1].x;
        const dY = pts[i].y - pts[i - 1].y;
        const dH = h - this.terrain.getHeightAt(pts[i - 1].x, pts[i - 1].y);
        const run = Math.sqrt(dX * dX + dY * dY);
        if (run > 0) {
          const gradPct = Math.abs(dH / run) * 100;
          if (gradPct > maxGradient) maxGradient = gradPct;
        }
      }
    }

    return {
      exceeds: maxGradient > TC.MAX_SLOPE_PERCENT,
      maxGradient,
      averageElevation: elevTotal / pts.length,
    };
  }

  /**
   * Check whether the segment passes through a cliff — defined as a sample
   * point in the HIGHLAND or PEAK band whose local slope exceeds the
   * configured cliff angle.
   */
  intersectsCliff(
    p0: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    sampleCount: number = 20,
  ): { intersects: boolean } {
    const pts = this.sampleSegment(p0, p3, sampleCount);

    for (const pt of pts) {
      const band  = this.terrain.getBandAt(pt.x, pt.y);
      const slope = this.terrain.slopeAt(pt.x, pt.y);
      if ((band === 'HIGHLAND' || band === 'PEAK') && slope > TC.CLIFF_SLOPE_DEG) {
        return { intersects: true };
      }
    }

    return { intersects: false };
  }

  /**
   * Determine whether the segment needs a tunnel.
   * A tunnel is required when terrain height at any sample point significantly
   * exceeds the height at both endpoints (the track passes through a hill).
   */
  requiresTunnel(
    p0: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    sampleCount: number = 20,
  ): { needed: boolean } {
    const h0   = this.terrain.getHeightAt(p0.x, p0.y);
    const h3   = this.terrain.getHeightAt(p3.x, p3.y);
    const base = Math.max(h0, h3);
    const pts  = this.sampleSegment(p0, p3, sampleCount);

    for (const pt of pts) {
      if (this.terrain.getHeightAt(pt.x, pt.y) > base + TC.MIN_TUNNEL_CLEARANCE) {
        return { needed: true };
      }
    }

    return { needed: false };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Linearly sample `count` points along the segment from p0 to p3. */
  sampleSegment(
    p0: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    count: number,
  ): Phaser.Math.Vector2[] {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      pts.push(new Phaser.Math.Vector2(
        p0.x + (p3.x - p0.x) * t,
        p0.y + (p3.y - p0.y) * t,
      ));
    }
    return pts;
  }
}
