import Phaser from 'phaser';
import type { TerrainGenerator } from './TerrainGenerator';
import { GameConfig } from '../config/GameConfig';
import type TrackManager from '../managers/TrackManager';

/** Machine-readable classification of why a track is invalid (or 'ok' when valid). */
export type ValidationReasonCode = 'ok' | 'slope' | 'cliff' | 'curvature' | 'misaligned';

export interface TrackValidationResult {
  valid: boolean;
  /** Machine-readable reason code. */
  reasonCode: ValidationReasonCode;
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
 * Two call signatures are supported:
 *   canPlaceTrack(p0, p3, sampleCount?)               – 2-point form (legacy)
 *   canPlaceTrack(p0, p1, p2, p3, sampleCount?, tm?)  – full Bézier form
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
   * Validate a proposed track segment.
   *
   * **2-point form** (backward-compatible):
   *   `canPlaceTrack(p0, p3, sampleCount?)`
   *   Control points p1/p2 are interpolated as a straight line — curvature
   *   and alignment checks are skipped (straight line has infinite radius).
   *
   * **Full Bézier form**:
   *   `canPlaceTrack(p0, p1, p2, p3, sampleCount?, trackManager?)`
   *   All three checks run including curvature and (when trackManager is
   *   supplied) connection-alignment.
   */
  canPlaceTrack(p0: Phaser.Math.Vector2, p3: Phaser.Math.Vector2, sampleCount?: number): TrackValidationResult;
  canPlaceTrack(p0: Phaser.Math.Vector2, p1: Phaser.Math.Vector2, p2: Phaser.Math.Vector2, p3: Phaser.Math.Vector2, sampleCount?: number, trackManager?: TrackManager | null): TrackValidationResult;
  canPlaceTrack(
    p0: Phaser.Math.Vector2,
    p1OrP3: Phaser.Math.Vector2,
    p2OrCount?: Phaser.Math.Vector2 | number,
    p3OrCount?: Phaser.Math.Vector2 | number,
    sampleCount = 20,
    trackManager: TrackManager | null = null,
  ): TrackValidationResult {
    let p1: Phaser.Math.Vector2;
    let p2: Phaser.Math.Vector2;
    let p3: Phaser.Math.Vector2;
    let count: number;
    let tm: TrackManager | null;

    if (p3OrCount instanceof Phaser.Math.Vector2) {
      // Full 4-point form: canPlaceTrack(p0, p1, p2, p3, count?, tm?)
      p1 = p1OrP3;
      p2 = p2OrCount as Phaser.Math.Vector2;
      p3 = p3OrCount;
      count = sampleCount;
      tm = trackManager;
    } else {
      // 2-point form: canPlaceTrack(p0, p3, count?)
      p3 = p1OrP3;
      count = typeof p2OrCount === 'number' ? p2OrCount : 20;
      const dx = p3.x - p0.x;
      const dy = p3.y - p0.y;
      p1 = new Phaser.Math.Vector2(p0.x + dx / 3, p0.y + dy / 3);
      p2 = new Phaser.Math.Vector2(p0.x + dx * 2 / 3, p0.y + dy * 2 / 3);
      tm = null;
    }

    return this._validate(p0, p1, p2, p3, count, tm);
  }

