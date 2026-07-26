import Phaser from 'phaser';
import type {
  CommandRevisionContext,
  RevisionAwareCommand,
} from '../systems/CommandStack';
import type { JunctionDef, TrackDef, WorldData } from '../config/WorldData';
import Junction from '../entities/Junction';
import RailTrack from '../entities/RailTrack';
import TrackManager, {
  type TrackTopologySnapshot,
} from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import {
  applyConstructionTransaction,
  demolitionRefund,
} from '../systems/ConstructionEconomy';
import { TrackSerializer } from '../utils/TrackSerializer';
import { clonePlainData, equalPlainData } from '../utils/PlainData';

export type DeleteTracksStage =
  | 'after-live-removal'
  | 'after-draft-removal'
  | 'after-live-restore'
  | 'after-draft-restore';

export type DeleteTracksFailureInjector = (stage: DeleteTracksStage) => void;

interface IndexedTrackDef {
  index: number;
  def: TrackDef;
}

interface IndexedJunctionDef {
  index: number;
  def: JunctionDef;
}

interface RefundRecord {
  snapshotIndex: number;
  forwardEntryId: number;
  magnitude: number;
}

function restoreTrack(scene: Phaser.Scene, def: TrackDef): RailTrack {
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

/** Remove tracks as one reversible demolition lifecycle with per-track refunds. */
export class DeleteTracksCommand implements RevisionAwareCommand {
  readonly description = 'Delete track(s)';
  private readonly uuids: string[];
  private readonly snapshots: IndexedTrackDef[];
  private readonly junctionSnapshots: IndexedJunctionDef[];
  private readonly worldIdentity: WorldData | null;
  private readonly worldTracksBefore: TrackDef[];
  private readonly worldJunctionsBefore: JunctionDef[];
  private readonly worldTracksAfter: TrackDef[];
  private readonly worldJunctionsAfter: JunctionDef[];
  private readonly topologyBefore: TrackTopologySnapshot;
  private readonly junctionBranchStates = new Map<string, 'left' | 'right'>();
  private transactions: RefundRecord[] | null = null;
  private topologyAfter: TrackTopologySnapshot | null = null;
  private applied = false;
  private expectedConstructionRevision: number;

  constructor(
    private readonly trackManager: TrackManager,
    private readonly scene: Phaser.Scene,
    uuids: string[],
    private readonly injectFailure?: DeleteTracksFailureInjector,
  ) {
    this.uuids = Array.from(new Set(uuids));
    const world = WorldManager.world;
    this.worldIdentity = world;
    this.expectedConstructionRevision = world?.constructionRevision ?? -1;
    this.worldTracksBefore = clonePlainData(world?.tracks ?? []);
    this.worldJunctionsBefore = clonePlainData(world?.junctions ?? []);
    this.snapshots = this.uuids
      .map((uuid) => {
        const index = this.worldTracksBefore.findIndex((track) => track.uuid === uuid);
        return index === -1 ? null : { index, def: clonePlainData(this.worldTracksBefore[index]) };
      })
      .filter((snapshot): snapshot is IndexedTrackDef => snapshot !== null);
    this.junctionSnapshots = this.worldJunctionsBefore
      .map((junction, index) => ({ index, def: junction }))
      .filter(({ def }) => this.uuids.some((uuid) => (
        def.mainTrackUUID === uuid
        || def.leftTrackUUID === uuid
        || def.rightTrackUUID === uuid
      )))
      .map(({ index, def }) => ({ index, def: clonePlainData(def) }));
    const deletedTrackIds = new Set(this.uuids);
    const deletedJunctionIds = new Set(
      this.junctionSnapshots.map((snapshot) => snapshot.def.uuid),
    );
    this.worldTracksAfter = this.worldTracksBefore
      .filter((track) => !deletedTrackIds.has(track.uuid));
    this.worldJunctionsAfter = this.worldJunctionsBefore
      .filter((junction) => !deletedJunctionIds.has(junction.uuid));
    this.topologyBefore = this.trackManager.captureTopology();
    for (const { def } of this.junctionSnapshots) {
      const live = this.trackManager.getJunction(def.uuid);
      if (live) this.junctionBranchStates.set(def.uuid, live.branchState);
    }
  }

  getRevisionContext(): CommandRevisionContext | null {
    return this.worldIdentity
      ? {
        authority: this.worldIdentity,
        revision: this.expectedConstructionRevision,
      }
      : null;
  }

  rebaseRevisionContext(context: CommandRevisionContext): boolean {
    if (context.authority !== this.worldIdentity
      || !Number.isSafeInteger(context.revision)
      || context.revision < 0) return false;
    this.expectedConstructionRevision = context.revision;
    return true;
  }

  execute(): boolean {
    const world = WorldManager.world;
    if (this.applied || !world || world !== this.worldIdentity
      || world.constructionRevision !== this.expectedConstructionRevision
      || this.uuids.length === 0
      || this.snapshots.length !== this.uuids.length
      || !equalPlainData(world.tracks, this.worldTracksBefore)
      || !equalPlainData(world.junctions, this.worldJunctionsBefore)
      || !equalPlainData(this.trackManager.captureTopology(), this.topologyBefore)
      || !this.liveStateMatchesBefore()
      || this.hasGameplayReferences()) return false;

    const removedTracks: IndexedTrackDef[] = [];
    const removedJunctions: IndexedJunctionDef[] = [];
    let postedRefunds: RefundRecord[] = [];
    try {
      for (const snapshot of this.junctionSnapshots) {
        if (!this.trackManager.removeJunction(snapshot.def.uuid)) {
          throw new Error('junction removal failed');
        }
        removedJunctions.push(snapshot);
      }
      for (const snapshot of this.snapshots) {
        if (!this.trackManager.removeTrack(snapshot.def.uuid)) {
          throw new Error('track removal failed');
        }
        removedTracks.push(snapshot);
      }
      this.injectFailure?.('after-live-removal');

      const committed = WorldManager.applyConstructionBatch(
        this.expectedConstructionRevision,
        (draft) => {
          for (const snapshot of this.junctionSnapshots) {
            if (!draft.removeJunction(snapshot.def.uuid)) return false;
          }
          for (const snapshot of this.snapshots) {
            if (!draft.removeTrack(snapshot.def.uuid)) return false;
          }
          this.injectFailure?.('after-draft-removal');
          let company = draft.company;
          const nextRefunds: RefundRecord[] = [];
          for (let index = 0; index < this.snapshots.length; index++) {
            const magnitude = demolitionRefund(
              this.snapshots[index].def.paidBuildCost,
            );
            if (magnitude === 0) continue;
            const transaction = applyConstructionTransaction(
              company,
              {
                kind: 'demolition-refund',
                magnitude,
                referenceId: this.snapshots[index].def.uuid,
                direction: 'forward',
              },
              draft.economyTick,
            );
            if (transaction.ok === false) return false;
            company = transaction.company;
            nextRefunds.push({
              snapshotIndex: index,
              forwardEntryId: transaction.entry.id,
              magnitude,
            });
          }
          draft.company = company;
          postedRefunds = nextRefunds;
          return true;
        },
      );
      if (!committed) throw new Error('persisted demolition transaction failed');

      this.expectedConstructionRevision += 1;
      this.transactions = postedRefunds;
      this.topologyAfter = this.trackManager.captureTopology();
      this.applied = true;
      return true;
    } catch {
      this.restoreRemovedLive(removedTracks, removedJunctions);
      this.trackManager.restoreTopology(this.topologyBefore);
      return false;
    }
  }

  undo(): boolean {
    const world = WorldManager.world;
    if (!this.applied || !this.transactions || !world
      || world !== this.worldIdentity
      || world.constructionRevision !== this.expectedConstructionRevision
      || !equalPlainData(world.tracks, this.worldTracksAfter)
      || !equalPlainData(world.junctions, this.worldJunctionsAfter)
      || !this.topologyAfter
      || !equalPlainData(this.trackManager.captureTopology(), this.topologyAfter)
      || this.snapshots.some(({ def }) => this.trackManager.getTrack(def.uuid))
      || this.junctionSnapshots.some(({ def }) => this.trackManager.getJunction(def.uuid))) {
      return false;
    }

    const restoredTracks: IndexedTrackDef[] = [];
    const restoredJunctions: IndexedJunctionDef[] = [];
    try {
      for (const snapshot of this.snapshots) {
        this.trackManager.addTrack(restoreTrack(this.scene, snapshot.def));
        restoredTracks.push(snapshot);
      }
      for (const snapshot of this.junctionSnapshots) {
        this.restoreJunction(snapshot.def);
        restoredJunctions.push(snapshot);
      }
      if (!this.trackManager.restoreTopology(this.topologyBefore)) {
        throw new Error('topology restore failed');
      }
      this.injectFailure?.('after-live-restore');

      const committed = WorldManager.applyConstructionBatch(
        this.expectedConstructionRevision,
        (draft) => {
          for (const snapshot of [...this.snapshots].sort((a, b) => a.index - b.index)) {
            if (!draft.addTrack(snapshot.def, snapshot.index)) return false;
          }
          for (const snapshot of [...this.junctionSnapshots].sort((a, b) => a.index - b.index)) {
            if (!draft.addJunction(snapshot.def, snapshot.index)) return false;
          }
          this.injectFailure?.('after-draft-restore');
          let company = draft.company;
          for (let index = this.transactions!.length - 1; index >= 0; index--) {
            const refund = this.transactions![index];
            const transaction = applyConstructionTransaction(
              company,
              {
                kind: 'demolition-refund',
                magnitude: refund.magnitude,
                referenceId: this.snapshots[refund.snapshotIndex].def.uuid,
                direction: 'reversal',
                reversalOf: refund.forwardEntryId,
              },
              draft.economyTick,
            );
            if (transaction.ok === false) return false;
            company = transaction.company;
          }
          draft.company = company;
          return true;
        },
      );
      if (!committed) throw new Error('persisted demolition undo transaction failed');

      this.expectedConstructionRevision += 1;
      this.applied = false;
      return true;
    } catch {
      for (const snapshot of restoredJunctions) {
        this.trackManager.removeJunction(snapshot.def.uuid);
      }
      for (const snapshot of restoredTracks) {
        this.trackManager.removeTrack(snapshot.def.uuid);
      }
      if (this.topologyAfter) this.trackManager.restoreTopology(this.topologyAfter);
      return false;
    }
  }

  private liveStateMatchesBefore(): boolean {
    try {
      return this.snapshots.every(({ def }) => {
        const live = this.trackManager.getTrack(def.uuid);
        return !!live && equalPlainData(TrackSerializer.toTrackDef(live), def);
      }) && this.junctionSnapshots.every(({ def }) => this.trackManager.getJunction(def.uuid));
    } catch {
      return false;
    }
  }

  private hasGameplayReferences(): boolean {
    const world = WorldManager.world!;
    const stationIds = new Set(
      world.stations
        .filter((station) => this.uuids.indexOf(station.trackUUID) !== -1)
        .map((station) => station.id),
    );
    return stationIds.size > 0
      || world.trains.some((train) => (
        this.uuids.indexOf(train.trackUUID) !== -1
      ));
  }

  private restoreRemovedLive(
    tracks: IndexedTrackDef[],
    junctions: IndexedJunctionDef[],
  ): void {
    for (const snapshot of tracks) {
      if (!this.trackManager.getTrack(snapshot.def.uuid)) {
        this.trackManager.addTrack(restoreTrack(this.scene, snapshot.def));
      }
    }
    for (const snapshot of junctions) {
      if (!this.trackManager.getJunction(snapshot.def.uuid)) {
        this.restoreJunction(snapshot.def);
      }
    }
  }

  private restoreJunction(def: JunctionDef): void {
    const main = this.trackManager.getTrack(def.mainTrackUUID);
    const left = this.trackManager.getTrack(def.leftTrackUUID);
    const right = this.trackManager.getTrack(def.rightTrackUUID);
    if (!main || !left || !right) throw new Error('junction tracks missing');
    const junction = new Junction(this.scene, main, left, right, def.position);
    junction.setUUID(def.uuid);
    junction.branchState = this.junctionBranchStates.get(def.uuid) ?? def.branchState;
    this.trackManager.addJunction(junction);
  }
}
