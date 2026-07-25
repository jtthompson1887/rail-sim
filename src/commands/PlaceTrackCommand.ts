import Phaser from 'phaser';
import type { TrackDef, WorldData } from '../config/WorldData';
import RailTrack from '../entities/RailTrack';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import type {
  CommandRevisionContext,
  RevisionAwareCommand,
} from '../systems/CommandStack';
import {
  ConstructionEconomy,
  type ConstructionTransaction,
} from '../systems/ConstructionEconomy';
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
  private transaction: ConstructionTransaction | null = null;
  private applied = false;
  private expectedRevision: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trackManager: TrackManager,
    private readonly economy: ConstructionEconomy,
    private readonly constructionService: ConstructionService,
    readonly quote: ConstructionQuote,
    private readonly injectFailure?: PlaceTrackFailureInjector,
  ) {
    this.def = trackDefFromQuote(quote);
    this.worldIdentity = WorldManager.world;
    this.expectedRevision = quote.worldRevision;
  }

  getRevisionContext(): CommandRevisionContext | null {
    return this.worldIdentity
      ? { authority: this.worldIdentity, revision: this.expectedRevision }
      : null;
  }

  rebaseRevisionContext(context: CommandRevisionContext): boolean {
    if (context.authority !== this.worldIdentity
      || !Number.isSafeInteger(context.revision)
      || context.revision < 0) return false;
    this.expectedRevision = context.revision;
    return true;
  }

  execute(): boolean {
    if (this.applied) return false;
    if (!WorldManager.world
      || WorldManager.world !== this.worldIdentity
      || WorldManager.world.revision !== this.expectedRevision
      || !this.economy.isBoundTo(WorldManager.world.company)) return false;
    const isRedo = this.transaction !== null;
    const valid = isRedo
      ? this.constructionService.revalidateQuoteForRedo(
        this.quote,
        this.transaction!.beforeCash,
      )
      : this.constructionService.revalidateQuote(this.quote);
    if (!valid) return false;

    let debited = false;
    let liveAdded = false;
    let createdTrack: RailTrack | null = null;
    let transaction: ConstructionTransaction | null = this.transaction;
    try {
      if (transaction) {
        if (!this.economy.reapply(transaction)) return false;
      } else {
        transaction = this.economy.purchase(this.quote.totalCost);
        if (!transaction) return false;
      }
      debited = true;
      this.injectFailure?.('after-debit');

      createdTrack = railTrackFromDef(this.scene, this.def);
      this.trackManager.addTrack(createdTrack);
      liveAdded = true;
      this.injectFailure?.('after-live-track');

      const committed = WorldManager.applyConstructionBatch(
        this.expectedRevision,
        (draft) => {
          if (!draft.addTrack(this.def)) return false;
          this.injectFailure?.('after-world-def');
          return true;
        },
      );
      if (!committed) throw new Error('persisted track transaction failed');
      this.expectedRevision += 1;
      this.transaction = transaction;
      this.applied = true;
      return true;
    } catch {
      if (liveAdded) this.trackManager.removeTrack(this.def.uuid);
      else createdTrack?.destroy();
      if (debited && transaction) this.economy.reverse(transaction);
      if (!isRedo) this.transaction = null;
      return false;
    }
  }

  undo(): boolean {
    const transaction = this.transaction;
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
    if (!this.applied || !transaction || !world || !live
      || world.revision !== this.expectedRevision
      || !this.economy.isBoundTo(world.company)
      || !equalPlainData(persisted, this.def)
      || !liveMatches
      || !WorldManager.canAdvanceRevision()) return false;

    let liveRemoved = false;
    let cashRestored = false;
    try {
      if (!this.trackManager.removeTrack(this.def.uuid)) return false;
      liveRemoved = true;
      this.injectFailure?.('undo-after-live-track');

      if (!this.economy.reverse(transaction)) {
        throw new Error('cash reversal failed');
      }
      cashRestored = true;
      this.injectFailure?.('undo-after-refund');

      const committed = WorldManager.applyConstructionBatch(
        this.expectedRevision,
        (draft) => {
          if (!draft.removeTrack(this.def.uuid)) return false;
          this.injectFailure?.('undo-after-world-def');
          return true;
        },
      );
      if (!committed) throw new Error('persisted track transaction failed');
      this.expectedRevision += 1;
      this.applied = false;
      return true;
    } catch {
      if (cashRestored) this.economy.reapply(transaction);
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
