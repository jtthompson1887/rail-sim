import Phaser from 'phaser';
import type { Command } from '../systems/CommandStack';
import type { JunctionDef, TrackDef } from '../config/WorldData';
import Junction from '../entities/Junction';
import RailTrack from '../entities/RailTrack';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import {
  ConstructionEconomy,
  type ConstructionTransaction,
} from '../systems/ConstructionEconomy';
import { TrackSerializer } from '../utils/TrackSerializer';

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
    JSON.parse(JSON.stringify(def.verticalProfile)),
    JSON.parse(JSON.stringify(def.structures)),
    def.paidBuildCost,
  );
  return track;
}

/** Remove tracks as one reversible demolition lifecycle with per-track refunds. */
export class DeleteTracksCommand implements Command {
  readonly description = 'Delete track(s)';
  private readonly uuids: string[];
  private readonly snapshots: TrackDef[];
  private readonly junctionSnapshots: JunctionDef[];
  private readonly junctionBranchStates = new Map<string, 'left' | 'right'>();
  private readonly refundLifecycles: object[];
  private readonly worldIdentity = WorldManager.world;
  private transactions: ConstructionTransaction[] | null = null;
  private applied = false;

  constructor(
    private readonly trackManager: TrackManager,
    private readonly scene: Phaser.Scene,
    uuids: string[],
    private readonly economy: ConstructionEconomy = new ConstructionEconomy(
      WorldManager.world?.company ?? { cash: 0 },
    ),
  ) {
    this.uuids = Array.from(new Set(uuids));
    const world = WorldManager.world;
    this.snapshots = this.uuids
      .map((uuid) => world?.tracks.find((track) => track.uuid === uuid))
      .filter((track): track is TrackDef => track !== undefined)
      .map((track) => JSON.parse(JSON.stringify(track)) as TrackDef);
    this.junctionSnapshots = (world?.junctions ?? [])
      .filter((junction) => this.uuids.some((uuid) => (
        junction.mainTrackUUID === uuid
        || junction.leftTrackUUID === uuid
        || junction.rightTrackUUID === uuid
      )))
      .map((junction) => JSON.parse(JSON.stringify(junction)) as JunctionDef);
    for (const junction of this.junctionSnapshots) {
      const live = this.trackManager.getJunction(junction.uuid);
      if (live) this.junctionBranchStates.set(junction.uuid, live.branchState);
    }
    this.refundLifecycles = this.snapshots.map(() => ({}));
  }

  execute(): boolean {
    const world = WorldManager.world;
    if (this.applied || !world || world !== this.worldIdentity
      || !this.economy.isBoundTo(world.company)
      || this.uuids.length === 0
      || this.snapshots.length !== this.uuids.length
      || !WorldManager.canAdvanceRevision()
      || !this.uuids.every((uuid) => this.trackManager.getTrack(uuid))
      || !this.liveTracksMatchSnapshots()
      || !this.junctionSnapshots.every((junction) => this.trackManager.getJunction(junction.uuid))
      || !this.snapshots.every((snapshot) => JSON.stringify(
        world.tracks.find((track) => track.uuid === snapshot.uuid),
      ) === JSON.stringify(snapshot))
      || this.hasGameplayReferences()) return false;

    const removedJunctions: JunctionDef[] = [];
    const removedTracks: TrackDef[] = [];
    const appliedTransactions: ConstructionTransaction[] = [];
    try {
      for (const junction of this.junctionSnapshots) {
        if (!this.trackManager.removeJunction(junction.uuid)) {
          throw new Error('junction removal failed');
        }
        removedJunctions.push(junction);
        if (!WorldManager.removeJunctionDef(junction.uuid, false)) {
          throw new Error('junction definition removal failed');
        }
      }
      for (const snapshot of this.snapshots) {
        if (!this.trackManager.removeTrack(snapshot.uuid)) {
          throw new Error('track removal failed');
        }
        removedTracks.push(snapshot);
        if (!WorldManager.removeTrackDef(snapshot.uuid, false)) {
          throw new Error('track definition removal failed');
        }
      }

      if (this.transactions) {
        for (const transaction of this.transactions) {
          if (!this.economy.reapply(transaction)) throw new Error('refund reapply failed');
          appliedTransactions.push(transaction);
        }
      } else {
        for (let index = 0; index < this.snapshots.length; index++) {
          const paid = this.snapshots[index].paidBuildCost;
          if (paid === 0) continue;
          const transaction = this.economy.refundDemolition(
            this.refundLifecycles[index],
            paid,
          );
          if (!transaction) throw new Error('refund failed');
          appliedTransactions.push(transaction);
        }
      }

      if (!WorldManager.advanceRevision()) throw new Error('revision failed');
      if (!this.transactions) this.transactions = appliedTransactions;
      this.applied = true;
      return true;
    } catch {
      for (let index = appliedTransactions.length - 1; index >= 0; index--) {
        this.economy.reverse(appliedTransactions[index]);
      }
      this.restoreTracks(removedTracks);
      this.restoreJunctions(removedJunctions);
      return false;
    }
  }

