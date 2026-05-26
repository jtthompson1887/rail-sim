/**
 * CommandStack – incremental undo/redo without scene restarts.
 *
 * Every editor operation (place track, delete track, reshape endpoint, etc.)
 * is wrapped in a Command object and pushed onto the stack.  Undo walks back
 * through the stack; redo replays forward.
 */

export interface Command {
  /** Human-readable label (shown in UI / used for debugging). */
  readonly description: string;
  /** Apply the operation (called once when the command is first committed). */
  execute(): void;
  /** Reverse the operation. */
  undo(): void;
}

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  readonly maxDepth: number;

  /** Called whenever the stack changes so callers can update UI. */
  onChange?: (canUndo: boolean, canRedo: boolean) => void;

  constructor(maxDepth = 50) {
    this.maxDepth = maxDepth;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /**
   * Execute a command and push it onto the undo stack.
   * Clears the redo stack (standard linear undo model).
   */
  push(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
    this.notify();
  }

  /**
   * Record a command that has already been executed (e.g. by live drag) without
   * calling `execute()` again.  Clears the redo stack.
   */
  record(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  /** Clear both stacks (e.g. when loading a new world). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  private notify(): void {
    this.onChange?.(this.canUndo, this.canRedo);
  }
}

// ── Concrete commands ──────────────────────────────────────────────────────

import RailTrack from '../entities/RailTrack';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import type { TrackDef } from '../config/WorldData';

/** Remove one or more tracks from the world. */
export class DeleteTracksCommand implements Command {
  readonly description = 'Delete track(s)';
  private snapshots: TrackDef[];
  private uuids: string[];
  private trackManager: TrackManager;

  constructor(trackManager: TrackManager, uuids: string[]) {
    this.trackManager = trackManager;
    this.uuids = uuids;
    // Snapshot definitions before deletion
    this.snapshots = [];
    for (const uuid of uuids) {
      const track = trackManager.getTrack(uuid);
      if (!track) continue;
      const curve = track.getCurvePath();
      const p0 = curve.getStartPoint();
      const p3 = curve.getEndPoint();
      const p1 = curve.getPoint(0.33);
      const p2 = curve.getPoint(0.67);
      this.snapshots.push({
        uuid,
        p0: { x: p0.x, y: p0.y },
        p1: { x: p1.x, y: p1.y },
        p2: { x: p2.x, y: p2.y },
        p3: { x: p3.x, y: p3.y },
        isTunnel: track.isTunnel,
        elevation: track.elevation,
      } as TrackDef);
    }
  }

  execute(): void {
    for (const uuid of this.uuids) {
      this.trackManager.removeTrack(uuid);
      WorldManager.removeTrackDef(uuid);
    }
  }

  undo(): void {
    for (const def of this.snapshots) {
      const Phaser = (globalThis as any).Phaser;
      const p0 = Phaser ? new Phaser.Math.Vector2(def.p0.x, def.p0.y) : def.p0;
      const p1 = Phaser ? new Phaser.Math.Vector2(def.p1.x, def.p1.y) : def.p1;
      const p2 = Phaser ? new Phaser.Math.Vector2(def.p2.x, def.p2.y) : def.p2;
      const p3 = Phaser ? new Phaser.Math.Vector2(def.p3.x, def.p3.y) : def.p3;
      const scene = this.trackManager['scene'] as Phaser.Scene;
      const track = new RailTrack(scene, p0, p1, p2, p3);
      (track as any).uuid = def.uuid;
      if (def.isTunnel)  track.isTunnel  = def.isTunnel;
      if (def.elevation) track.elevation = def.elevation;
      this.trackManager.addTrack(track);
      WorldManager.addTrackDef(def);
    }
  }
}

/** Reshape a track by updating its four Bézier control points. */
export class ReshapeTrackCommand implements Command {
  readonly description = 'Reshape track';
  private trackManager: TrackManager;
  private uuid: string;
  private beforeDef: TrackDef;
  private afterDef: TrackDef;

  constructor(
    trackManager: TrackManager,
    uuid: string,
    before: TrackDef,
    after: TrackDef,
  ) {
    this.trackManager = trackManager;
    this.uuid = uuid;
    this.beforeDef = before;
    this.afterDef = after;
  }

  execute(): void { this.apply(this.afterDef); }
  undo():    void { this.apply(this.beforeDef); }

  private apply(def: TrackDef): void {
    const Phaser = (globalThis as any).Phaser;
    const track = this.trackManager.getTrack(this.uuid);
    if (!track) return;
    const mkV2 = (p: { x: number; y: number }) =>
      Phaser ? new Phaser.Math.Vector2(p.x, p.y) : p;
    track.updateTrackVectors(mkV2(def.p0), mkV2(def.p1), mkV2(def.p2), mkV2(def.p3));
    WorldManager.updateTrackDef(def);
  }
}
