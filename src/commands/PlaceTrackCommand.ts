import Phaser from 'phaser';
import type { TrackDef } from '../config/WorldData';
import RailTrack from '../entities/RailTrack';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import type { Command } from '../systems/CommandStack';
import {
  ConstructionEconomy,
  type ConstructionTransaction,
} from '../systems/ConstructionEconomy';
import {
  ConstructionService,
  type ConstructionQuote,
} from '../systems/ConstructionService';
import { TrackSerializer } from '../utils/TrackSerializer';

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
    ...JSON.parse(JSON.stringify(quote.proposal.geometry)),
    verticalProfile: JSON.parse(JSON.stringify(quote.proposal.verticalProfile)),
    structures: JSON.parse(JSON.stringify(quote.proposal.structures)),
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
    JSON.parse(JSON.stringify(def.verticalProfile)),
    JSON.parse(JSON.stringify(def.structures)),
    def.paidBuildCost,
  );
  return track;
}

/** Atomically commits one immutable construction quote across graph, world, and cash. */
export class PlaceTrackCommand implements Command {
  readonly description = 'Place track';
  private readonly def: TrackDef;
  private transaction: ConstructionTransaction | null = null;
  private applied = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trackManager: TrackManager,
    private readonly economy: ConstructionEconomy,
    private readonly constructionService: ConstructionService,
    readonly quote: ConstructionQuote,
    private readonly injectFailure?: PlaceTrackFailureInjector,
  ) {
    this.def = trackDefFromQuote(quote);
  }

  execute(): boolean {
    if (this.applied) return false;
    if (!WorldManager.world
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
    let worldAdded = false;
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

      if (!WorldManager.addTrackDef(this.def, false)) {
        throw new Error('persisted track insertion failed');
      }
      worldAdded = true;
      this.injectFailure?.('after-world-def');

      if (!WorldManager.advanceRevision()) {
        throw new Error('world revision advance failed');
      }
      this.transaction = transaction;
      this.applied = true;
      return true;
    } catch {
      if (worldAdded) WorldManager.removeTrackDef(this.def.uuid, false);
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
        && JSON.stringify(TrackSerializer.toTrackDef(live)) === JSON.stringify(this.def);
    } catch {
      liveMatches = false;
    }
    if (!this.applied || !transaction || !world || !live
      || !this.economy.isBoundTo(world.company)
      || JSON.stringify(persisted) !== JSON.stringify(this.def)
      || !liveMatches
      || !WorldManager.canAdvanceRevision()) return false;

    let liveRemoved = false;
    let worldRemoved = false;
    let cashRestored = false;
    try {
      if (!this.trackManager.removeTrack(this.def.uuid)) return false;
      liveRemoved = true;
      this.injectFailure?.('undo-after-live-track');

      if (!WorldManager.removeTrackDef(this.def.uuid, false)) {
        throw new Error('persisted track removal failed');
      }
      worldRemoved = true;
      this.injectFailure?.('undo-after-world-def');

      if (!this.economy.reverse(transaction)) {
        throw new Error('cash reversal failed');
      }
      cashRestored = true;
      this.injectFailure?.('undo-after-refund');

      if (!WorldManager.advanceRevision()) {
        throw new Error('world revision advance failed');
      }
      this.applied = false;
      return true;
    } catch {
      if (cashRestored) this.economy.reapply(transaction);
      if (worldRemoved) WorldManager.addTrackDef(this.def, false);
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
