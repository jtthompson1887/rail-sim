import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import { Station } from '../entities/Station';
import type TrackManager from '../managers/TrackManager';
import type { TrainManager } from '../managers/TrainManager';
import { WorldManager } from '../managers/WorldManager';
import type { TrackDef, WorldStationDef } from '../config/WorldData';

/**
 * WorldContentLoader – responsible for loading/restoring world content
 * (tracks and stations) from saved state.
 *
 * Extracted from WorldScene to separate orchestration from data loading.
 */
export class WorldContentLoader {
  private readonly scene: Phaser.Scene;
  private readonly trackManager: TrackManager;
  readonly stations: Station[] = [];

  constructor(
    scene: Phaser.Scene,
    trackManager: TrackManager,
    _trainManager: TrainManager,
  ) {
    this.scene = scene;
    this.trackManager = trackManager;
  }

  /** Load all persisted world content without synthesising construction data. */
  load(): void {
    const world = WorldManager.world;
    if (!world) return;

    for (const def of world.tracks)   { this.restoreTrack(def); }
    for (const def of world.stations) { this.restoreStation(def); }

    // Schema-7 trains remain persisted but deliberately have no legacy
    // passenger-vehicle materialisation. Task 4 installs the freight adapter.
  }

  private restoreTrack(def: TrackDef): void {
    const p0 = new Phaser.Math.Vector2(def.p0.x, def.p0.y);
    const p1 = new Phaser.Math.Vector2(def.p1.x, def.p1.y);
    const p2 = new Phaser.Math.Vector2(def.p2.x, def.p2.y);
    const p3 = new Phaser.Math.Vector2(def.p3.x, def.p3.y);
    const track = new RailTrack(this.scene, p0, p1, p2, p3);
    track.setUUID(def.uuid);
    track.setConstructionData(
      def.verticalProfile,
      def.structures,
      def.paidBuildCost,
    );
    this.trackManager.addTrack(track);
  }

  private restoreStation(def: WorldStationDef): void {
    const track = this.trackManager.getTrack(def.trackUUID);
    if (!track) return;
    const stationDef = {
      id: def.id,
      name: def.name,
      trackSectionIndex: 0,
      trackT: def.trackT,
      passengerSpawnRate: def.passengerSpawnRate,
    };
    this.stations.push(new Station(this.scene, stationDef, track));
  }

}
