import TrackManager from '../managers/TrackManager';
import { GameConfig } from '../config/GameConfig';
import { canonicalizeConstructionGridPoint } from './ConstructionGrid';

export interface SnapResult {
  x: number;
  y: number;
  snapped: boolean;
  type: 'none' | 'grid' | 'endpoint' | 'midpoint';
  trackUUID?: string;
  endpoint?: 'start' | 'end';
  outward?: Readonly<{ x: number; y: number }>;
  open?: boolean;
}

export interface ResolvedTrackEndpoint {
  readonly x: number;
  readonly y: number;
  readonly trackUUID: string;
  readonly endpoint: 'start' | 'end';
  readonly outward: Readonly<{ x: number; y: number }>;
  readonly open: boolean;
}

function normalisedOutward(
  x: number,
  y: number,
  reverse: boolean,
): { x: number; y: number } {
  const length = Math.hypot(x, y);
  const direction = length > 0 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
  const outward = reverse
    ? { x: -direction.x, y: -direction.y }
    : direction;
  return {
    x: Object.is(outward.x, -0) ? 0 : outward.x,
    y: Object.is(outward.y, -0) ? 0 : outward.y,
  };
}

/**
 * Resolve one endpoint deterministically. Construction preview and quoting
 * share this function so the displayed port can never differ from authority.
 */
export function resolveTrackEndpoint(
  trackManager: TrackManager,
  wx: number,
  wy: number,
  radius: number = GameConfig.TRACK.SNAP_RADIUS_PX,
  excludeUUIDs: ReadonlyArray<string> = [],
): ResolvedTrackEndpoint | null {
  const excluded = new Set(excludeUUIDs);
  const candidates: Array<ResolvedTrackEndpoint & { distance: number }> = [];
  for (const track of trackManager.tracks) {
    const trackUUID = track.getUUID();
    if (excluded.has(trackUUID)) continue;
    const curve = track.getCurvePath();
    const endpointDefs = [
      { endpoint: 'start' as const, point: curve.getStartPoint(), t: 0, reverse: true },
      { endpoint: 'end' as const, point: curve.getEndPoint(), t: 1, reverse: false },
    ];
    for (const definition of endpointDefs) {
      const distance = Math.hypot(
        definition.point.x - wx,
        definition.point.y - wy,
      );
      if (distance > radius) continue;
      const tangent = curve.getTangent(definition.t);
      candidates.push({
        x: definition.point.x,
        y: definition.point.y,
        trackUUID,
        endpoint: definition.endpoint,
        outward: normalisedOutward(tangent.x, tangent.y, definition.reverse),
        open: !trackManager.endpointHasConnection(
          track,
          definition.endpoint === 'start',
        ),
        distance,
      });
    }
  }
  candidates.sort((left, right) => (
    left.distance - right.distance
    || left.trackUUID.localeCompare(right.trackUUID)
    || (left.endpoint === right.endpoint ? 0 : left.endpoint === 'start' ? -1 : 1)
  ));
  const best = candidates[0];
  if (!best) return null;
  const { distance: _distance, ...resolved } = best;
  return resolved;
}

/**
 * SnapSystem
 *
 * Provides configurable snapping logic for editor tools:
 *   - Grid snap: rounds coordinates to a world-unit grid (default 64 px)
 *   - Endpoint snap: snaps to the start/end points of existing tracks
 *   - Midpoint snap: optionally snaps to the midpoints of existing tracks
 *
 * Priority: endpoint > midpoint > grid > none
 */
export class SnapSystem {
  private trackManager: TrackManager;

  gridEnabled: boolean = true;
  endpointEnabled: boolean = true;
  midpointEnabled: boolean = false;

  gridSize: number = GameConfig.WORLD.SNAP_GRID_SIZE;
  /** World-unit radius within which a point snaps to an endpoint/midpoint. */
  snapRadius: number = GameConfig.TRACK.SNAP_RADIUS_PX;

  constructor(trackManager: TrackManager) {
    this.trackManager = trackManager;
  }

  /**
   * Compute the snapped coordinate for the given world-space point.
   *
   * @param wx  World x coordinate (not screen)
   * @param wy  World y coordinate (not screen)
   * @param excludeUUIDs  Track UUIDs to skip when searching for snap targets
   */
  snapPoint(wx: number, wy: number, excludeUUIDs: string[] = []): SnapResult {
    return this.snapPointWithMidpoints(
      wx,
      wy,
      excludeUUIDs,
      this.midpointEnabled,
    );
  }

  private snapPointWithMidpoints(
    wx: number,
    wy: number,
    excludeUUIDs: string[],
    allowMidpoints: boolean,
  ): SnapResult {
    // ── Endpoint snap (highest priority) ──────────────────────────────────
    if (this.endpointEnabled) {
      const endpoint = resolveTrackEndpoint(
        this.trackManager,
        wx,
        wy,
        this.snapRadius,
        excludeUUIDs,
      );
      if (endpoint) {
        return {
          ...endpoint,
          snapped: true,
          type: 'endpoint',
        };
      }
    }

    // ── Midpoint snap ──────────────────────────────────────────────────────
    if (allowMidpoints) {
      for (const track of this.trackManager.tracks) {
        if (excludeUUIDs.indexOf(track.getUUID()) !== -1) continue;
        const mid = track.getCurvePath().getPoint(0.5);
        const d = Math.hypot(mid.x - wx, mid.y - wy);
        if (d <= this.snapRadius) {
          return { x: mid.x, y: mid.y, snapped: true, type: 'midpoint' };
        }
      }
    }

    // ── Grid snap ──────────────────────────────────────────────────────────
    const gridPoint = canonicalizeConstructionGridPoint(
      wx,
      wy,
      this.gridSize,
      this.gridEnabled,
    );
    if (gridPoint.snapped) {
      return { ...gridPoint, type: 'grid' };
    }

    return { x: wx, y: wy, snapped: false, type: 'none' };
  }

  /** Construction deliberately excludes midpoint snapping. */
  snapConstructionPoint(
    wx: number,
    wy: number,
    excludeUUIDs: string[] = [],
  ): SnapResult {
    return this.snapPointWithMidpoints(wx, wy, excludeUUIDs, false);
  }
}