  private _validate(
    p0: Phaser.Math.Vector2,
    p1: Phaser.Math.Vector2,
    p2: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    sampleCount: number,
    trackManager: TrackManager | null,
  ): TrackValidationResult {
    const gradientResult = this.exceedsMaxGradient(p0, p3, sampleCount);
    if (gradientResult.exceeds) {
      return {
        valid: false,
        reasonCode: 'slope',
        reason: `Too steep — gradient ${gradientResult.maxGradient.toFixed(1)} % exceeds limit of ${TC.MAX_SLOPE_PERCENT} %.`,
        requiresTunnel: false,
        averageElevation: gradientResult.averageElevation,
      };
    }

    const cliffResult = this.intersectsCliff(p0, p3, sampleCount);
    if (cliffResult.intersects) {
      return {
        valid: false,
        reasonCode: 'cliff',
        reason: 'Route crosses a cliff face — choose a different path or build a tunnel.',
        requiresTunnel: false,
        averageElevation: gradientResult.averageElevation,
      };
    }

    const curvatureResult = this.exceedsMinCurvature(p0, p1, p2, p3, sampleCount);
    if (curvatureResult.exceeds) {
      return {
        valid: false,
        reasonCode: 'curvature',
        reason: `Curve too tight — minimum radius ${curvatureResult.minRadius.toFixed(0)} px (limit ${GameConfig.TRACK.MIN_CURVE_RADIUS_PX} px).`,
        requiresTunnel: false,
        averageElevation: gradientResult.averageElevation,
      };
    }

    if (trackManager) {
      const alignResult = this.checkConnectionAlignment(p0, p1, trackManager);
      if (!alignResult.aligned) {
        return {
          valid: false,
          reasonCode: 'misaligned',
          reason: `Connection not straight — ${alignResult.angleDeg.toFixed(1)}° angle at joining point (limit ${GameConfig.TRACK.ALIGNMENT_ANGLE_DEG}°).`,
          requiresTunnel: false,
          averageElevation: gradientResult.averageElevation,
        };
      }
    }

    const tunnelResult = this.requiresTunnel(p0, p3, sampleCount);

    return {
      valid: true,
      reasonCode: 'ok',
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

  /**
   * Check whether the cubic Bézier curve defined by (p0, p1, p2, p3) is too
   * tight at any sampled point.
   *
   * Uses the analytical curvature formula:
   *   κ = |x′y″ − y′x″| / (x′² + y′²)^(3/2)
   *   radius = 1 / κ
   *
   * Straight sections (κ ≈ 0) have infinite radius and are always valid.
   */
  exceedsMinCurvature(
    p0: Phaser.Math.Vector2,
    p1: Phaser.Math.Vector2,
    p2: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    sampleCount: number = 20,
  ): { exceeds: boolean; minRadius: number } {
    const minAllowed = GameConfig.TRACK.MIN_CURVE_RADIUS_PX;
    let minRadius = Infinity;

    for (let i = 0; i <= sampleCount; i++) {
      const t = i / sampleCount;
      const { dxdt, dydt, d2xdt2, d2ydt2 } = this.bezierDerivatives(p0, p1, p2, p3, t);
      const denom = Math.pow(dxdt * dxdt + dydt * dydt, 1.5);
      if (denom < 1e-10) continue; // straight section → infinite radius
      const kappa = Math.abs(dxdt * d2ydt2 - dydt * d2xdt2) / denom;
      if (kappa > 1e-10) {
        const r = 1 / kappa;
        if (r < minRadius) minRadius = r;
      }
    }

    return { exceeds: minRadius < minAllowed, minRadius };
  }

  /**
   * Check whether the proposed track connects straight-on to a neighbouring
   * track at p0.
   *
   * Looks for an existing track endpoint within snap distance of p0. If one
   * is found the angle between the neighbour's outward tangent and the
   * proposed track's tangent (p0→p1) is computed. Returns `aligned: false`
   * when that angle exceeds `TRACK.ALIGNMENT_ANGLE_DEG`.
   *
   * Returns `aligned: true` when no neighbouring endpoint is nearby (no
   * connection to check).
   */
  checkConnectionAlignment(
    p0: Phaser.Math.Vector2,
    p1: Phaser.Math.Vector2,
    trackManager: TrackManager,
  ): { aligned: boolean; angleDeg: number } {
    const snapRadius = 60;
    const near = trackManager.findEndpointNear(p0, snapRadius);
    if (!near) return { aligned: true, angleDeg: 0 };

    const proposedDx = p1.x - p0.x;
    const proposedDy = p1.y - p0.y;
    const proposedLen = Math.sqrt(proposedDx * proposedDx + proposedDy * proposedDy);
    if (proposedLen < 1e-6) return { aligned: true, angleDeg: 0 };

    const pNx = proposedDx / proposedLen;
    const pNy = proposedDy / proposedLen;

    // Dot product with neighbour's outward tangent (already normalised)
    const dot = Math.min(1, Math.max(-1, pNx * near.tangent.x + pNy * near.tangent.y));
    const angleDeg = Math.acos(dot) * (180 / Math.PI);

    return {
      aligned: angleDeg <= GameConfig.TRACK.ALIGNMENT_ANGLE_DEG,
      angleDeg,
    };
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

  /**
   * Compute first and second derivatives of the cubic Bézier at parameter t.
   *
   * B′(t) = 3[(1-t)²(P1-P0) + 2(1-t)t(P2-P1) + t²(P3-P2)]
   * B″(t) = 6[(1-t)(P2-2P1+P0) + t(P3-2P2+P1)]
   */
  private bezierDerivatives(
    p0: Phaser.Math.Vector2,
    p1: Phaser.Math.Vector2,
    p2: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    t: number,
  ): { dxdt: number; dydt: number; d2xdt2: number; d2ydt2: number } {
    const it = 1 - t;
    const dxdt  = 3 * (it * it * (p1.x - p0.x) + 2 * it * t * (p2.x - p1.x) + t * t * (p3.x - p2.x));
    const dydt  = 3 * (it * it * (p1.y - p0.y) + 2 * it * t * (p2.y - p1.y) + t * t * (p3.y - p2.y));
    const d2xdt2 = 6 * (it * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x));
    const d2ydt2 = 6 * (it * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y));
    return { dxdt, dydt, d2xdt2, d2ydt2 };
  }
}