  undo(): boolean {
    if (!this.applied || !this.transactions
      || WorldManager.world !== this.worldIdentity
      || !WorldManager.world
      || !this.economy.isBoundTo(WorldManager.world.company)
      || !WorldManager.canAdvanceRevision()) return false;
    const reversed: ConstructionTransaction[] = [];
    const restoredTracks: TrackDef[] = [];
    const restoredJunctions: JunctionDef[] = [];
    try {
      for (let index = this.transactions.length - 1; index >= 0; index--) {
        if (!this.economy.reverse(this.transactions[index])) {
          throw new Error('refund reversal failed');
        }
        reversed.push(this.transactions[index]);
      }
      for (const snapshot of this.snapshots) {
        this.trackManager.addTrack(restoreTrack(this.scene, snapshot));
        restoredTracks.push(snapshot);
        if (!WorldManager.addTrackDef(snapshot, false)) throw new Error('track restore failed');
      }
      for (const junction of this.junctionSnapshots) {
        this.restoreJunction(junction);
        restoredJunctions.push(junction);
        if (!WorldManager.addJunctionDef(junction, false)) throw new Error('junction restore failed');
      }
      if (!WorldManager.advanceRevision()) throw new Error('revision failed');
      this.applied = false;
      return true;
    } catch {
      for (const junction of restoredJunctions) {
        this.trackManager.removeJunction(junction.uuid);
        WorldManager.removeJunctionDef(junction.uuid, false);
      }
      for (const track of restoredTracks) {
        this.trackManager.removeTrack(track.uuid);
        WorldManager.removeTrackDef(track.uuid, false);
      }
      for (let index = reversed.length - 1; index >= 0; index--) {
        this.economy.reapply(reversed[index]);
      }
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
      || world.trains.some((train) => this.uuids.indexOf(train.trackUUID) !== -1)
      || world.scenarios.some((scenario) => (
        scenario.targetStationId !== undefined
        && stationIds.has(scenario.targetStationId)
      ));
  }

  private liveTracksMatchSnapshots(): boolean {
    try {
      return this.snapshots.every((snapshot) => {
        const live = this.trackManager.getTrack(snapshot.uuid);
        return !!live
          && JSON.stringify(TrackSerializer.toTrackDef(live)) === JSON.stringify(snapshot);
      });
    } catch {
      return false;
    }
  }

  private restoreTracks(snapshots: TrackDef[]): void {
    for (const snapshot of snapshots) {
      if (!this.trackManager.getTrack(snapshot.uuid)) {
        this.trackManager.addTrack(restoreTrack(this.scene, snapshot));
      }
      if (!WorldManager.world?.tracks.some((track) => track.uuid === snapshot.uuid)) {
        WorldManager.addTrackDef(snapshot, false);
      }
    }
  }

  private restoreJunctions(junctions: JunctionDef[]): void {
    for (const junction of junctions) {
      if (!this.trackManager.getJunction(junction.uuid)) this.restoreJunction(junction);
      if (!WorldManager.world?.junctions.some((item) => item.uuid === junction.uuid)) {
        WorldManager.addJunctionDef(junction, false);
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
