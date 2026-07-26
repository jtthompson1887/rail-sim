import type {
  CommandRevisionContext,
  RevisionAwareCommand,
} from '../systems/CommandStack';
import type { TrackDef, WorldData } from '../config/WorldData';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';

/** Reshape a track by updating its four Bézier control points. */
export class ReshapeTrackCommand implements RevisionAwareCommand {
  readonly description = 'Reshape track';
  private trackManager: TrackManager;
  private uuid: string;
  private beforeDef: TrackDef;
  private afterDef: TrackDef;
  private readonly worldIdentity: WorldData | null;
  private expectedRootRevision: number;
  private expectedConstructionRevision: number;

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
    this.worldIdentity = WorldManager.world;
    this.expectedRootRevision = this.worldIdentity?.revision ?? -1;
    this.expectedConstructionRevision =
      this.worldIdentity?.constructionRevision ?? -1;
  }

  getRevisionContext(): CommandRevisionContext | null {
    return this.worldIdentity
      ? {
          authority: this.worldIdentity,
          rootRevision: this.expectedRootRevision,
          constructionRevision: this.expectedConstructionRevision,
        }
      : null;
  }

  rebaseRevisionContext(context: CommandRevisionContext): boolean {
    if (context.authority !== this.worldIdentity
      || !Number.isSafeInteger(context.rootRevision)
      || context.rootRevision < 0
      || !Number.isSafeInteger(context.constructionRevision)
      || context.constructionRevision < 0) return false;
    this.expectedRootRevision = context.rootRevision;
    this.expectedConstructionRevision = context.constructionRevision;
    return true;
  }

  execute(): boolean { return this.apply(this.afterDef); }
  undo(): boolean { return this.apply(this.beforeDef); }

  private apply(def: TrackDef): boolean {
    const track = this.trackManager.getTrack(this.uuid);
    if (!track || WorldManager.world !== this.worldIdentity
      || WorldManager.world?.revision !== this.expectedRootRevision
      || WorldManager.world?.constructionRevision
        !== this.expectedConstructionRevision
      || !WorldManager.canAdvanceRevision()) return false;
    const current = WorldManager.world!.tracks.find((item) => item.uuid === this.uuid);
    if (!current || !this.trackManager.applyTrackDef(def)) return false;
    if (WorldManager.world !== this.worldIdentity
      || WorldManager.world.revision !== this.expectedRootRevision
      || WorldManager.world.constructionRevision
        !== this.expectedConstructionRevision) {
      this.trackManager.applyTrackDef(current);
      return false;
    }
    if (!WorldManager.applyConstructionBatch(
      this.expectedConstructionRevision,
      (draft) => draft.updateTrack(def),
    )) {
      this.trackManager.applyTrackDef(current);
      return false;
    }
    this.expectedRootRevision += 1;
    this.expectedConstructionRevision += 1;
    return true;
  }
}
