import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import { EventBus } from '../services/EventBus';
import { GameConfig } from '../config/GameConfig';
import type { TrackDef } from '../config/WorldData';
import type { TerrainValidator } from './TerrainValidator';

interface Endpoint {
  track: RailTrack;
  isStart: boolean; // true = start of track (t=0), false = end (t=1)
  point: Phaser.Math.Vector2;
  tangent: Phaser.Math.Vector2;
}

interface SearchNode {
  point: Phaser.Math.Vector2;
  angle: number;
  cost: number;
  heuristic: number;
  path: Array<{ point: Phaser.Math.Vector2; angle: number }>;
}

/**
 * TrackCompleterSystem
 *
 * Allows the player to click two open (dangling) track endpoints, then
 * automatically finds a valid Bézier path between them using a heuristic
 * A*-style search over Bézier control-point configurations.
 *
 * Constraints:
 *  - No intermediate bend angle may exceed MAX_CURVE_TOLERANCE_DEG from config.
 *  - The route must not come closer than a proximity threshold to existing tracks.
 *
 * On success a ghost preview is shown. The player confirms (clicks) or cancels (ESC).
 */
export class TrackCompleterSystem {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private ghostGraphics: Phaser.GameObjects.Graphics;
  private endpointGraphics: Phaser.GameObjects.Graphics;
  private endpointDots: Phaser.GameObjects.Graphics;
  private terrainValidator: TerrainValidator | null;

  private firstEndpoint: Endpoint | null = null;
  private pendingTracks: RailTrack[] = [];
  private isAwaitingConfirm: boolean = false;

  // Pulsing animation accumulator
  private pulseT: number = 0;

