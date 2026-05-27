import Phaser from 'phaser';
import type { Command } from '../systems/CommandStack';
import type { TrackDef } from '../config/WorldData';
import RailTrack from '../entities/RailTrack';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import { TrackSerializer } from '../utils/TrackSerializer';

/** Remove one or more tracks from the world. */
export class DeleteTracksCommand implements Command {
  readonly description = 'Delete track(s)';
  private snapshots: TrackDef[];
  private uuids: string[];
  private trackManager: TrackManager;
  private scene: Phaser.Scene;

  constructor(trackManager: TrackManager, scene: Phaser.Scene, uuids: string[]) {
    this.trackManager = trackManager;
    this.scene = scene;
    this.uuids = uuids;
    // Snapshot definitions before deletion
    this.snapshots = [];
    for (const uuid of uuids) {
      const track = trackManager.getTrack(uuid);
      if (!track) continue;
      this.snapshots.push(TrackSerializer.toTrackDef(track));
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
      const p0 = new Phaser.Math.Vector2(def.p0.x, def.p0.y);
      const p1 = new Phaser.Math.Vector2(def.p1.x, def.p1.y);
      const p2 = new Phaser.Math.Vector2(def.p2.x, def.p2.y);
      const p3 = new Phaser.Math.Vector2(def.p3.x, def.p3.y);
      const track = new RailTrack(this.scene, p0, p1, p2, p3);
      track.setUUID(def.uuid);
      if (def.isTunnel) track.isTunnel = def.isTunnel;
      if (def.elevation) track.elevation = def.elevation;
      this.trackManager.addTrack(track);
      WorldManager.addTrackDef(def);
    }
  }
}
