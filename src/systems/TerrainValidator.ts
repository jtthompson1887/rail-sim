import Phaser from 'phaser';
import type { TerrainGenerator } from './TerrainGenerator';
import { GameConfig } from '../config/GameConfig';
import type TrackManager from '../managers/TrackManager';
import type RailTrack from '../entities/RailTrack';
import { createTrackGeometry } from './TrackGeometry';

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

/** Minimum denominator / curvature value considered numerically non-zero. */
const CURVATURE_EPSILON = 1e-10;

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
    const geometry = createTrackGeometry({
      geometryVersion: 1,
      p0,
      p1,
      p2,
      p3,
    });
    const sampledCurve = geometry.sample(sampleCount).map(
      ({ point }) => new Phaser.Math.Vector2(point.x, point.y),
    );
    const gradientResult = this.gradientForPoints(sampledCurve);
    if (gradientResult.exceeds) {
      return {
        valid: false,
        reasonCode: 'slope',
        reason: `Too steep — gradient ${gradientResult.maxGradient.toFixed(1)} % exceeds limit of ${TC.MAX_SLOPE_PERCENT} %.`,
        requiresTunnel: false,
        averageElevation: gradientResult.averageElevation,
      };
    }

    const cliffResult = this.cliffForPoints(sampledCurve);
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

    const tunnelResult = this.tunnelForPoints(p0, p3, sampledCurve);

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
    return this.gradientForPoints(this.sampleSegment(p0, p3, sampleCount));
  }

  private gradientForPoints(
    pts: Phaser.Math.Vector2[],
  ): { exceeds: boolean; maxGradient: number; averageElevation: number } {
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
    return this.cliffForPoints(this.sampleSegment(p0, p3, sampleCount));
  }

  private cliffForPoints(pts: Phaser.Math.Vector2[]): { intersects: boolean } {
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
    return this.tunnelForPoints(p0, p3, this.sampleSegment(p0, p3, sampleCount));
  }

  private tunnelForPoints(
    p0: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    pts: Phaser.Math.Vector2[],
  ): { needed: boolean } {
    const h0   = this.terrain.getHeightAt(p0.x, p0.y);
    const h3   = this.terrain.getHeightAt(p3.x, p3.y);
    const base = Math.max(h0, h3);

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
      if (denom < CURVATURE_EPSILON) continue; // straight section → infinite radius
      const kappa = Math.abs(dxdt * d2ydt2 - dydt * d2xdt2) / denom;
      if (kappa > CURVATURE_EPSILON) {
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
    const near = trackManager.findEndpointNear(p0, GameConfig.TRACK.SNAP_RADIUS_PX);
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

  /**
   * Slightly adjust the control points of both the new track and its neighbour
   * to create a perfectly flush (0° angle) connection at the join point.
   *
   * Call this **after** `canPlaceTrack` returns valid, immediately before
   * committing the track. The method:
   *
   * 1. Snaps `p0` exactly to the neighbour's endpoint.
   * 2. Rotates `p1` (new track inner control) toward the **bisector** of the
   *    two current tangents, keeping the arm length unchanged.
   * 3. Rotates the neighbour's inner control point (p2 when connecting at its
   *    end, p1 when connecting at its start) toward the same bisector.
   *
   * The bisector approach distributes the correction equally between both
   * tracks so neither makes a change larger than half the original angle.
   * When no neighbouring endpoint is within snap distance the input points
   * are returned unchanged.
   *
   * @param p0  Start of the proposed track (connection point).
   * @param p1  First inner control point of the proposed track.
   * @param p2  Second inner control point (unchanged).
   * @param p3  End of the proposed track (unchanged).
   * @param trackManager  Used to locate the neighbouring endpoint.
   */
  snapToFlushConnection(
    p0: Phaser.Math.Vector2,
    p1: Phaser.Math.Vector2,
    p2: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    trackManager: TrackManager,
  ): {
    p0: Phaser.Math.Vector2;
    p1: Phaser.Math.Vector2;
    p2: Phaser.Math.Vector2;
    p3: Phaser.Math.Vector2;
    neighbourAdjustment: {
      track: RailTrack;
      p0: Phaser.Math.Vector2;
      p1: Phaser.Math.Vector2;
      p2: Phaser.Math.Vector2;
      p3: Phaser.Math.Vector2;
    } | null;
  } {
    const near = trackManager.findEndpointNear(p0, GameConfig.TRACK.SNAP_RADIUS_PX);
    if (!near) return { p0, p1, p2, p3, neighbourAdjustment: null };

    // ── Snap p0 exactly to the neighbour's endpoint ──────────────────────────
    const nCurve = near.track.getCurvePath();
    const neighbourEndpt = near.isStart ? nCurve.getStartPoint() : nCurve.getEndPoint();
    const newP0 = new Phaser.Math.Vector2(neighbourEndpt.x, neighbourEndpt.y);

    // ── Proposed forward tangent (p0→p1) ─────────────────────────────────────
    const proposedDx = p1.x - p0.x;
    const proposedDy = p1.y - p0.y;
    const proposedLen = Math.sqrt(proposedDx * proposedDx + proposedDy * proposedDy);
    if (proposedLen < 1e-6) return { p0, p1, p2, p3, neighbourAdjustment: null };

    const pTx = proposedDx / proposedLen;
    const pTy = proposedDy / proposedLen;

    // ── Bisector of the two unit tangents ─────────────────────────────────────
    // near.tangent is the neighbour's outward tangent (pointing away from that track).
    // The new track's outward tangent at p0 equals its forward tangent (p0→p1).
    const nTx = near.tangent.x;
    const nTy = near.tangent.y;
    const bx = pTx + nTx;
    const by = pTy + nTy;
    const bLen = Math.sqrt(bx * bx + by * by);
    // If tangents are anti-parallel the bisector is undefined — leave unchanged.
    if (bLen < 1e-6) return { p0, p1, p2, p3, neighbourAdjustment: null };
    const bisectTx = bx / bLen;
    const bisectTy = by / bLen;

    // ── Adjust new track p1: same arm length, new direction ───────────────────
    const newP1 = new Phaser.Math.Vector2(
      newP0.x + proposedLen * bisectTx,
      newP0.y + proposedLen * bisectTy,
    );

    // ── Adjust neighbour's inner control point ────────────────────────────────
    // The spline tangent at the endpoint is determined by the direction from
    // the second-to-last knot to the endpoint (for the end) or from the
    // endpoint to the second knot (for the start). We preserve arm length and
    // rotate the knot to produce the bisector tangent direction.
    let nP0 = new Phaser.Math.Vector2(nCurve.getStartPoint().x, nCurve.getStartPoint().y);
    let nP1 = near.track.getP1();
    let nP2 = near.track.getP2();
    let nP3 = new Phaser.Math.Vector2(nCurve.getEndPoint().x, nCurve.getEndPoint().y);

    if (near.isStart) {
      // Outward tangent at start = -(p1 − p0).  We want -(nP1 − nP0) = bisector.
      // So nP1 = nP0 − armLen × bisector.
      const armLen = Math.hypot(nP1.x - nP0.x, nP1.y - nP0.y);
      nP1 = new Phaser.Math.Vector2(
        nP0.x - armLen * bisectTx,
        nP0.y - armLen * bisectTy,
      );
    } else {
      // Outward tangent at end = (p3 − p2).  We want (nP3 − nP2) = bisector × armLen.
      // So nP2 = nP3 − armLen × bisector.
      const armLen = Math.hypot(nP3.x - nP2.x, nP3.y - nP2.y);
      nP2 = new Phaser.Math.Vector2(
        nP3.x - armLen * bisectTx,
        nP3.y - armLen * bisectTy,
      );
    }

    return {
      p0: newP0,
      p1: newP1,
      p2,
      p3,
      neighbourAdjustment: { track: near.track, p0: nP0, p1: nP1, p2: nP2, p3: nP3 },
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Linearly sample a straight two-point proposal. */
  sampleSegment(
    p0: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    count: number,
  ): Phaser.Math.Vector2[] {
    const sampleCount = Math.max(1, Math.floor(count));
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= sampleCount; i++) {
      const t = i / sampleCount;
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
