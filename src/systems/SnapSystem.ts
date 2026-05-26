import TrackManager from '../managers/TrackManager';
import { GameConfig } from '../config/GameConfig';

export interface SnapResult {
  x: number;
  y: number;
  snapped: boolean;
  type: 'none' | 'grid' | 'endpoint' | 'midpoint';
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
  snapRadius: number = 48;

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
    // ── Endpoint snap (highest priority) ──────────────────────────────────
    if (this.endpointEnabled) {
      for (const track of this.trackManager.tracks) {
        if (excludeUUIDs.indexOf(track.getUUID()) !== -1) continue;
        const curve = track.getCurvePath();
        const start = curve.getStartPoint();
        const end   = curve.getEndPoint();
        for (const pt of [start, end]) {
          const d = Math.hypot(pt.x - wx, pt.y - wy);
          if (d <= this.snapRadius) {
            return { x: pt.x, y: pt.y, snapped: true, type: 'endpoint' };
          }
        }
      }
    }

    // ── Midpoint snap ──────────────────────────────────────────────────────
    if (this.midpointEnabled) {
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
    if (this.gridEnabled && this.gridSize > 0) {
      const gx = Math.round(wx / this.gridSize) * this.gridSize;
      const gy = Math.round(wy / this.gridSize) * this.gridSize;
      const d = Math.hypot(gx - wx, gy - wy);
      // Only snap to grid if within half a grid cell
      if (d <= this.gridSize * 0.5) {
        return { x: gx, y: gy, snapped: true, type: 'grid' };
      }
    }

    return { x: wx, y: wy, snapped: false, type: 'none' };
  }
}
