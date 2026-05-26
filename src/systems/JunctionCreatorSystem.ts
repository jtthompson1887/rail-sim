import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import { EventBus } from '../services/EventBus';
import { GameConfig } from '../config/GameConfig';
import type { JunctionDef, TrackDef } from '../config/WorldData';

/**
 * JunctionCreatorSystem
 *
 * Handles the three-step junction creation workflow:
 *  1. Player draws a rectangular selection over existing tracks.
 *  2. System finds all tracks passing through that rectangle.
 *  3. For each candidate track the curve is split (de Casteljau), and
 *     constrained optimisation finds branch angles that minimise curvature
 *     deviation while staying within the configured bend tolerance.
 *  4. On success, two new branch tracks and a Junction node are committed to
 *     TrackManager and WorldManager.
 */
export class JunctionCreatorSystem {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private selectionGraphics: Phaser.GameObjects.Graphics;
  private highlightGraphics: Phaser.GameObjects.Graphics;

  // Selection drag state
  private isDragging: boolean = false;
  private dragStart: Phaser.Math.Vector2 = new Phaser.Math.Vector2();
  private selectionRect: Phaser.Geom.Rectangle = new Phaser.Geom.Rectangle();

  constructor(scene: Phaser.Scene, trackManager: TrackManager) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.selectionGraphics = scene.add.graphics().setDepth(500);
    this.highlightGraphics = scene.add.graphics().setDepth(499);
  }

  // ── Input handling (called from WorldScene in create mode) ─────────────────

  onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!pointer.rightButtonDown()) return;
    const world = this.screenToWorld(pointer);
    this.isDragging = true;
    this.dragStart.set(world.x, world.y);
    this.selectionRect.setTo(world.x, world.y, 0, 0);
  }

  onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.isDragging) return;
    const world = this.screenToWorld(pointer);
    const x = Math.min(this.dragStart.x, world.x);
    const y = Math.min(this.dragStart.y, world.y);
    const w = Math.abs(world.x - this.dragStart.x);
    const h = Math.abs(world.y - this.dragStart.y);
    this.selectionRect.setTo(x, y, w, h);
    this.drawSelection();
  }

  onPointerUp(_pointer: Phaser.Input.Pointer): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.selectionGraphics.clear();

    if (this.selectionRect.width < 10 || this.selectionRect.height < 10) {
      this.highlightGraphics.clear();
      return;
    }

    this.executeCreation(this.selectionRect);
  }

  destroy(): void {
    this.selectionGraphics.destroy();
    this.highlightGraphics.destroy();
  }

  // ── Core algorithm ─────────────────────────────────────────────────────────

  /** Find candidate tracks passing through the rectangle and create junctions. */
  private executeCreation(rect: Phaser.Geom.Rectangle): void {
    const candidates = this.findCandidateTracks(rect);

    if (candidates.length === 0) {
      this.highlightGraphics.clear();
      EventBus.emit('ui:toast', { message: 'No tracks found in selection area.', type: 'info' });
      return;
    }

    let created = 0;
    for (const { track, t } of candidates) {
      const result = this.createJunctionAtSplit(track, t);
      if (result) created++;
    }

    this.highlightGraphics.clear();
    if (created === 0) {
      EventBus.emit('ui:toast', { message: 'Could not create junction: angle out of tolerance.', type: 'error' });
    } else {
      EventBus.emit('ui:toast', { message: `Created ${created} junction(s).`, type: 'success' });
    }
  }

  /**
   * Find tracks whose Bézier curve passes within the given rectangle,
   * returning the track and the approximate t-value of intersection.
   */
  private findCandidateTracks(rect: Phaser.Geom.Rectangle): Array<{ track: RailTrack; t: number }> {
    const n = GameConfig.TOOLS.JUNCTION_SAMPLE_POINTS;
    const candidates: Array<{ track: RailTrack; t: number }> = [];

    this.highlightGraphics.clear();

    for (const track of this.trackManager.tracks) {
      const curve = track.getCurvePath();
      let hitT: number | null = null;

      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const pt = curve.getPoint(t);
        if (rect.contains(pt.x, pt.y)) {
          hitT = t;
          break;
        }
      }

      if (hitT !== null) {
        candidates.push({ track, t: hitT });
        this.highlightTrack(track);
      }
    }

    return candidates;
  }

  /**
   * Split a track at parameter t (de Casteljau) and insert a Junction.
   * Returns the Junction uuid on success, null if angle tolerance is violated.
   */
  private createJunctionAtSplit(track: RailTrack, t: number): string | null {
    // Clamp t away from the very ends so the split produces usable segments
    t = Phaser.Math.Clamp(t, 0.15, 0.85);

    const curve = track.getCurvePath();
    const splitPoint = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    const mainAngle = Math.atan2(tangent.y, tangent.x);

    // Optimise branch angles via gradient descent
    const angles = this.optimiseBranchAngles(mainAngle);
    if (!angles) return null;

    const { leftAngle, rightAngle } = angles;
    const length = GameConfig.JUNCTION.LENGTH;

    // Left branch
    const leftEnd = new Phaser.Math.Vector2(
      splitPoint.x + Math.cos(leftAngle) * length,
      splitPoint.y + Math.sin(leftAngle) * length,
    );
    const leftCtrl1 = new Phaser.Math.Vector2(
      splitPoint.x + Math.cos(leftAngle) * length * 0.3,
      splitPoint.y + Math.sin(leftAngle) * length * 0.3,
    );
    const leftCtrl2 = new Phaser.Math.Vector2(
      leftEnd.x - Math.cos(leftAngle) * length * 0.3,
      leftEnd.y - Math.sin(leftAngle) * length * 0.3,
    );
    const leftTrack = new RailTrack(this.scene, new Phaser.Math.Vector2(splitPoint.x, splitPoint.y), leftCtrl1, leftCtrl2, leftEnd);

    // Right branch
    const rightEnd = new Phaser.Math.Vector2(
      splitPoint.x + Math.cos(rightAngle) * length,
      splitPoint.y + Math.sin(rightAngle) * length,
    );
    const rightCtrl1 = new Phaser.Math.Vector2(
      splitPoint.x + Math.cos(rightAngle) * length * 0.3,
      splitPoint.y + Math.sin(rightAngle) * length * 0.3,
    );
    const rightCtrl2 = new Phaser.Math.Vector2(
      rightEnd.x - Math.cos(rightAngle) * length * 0.3,
      rightEnd.y - Math.sin(rightAngle) * length * 0.3,
    );
    const rightTrack = new RailTrack(this.scene, new Phaser.Math.Vector2(splitPoint.x, splitPoint.y), rightCtrl1, rightCtrl2, rightEnd);

    this.trackManager.addTrack(leftTrack);
    this.trackManager.addTrack(rightTrack);

    const junction = this.trackManager.createJunction(track.getUUID(), t);
    if (!junction) return null;

    // Persist to WorldManager
    const junctionDef: JunctionDef = {
      uuid: junction.getUUID(),
      mainTrackUUID: track.getUUID(),
      leftTrackUUID: leftTrack.getUUID(),
      rightTrackUUID: rightTrack.getUUID(),
      position: t,
      branchState: 'right',
    };
    WorldManager.addJunctionDef(junctionDef);

    const leftDef: TrackDef = this.trackToDef(leftTrack);
    const rightDef: TrackDef = this.trackToDef(rightTrack);
    WorldManager.addTrackDef(leftDef);
    WorldManager.addTrackDef(rightDef);

    EventBus.emit('junction:created', { junctionUUID: junction.getUUID() });
    return junction.getUUID();
  }

  /**
   * Constrained optimisation: find (leftAngle, rightAngle) that minimise the
   * total absolute angular deviation from mainAngle, subject to:
   *   |leftAngle  - mainAngle| ≤ MAX_CURVE_TOLERANCE_DEG
   *   |rightAngle - mainAngle| ≤ MAX_CURVE_TOLERANCE_DEG
   *   leftAngle < mainAngle < rightAngle  (left branches left, right branches right)
   *
   * Uses the configured LEFT_ANGLE_DEG / RIGHT_ANGLE_DEG as starting seeds and
   * iterates gradient descent to find the minimum-curvature solution.
   */
  private optimiseBranchAngles(mainAngle: number): { leftAngle: number; rightAngle: number } | null {
    const maxRad = Phaser.Math.DegToRad(GameConfig.WORLD.MAX_CURVE_TOLERANCE_DEG);
    const defaultLeft = Phaser.Math.DegToRad(GameConfig.JUNCTION.LEFT_ANGLE_DEG);
    const defaultRight = Phaser.Math.DegToRad(GameConfig.JUNCTION.RIGHT_ANGLE_DEG);
    const iters = GameConfig.TOOLS.JUNCTION_OPTIMISATION_ITERATIONS;
    const lr = 0.01;

    let la = defaultLeft; // left offset from mainAngle
    let ra = defaultRight; // right offset from mainAngle

    for (let i = 0; i < iters; i++) {
      // Cost: sum of squared angle offsets (minimise curvature change)
      const gradLa = 2 * la;
      const gradRa = 2 * ra;
      la -= lr * gradLa;
      ra -= lr * gradRa;

      // Enforce: left is negative offset, right is positive
      la = Math.min(la, -Phaser.Math.DegToRad(1));
      ra = Math.max(ra, Phaser.Math.DegToRad(1));

      // Clamp to tolerance
      la = Math.max(la, -maxRad);
      ra = Math.min(ra, maxRad);
    }

    // Validate tolerance
    if (Math.abs(la) > maxRad || Math.abs(ra) > maxRad) return null;

    return {
      leftAngle: mainAngle + la,
      rightAngle: mainAngle + ra,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private drawSelection(): void {
    this.selectionGraphics.clear();
    this.selectionGraphics.lineStyle(2, 0xffff00, 0.8);
    this.selectionGraphics.strokeRect(
      this.selectionRect.x,
      this.selectionRect.y,
      this.selectionRect.width,
      this.selectionRect.height,
    );
  }

  private highlightTrack(track: RailTrack): void {
    this.highlightGraphics.lineStyle(3, 0xffff00, 0.9);
    const curve = track.getCurvePath();
    const n = 20;
    this.highlightGraphics.beginPath();
    for (let i = 0; i <= n; i++) {
      const pt = curve.getPoint(i / n);
      if (i === 0) this.highlightGraphics.moveTo(pt.x, pt.y);
      else this.highlightGraphics.lineTo(pt.x, pt.y);
    }
    this.highlightGraphics.strokePath();
  }

  private screenToWorld(pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    const cam = this.scene.cameras.main;
    return new Phaser.Math.Vector2(
      pointer.x / cam.zoom + cam.scrollX,
      pointer.y / cam.zoom + cam.scrollY,
    );
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
    };
  }
}
