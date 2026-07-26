import TrackManager from '../managers/TrackManager';
import { GameConfig } from '../config/GameConfig';
import { canonicalizeConstructionGridPoint } from './ConstructionGrid';
import {
  deriveTrackEndpointOutward,
  type TrackGeometryDef,
} from './TrackGeometry';

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
    const controls = track.getControlPoints();
    const geometry: TrackGeometryDef = {
      geometryVersion: 1,
      p0: { x: controls.p0.x, y: controls.p0.y },
      p1: { x: controls.p1.x, y: controls.p1.y },
      p2: { x: controls.p2.x, y: controls.p2.y },
      p3: { x: controls.p3.x, y: controls.p3.y },
    };
    const endpointDefs = [
      { endpoint: 'start' as const, point: geometry.p0 },
      { endpoint: 'end' as const, point: geometry.p3 },
    ];
    for (const definition of endpointDefs) {
      const distance = Math.hypot(
        definition.point.x - wx,
        definition.point.y - wy,
      );
      if (distance > radius) continue;
      candidates.push({
        x: definition.point.x,
        y: definition.point.y,
        trackUUID,
        endpoint: definition.endpoint,
        outward: deriveTrackEndpointOutward(
          geometry,
          definition.endpoint,
        ),
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
