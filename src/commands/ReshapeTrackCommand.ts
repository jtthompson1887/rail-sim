import Phaser from 'phaser';
import type { Command } from '../systems/CommandStack';
import type { TrackDef } from '../config/WorldData';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';

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
  undo(): void { this.apply(this.beforeDef); }

  private apply(def: TrackDef): void {
    const track = this.trackManager.getTrack(this.uuid);
    if (!track) return;
    const p0 = new Phaser.Math.Vector2(def.p0.x, def.p0.y);
    const p1 = new Phaser.Math.Vector2(def.p1.x, def.p1.y);
    const p2 = new Phaser.Math.Vector2(def.p2.x, def.p2.y);
    const p3 = new Phaser.Math.Vector2(def.p3.x, def.p3.y);
    track.updateTrackVectors(p0, p1, p2, p3);
    WorldManager.updateTrackDef(def);
  }
}
