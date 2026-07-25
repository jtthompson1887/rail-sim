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
  private expectedRevision: number;

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
    this.expectedRevision = WorldManager.world?.revision ?? -1;
  }

  execute(): boolean { return this.apply(this.afterDef); }
  undo(): boolean { return this.apply(this.beforeDef); }

  private apply(def: TrackDef): boolean {
    const track = this.trackManager.getTrack(this.uuid);
    if (!track || WorldManager.world?.revision !== this.expectedRevision
      || !WorldManager.canAdvanceRevision()) return false;
    const current = WorldManager.world!.tracks.find((item) => item.uuid === this.uuid);
    if (!current || !this.trackManager.applyTrackDef(def)) return false;
    if (!WorldManager.applyConstructionBatch(
      this.expectedRevision,
      (draft) => draft.updateTrack(def),
    )) {
      this.trackManager.applyTrackDef(current);
      return false;
    }
    this.expectedRevision += 1;
    return true;
  }
}