  constructor(scene: Phaser.Scene, trackManager: TrackManager, terrainValidator: TerrainValidator | null = null) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.terrainValidator = terrainValidator;
    this.ghostGraphics = scene.add.graphics().setDepth(490);
    this.endpointGraphics = scene.add.graphics().setDepth(491);
    this.endpointDots = scene.add.graphics().setDepth(492);
  }

  // ── Update loop (call from WorldScene.update while in create mode) ─────────

  update(delta: number): void {
    this.pulseT += delta / 600;
    this.drawOpenEndpoints();
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!pointer.leftButtonDown()) return;
    if (this.isAwaitingConfirm) return;

    const world = this.screenToWorld(pointer);
    const endpoint = this.findNearestOpenEndpoint(world, 80);
    if (!endpoint) return;

    if (!this.firstEndpoint) {
      this.firstEndpoint = endpoint;
      EventBus.emit('ui:toast', { message: 'Endpoint selected — click a second endpoint.', type: 'info' });
      return;
    }

    if (endpoint.track === this.firstEndpoint.track) {
      EventBus.emit('ui:toast', { message: 'Select a different track endpoint.', type: 'info' });
      return;
    }

    this.runCompletion(this.firstEndpoint, endpoint);
    this.firstEndpoint = null;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      this.cancel();
    } else if (event.code === 'Enter' || event.code === 'Space') {
      this.confirm();
    }
  }

  cancel(): void {
    this.clearPending();
    this.firstEndpoint = null;
    this.isAwaitingConfirm = false;
    this.ghostGraphics.clear();
  }

  confirm(): void {
    if (!this.isAwaitingConfirm) return;
    this.commitPending();
    this.isAwaitingConfirm = false;
    this.ghostGraphics.clear();
    EventBus.emit('ui:toast', { message: 'Track connection committed.', type: 'success' });
  }

  destroy(): void {
    this.ghostGraphics.destroy();
    this.endpointGraphics.destroy();
    this.endpointDots.destroy();
  }

  // ── Core search ────────────────────────────────────────────────────────────

  private runCompletion(from: Endpoint, to: Endpoint): void {
    const result = this.aStarSearch(from, to);

    if (!result) {
      EventBus.emit('completer:failed', { reason: 'budget' });
      EventBus.emit('ui:toast', { message: 'No valid route found — try adjusting the endpoints.', type: 'error' });
      return;
    }

    // Build tracks from path segments
    this.clearPending();
    const tracks = this.buildTracksFromPath(result);
    if (tracks.length === 0) {
      EventBus.emit('completer:failed', { reason: 'curvature' });
      return;
    }

    this.pendingTracks = tracks;
    this.isAwaitingConfirm = true;
    this.drawGhostTracks(tracks);
    EventBus.emit('ui:toast', { message: 'Preview shown — press ENTER to confirm or ESC to cancel.', type: 'info' });
  }

  /**
   * Modified A* over direction/angle space.
   * Each node represents a point along the proposed path with a given heading.
   * The heuristic is straight-line Euclidean distance to the goal.
   * The cost accumulates length + curvature penalty.
   */
  private aStarSearch(
    from: Endpoint,
    to: Endpoint,
  ): Array<{ point: Phaser.Math.Vector2; angle: number }> | null {
    const budget = GameConfig.TOOLS.COMPLETER_SEARCH_BUDGET;
    const resolution = GameConfig.TOOLS.COMPLETER_SAMPLE_RESOLUTION;
    const maxBendRad = Phaser.Math.DegToRad(GameConfig.WORLD.MAX_CURVE_TOLERANCE_DEG);
    const goalRadius = 80;

    const start: SearchNode = {
      point: from.point.clone(),
      angle: Math.atan2(from.tangent.y, from.tangent.x),
      cost: 0,
      heuristic: from.point.distance(to.point),
      path: [],
    };

    const open: SearchNode[] = [start];
    let iterations = 0;

    while (open.length > 0 && iterations < budget) {
      iterations++;

      // Sort by cost + heuristic (priority queue via sort — acceptable for moderate budgets)
      open.sort((a, b) => (a.cost + a.heuristic) - (b.cost + b.heuristic));
      const current = open.shift()!;

      // Goal check
      if (current.point.distance(to.point) < goalRadius) {
        return [...current.path, { point: current.point, angle: current.angle }, { point: to.point.clone(), angle: Math.atan2(to.tangent.y, to.tangent.x) }];
      }

      // Expand in multiple heading offsets relative to current angle
      const angleOffsets = [-maxBendRad, -maxBendRad * 0.5, 0, maxBendRad * 0.5, maxBendRad];

      for (const offset of angleOffsets) {
        const newAngle = current.angle + offset;
        const bendCost = Math.abs(offset) * 2;

        const next: Phaser.Math.Vector2 = new Phaser.Math.Vector2(
          current.point.x + Math.cos(newAngle) * resolution,
          current.point.y + Math.sin(newAngle) * resolution,
        );

        // Check proximity collision with existing tracks
        if (this.collidesWithExistingTracks(next, 30)) continue;

        const newCost = current.cost + resolution + bendCost;
        const newHeuristic = next.distance(to.point);

        open.push({
          point: next,
          angle: newAngle,
          cost: newCost,
          heuristic: newHeuristic,
          path: [...current.path, { point: current.point, angle: current.angle }],
        });
      }
    }

    return null;
  }

  /**
   * Convert a path (sequence of points + angles) into one or more RailTrack
   * segments — each covering COMPLETER_SAMPLE_RESOLUTION * resolution steps.
   */
  private buildTracksFromPath(
    path: Array<{ point: Phaser.Math.Vector2; angle: number }>,
  ): RailTrack[] {
    const tracks: RailTrack[] = [];
    if (path.length < 2) return tracks;

    // Group path into segments of ~8 waypoints each
    const groupSize = 8;
    for (let i = 0; i < path.length - 1; i += groupSize) {
      const seg = path.slice(i, Math.min(i + groupSize + 1, path.length));
      if (seg.length < 2) break;

      const start = seg[0];
      const end = seg[seg.length - 1];
      const segLen = start.point.distance(end.point);
      const ctrl1 = new Phaser.Math.Vector2(
        start.point.x + Math.cos(start.angle) * segLen * 0.33,
        start.point.y + Math.sin(start.angle) * segLen * 0.33,
      );
      const ctrl2 = new Phaser.Math.Vector2(
        end.point.x - Math.cos(end.angle) * segLen * 0.33,
        end.point.y - Math.sin(end.angle) * segLen * 0.33,
      );

      const track = new RailTrack(
        this.scene,
        start.point.clone(),
        ctrl1,
        ctrl2,
        end.point.clone(),
      );
      tracks.push(track);
    }

    return tracks;
  }

  private commitPending(): void {
    const uuids: string[] = [];
    for (const track of this.pendingTracks) {
      // Terrain validation gate
      if (this.terrainValidator) {
        const p0 = new Phaser.Math.Vector2(track.getCurvePath().getStartPoint());
        const p3 = new Phaser.Math.Vector2(track.getCurvePath().getEndPoint());
        const result = this.terrainValidator.canPlaceTrack(p0, p3);
        if (!result.valid) {
          EventBus.emit('ui:toast', { message: result.reason, type: 'error' });
          this.clearPending();
          this.isAwaitingConfirm = false;
          this.ghostGraphics.clear();
          return;
        }
        track.isTunnel   = result.requiresTunnel;
        track.elevation  = result.averageElevation;
      }

      this.trackManager.addTrack(track);
      const def = this.trackToDef(track);
      WorldManager.addTrackDef(def);
      uuids.push(track.getUUID());
    }
    this.pendingTracks = [];
    EventBus.emit('completer:success', { trackUUIDs: uuids });
  }

  private clearPending(): void {
    for (const track of this.pendingTracks) {
      track.destroy();
    }
    this.pendingTracks = [];
  }

  // ── Open endpoint detection ────────────────────────────────────────────────

  private findNearestOpenEndpoint(world: Phaser.Math.Vector2, maxDist: number): Endpoint | null {
    let best: Endpoint | null = null;
    let bestDist = maxDist;

    for (const track of this.trackManager.tracks) {
      const startPt = new Phaser.Math.Vector2(track.getCurvePath().getStartPoint());
      const endPt = new Phaser.Math.Vector2(track.getCurvePath().getEndPoint());
      const startTangent = new Phaser.Math.Vector2(track.getCurvePath().getTangent(0));
      const endTangent = new Phaser.Math.Vector2(track.getCurvePath().getTangent(1));

      // An endpoint is "open" if the track has no previous (start) or no next (end) connection
      if (!track.hasPrevious()) {
        const d = world.distance(startPt);
        if (d < bestDist) {
          bestDist = d;
          best = { track, isStart: true, point: startPt, tangent: startTangent.scale(-1) };
        }
      }
      if (!track.hasNext()) {
        const d = world.distance(endPt);
        if (d < bestDist) {
          bestDist = d;
          best = { track, isStart: false, point: endPt, tangent: endTangent };
        }
      }
    }

    return best;
  }

  // ── Visualisation ──────────────────────────────────────────────────────────

  private drawOpenEndpoints(): void {
    this.endpointDots.clear();
    const alpha = 0.5 + 0.5 * Math.sin(this.pulseT * Math.PI * 2);

    for (const track of this.trackManager.tracks) {
      if (!track.hasPrevious()) {
        const pt = track.getCurvePath().getStartPoint();
        this.endpointDots.fillStyle(0x00ffff, alpha);
        this.endpointDots.fillCircle(pt.x, pt.y, 12);
      }
      if (!track.hasNext()) {
        const pt = track.getCurvePath().getEndPoint();
        this.endpointDots.fillStyle(0x00ffff, alpha);
        this.endpointDots.fillCircle(pt.x, pt.y, 12);
      }
    }
  }

  private drawGhostTracks(tracks: RailTrack[]): void {
    this.ghostGraphics.clear();
    this.ghostGraphics.lineStyle(4, 0x00ff88, GameConfig.TOOLS.GHOST_ALPHA);

    for (const track of tracks) {
      const curve = track.getCurvePath();
      const n = 20;
      this.ghostGraphics.beginPath();
      for (let i = 0; i <= n; i++) {
        const pt = curve.getPoint(i / n);
        if (i === 0) this.ghostGraphics.moveTo(pt.x, pt.y);
        else this.ghostGraphics.lineTo(pt.x, pt.y);
      }
      this.ghostGraphics.strokePath();
    }
  }

  // ── Collision detection ────────────────────────────────────────────────────

  private collidesWithExistingTracks(point: Phaser.Math.Vector2, threshold: number): boolean {
    for (const track of this.trackManager.tracks) {
      const curve = track.getCurvePath();
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const pt = curve.getPoint(i / n);
        if (point.distance(new Phaser.Math.Vector2(pt)) < threshold) return true;
      }
    }
    return false;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private screenToWorld(pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    return this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y) as Phaser.Math.Vector2;
  }

  private trackToDef(track: RailTrack): TrackDef {
    const curve = track.getCurvePath();
    const p0 = curve.getStartPoint();
    const p3 = curve.getEndPoint();
    const p1 = curve.getPoint(0.33);
    const p2 = curve.getPoint(0.67);
    return {
      uuid: track.getUUID(),
      p0: { x: p0.x, y: p0.y },
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      p3: { x: p3.x, y: p3.y },
      isTunnel: track.isTunnel || undefined,
      elevation: track.elevation || undefined,
    };
  }
}
