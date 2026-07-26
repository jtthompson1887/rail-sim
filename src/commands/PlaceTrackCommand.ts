import Phaser from 'phaser';
import type { TrackDef, WorldData } from '../config/WorldData';
import RailTrack from '../entities/RailTrack';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import type {
  CommandRevisionContext,
  RevisionAwareCommand,
} from '../systems/CommandStack';
import { applyConstructionTransaction } from '../systems/ConstructionEconomy';
import {
  ConstructionService,
  type ConstructionQuote,
} from '../systems/ConstructionService';
import { TrackSerializer } from '../utils/TrackSerializer';
import { clonePlainData, equalPlainData } from '../utils/PlainData';

export type PlaceTrackCommitStage =
  | 'after-debit'
  | 'after-live-track'
  | 'after-world-def'
  | 'undo-after-live-track'
  | 'undo-after-world-def'
  | 'undo-after-refund';

export type PlaceTrackFailureInjector = (stage: PlaceTrackCommitStage) => void;

function trackDefFromQuote(quote: ConstructionQuote): TrackDef {
  return {
    uuid: quote.newTrackUUID,
    ...clonePlainData(quote.proposal.geometry),
    verticalProfile: clonePlainData(quote.proposal.verticalProfile),
    structures: clonePlainData(quote.proposal.structures),
    paidBuildCost: quote.totalCost,
  };
}

function railTrackFromDef(scene: Phaser.Scene, def: TrackDef): RailTrack {
  const track = new RailTrack(
    scene,
    new Phaser.Math.Vector2(def.p0.x, def.p0.y),
    new Phaser.Math.Vector2(def.p1.x, def.p1.y),
    new Phaser.Math.Vector2(def.p2.x, def.p2.y),
    new Phaser.Math.Vector2(def.p3.x, def.p3.y),
  );
  track.setUUID(def.uuid);
  track.setConstructionData(
    clonePlainData(def.verticalProfile),
    clonePlainData(def.structures),
    def.paidBuildCost,
  );
  return track;
}

/** Atomically commits one immutable construction quote across graph, world, and cash. */
export class PlaceTrackCommand implements RevisionAwareCommand {
  readonly description = 'Place track';
  private readonly def: TrackDef;
  private readonly worldIdentity: WorldData | null;
  private forwardEntryId: number | null = null;
  private applied = false;
  private expectedRootRevision: number;
  private expectedConstructionRevision: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trackManager: TrackManager,
    private readonly constructionService: ConstructionService,
    readonly quote: ConstructionQuote,
    private readonly injectFailure?: PlaceTrackFailureInjector,
  ) {
    this.def = trackDefFromQuote(quote);
    this.worldIdentity = WorldManager.world;
    this.expectedRootRevision = quote.rootRevision;
    this.expectedConstructionRevision = quote.constructionRevision;
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

  execute(): boolean {
    if (this.applied) return false;
    if (!WorldManager.world
      || WorldManager.world !== this.worldIdentity
      || WorldManager.world.revision !== this.expectedRootRevision
      || WorldManager.world.constructionRevision
        !== this.expectedConstructionRevision) return false;
    const isRedo = this.forwardEntryId !== null;
    const valid = isRedo
      ? this.constructionService.revalidateQuoteForRedo(
        this.quote,
        this.quote.expectedCash,
        this.expectedRootRevision,
        this.expectedConstructionRevision,
      )
      : this.constructionService.revalidateQuote(this.quote);
    if (!valid) return false;

    let liveAdded = false;
    let createdTrack: RailTrack | null = null;
    let postedEntryId = 0;
    try {
      createdTrack = railTrackFromDef(this.scene, this.def);
      this.trackManager.addTrack(createdTrack);
      liveAdded = true;
      this.injectFailure?.('after-live-track');
      if (WorldManager.world !== this.worldIdentity
        || WorldManager.world.revision !== this.expectedRootRevision
        || WorldManager.world.constructionRevision
          !== this.expectedConstructionRevision) {
        throw new Error('construction cursor changed before commit');
      }

      const committed = WorldManager.applyConstructionBatch(
        this.expectedConstructionRevision,
        (draft) => {
          if (!draft.addTrack(this.def)) return false;
          this.injectFailure?.('after-world-def');
          const transaction = applyConstructionTransaction(
            draft.company,
            {
              kind: 'purchase',
              magnitude: this.quote.totalCost,
              referenceId: this.def.uuid,
              direction: 'forward',
            },
            draft.economyTick,
          );
          if (transaction.ok === false) return false;
          draft.company = transaction.company;
          postedEntryId = transaction.entry.id;
          this.injectFailure?.('after-debit');
          return true;
        },
      );
      if (!committed) throw new Error('persisted track transaction failed');
      this.expectedRootRevision += 1;
      this.expectedConstructionRevision += 1;
      this.forwardEntryId = postedEntryId;
      this.applied = true;
      return true;
    } catch {
      if (liveAdded) this.trackManager.removeTrack(this.def.uuid);
      else createdTrack?.destroy();
      return false;
    }
  }

  undo(): boolean {
    const forwardEntryId = this.forwardEntryId;
    const world = WorldManager.world;
    const live = this.trackManager.getTrack(this.def.uuid);
    const persisted = world?.tracks.find((track) => track.uuid === this.def.uuid);
    let liveMatches = false;
    try {
      liveMatches = !!live
        && equalPlainData(TrackSerializer.toTrackDef(live), this.def);
    } catch {
      liveMatches = false;
    }
    if (!this.applied || forwardEntryId === null || !world
      || world !== this.worldIdentity || !live
      || world.revision !== this.expectedRootRevision
      || world.constructionRevision !== this.expectedConstructionRevision
      || !equalPlainData(persisted, this.def)
      || !liveMatches
      || !WorldManager.canAdvanceRevision()) return false;

    let liveRemoved = false;
    try {
      if (!this.trackManager.removeTrack(this.def.uuid)) return false;
      liveRemoved = true;
      this.injectFailure?.('undo-after-live-track');
      if (WorldManager.world !== this.worldIdentity
        || WorldManager.world.revision !== this.expectedRootRevision
        || WorldManager.world.constructionRevision
          !== this.expectedConstructionRevision) {
        throw new Error('construction cursor changed before undo commit');
      }

      const committed = WorldManager.applyConstructionBatch(
        this.expectedConstructionRevision,
        (draft) => {
          if (!draft.removeTrack(this.def.uuid)) return false;
          this.injectFailure?.('undo-after-world-def');
          const transaction = applyConstructionTransaction(
            draft.company,
            {
              kind: 'purchase',
              magnitude: this.quote.totalCost,
              referenceId: this.def.uuid,
              direction: 'reversal',
              reversalOf: forwardEntryId,
            },
            draft.economyTick,
          );
          if (transaction.ok === false) return false;
          draft.company = transaction.company;
          this.injectFailure?.('undo-after-refund');
          return true;
        },
      );
      if (!committed) throw new Error('persisted track transaction failed');
      this.expectedRootRevision += 1;
      this.expectedConstructionRevision += 1;
      this.applied = false;
      return true;
    } catch {
      if (liveRemoved) {
        try {
          this.trackManager.addTrack(railTrackFromDef(this.scene, this.def));
        } catch {
          // The complete before-state remains authoritative; duplicate recovery
          // is impossible only if an unexpected external mutation raced us.
        }
      }
      return false;
    }
  }
}
