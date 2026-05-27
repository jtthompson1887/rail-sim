import Phaser from 'phaser';
import RailTrack from '../entities/RailTrack';
import { Station } from '../entities/Station';
import type TrackManager from '../managers/TrackManager';
import { TrainManager } from '../managers/TrainManager';
import { WorldManager } from '../managers/WorldManager';
import TrackGenerator from '../systems/TrackGenerator';
import { TrackSerializer } from '../utils/TrackSerializer';
import { GameConfig } from '../config/GameConfig';
import type { TrackDef, WorldStationDef } from '../config/WorldData';

/**
 * WorldContentLoader – responsible for loading/restoring world content
 * (tracks, stations, trains) from saved state or generating starter content.
 *
 * Extracted from WorldScene to separate orchestration from data loading.
 */
export class WorldContentLoader {
  private readonly scene: Phaser.Scene;
  private readonly trackManager: TrackManager;
  private readonly trainManager: TrainManager;
  readonly stations: Station[] = [];

  constructor(scene: Phaser.Scene, trackManager: TrackManager, trainManager: TrainManager) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.trainManager = trainManager;
  }

  /** Load all world content (tracks, stations, trains) or generate starter content. */
  load(): void {
    const world = WorldManager.world;
    if (!world || world.tracks.length === 0) {
      this.generateStarterTrack();
      return;
    }

    for (const def of world.tracks)   { this.restoreTrack(def); }
    for (const def of world.stations) { this.restoreStation(def); }

    for (const def of world.trains) {
      const track = this.trackManager.getTrack(def.trackUUID);
      if (!track) continue;
      const train = this.trainManager.createInitialTrain();
      const pt = track.getCurvePath().getPoint(def.trackT);
      train.getMatterBody().setPosition(pt.x, pt.y);
      train.currentTrack = track;
    }
  }

  private restoreTrack(def: TrackDef): void {
    const p0 = new Phaser.Math.Vector2(def.p0.x, def.p0.y);
    const p1 = new Phaser.Math.Vector2(def.p1.x, def.p1.y);
    const p2 = new Phaser.Math.Vector2(def.p2.x, def.p2.y);
    const p3 = new Phaser.Math.Vector2(def.p3.x, def.p3.y);
    const track = new RailTrack(this.scene, p0, p1, p2, p3);
    track.setUUID(def.uuid);
    if (def.isTunnel)  track.isTunnel  = def.isTunnel;
    if (def.elevation) track.elevation = def.elevation;
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

  private generateStarterTrack(): void {
    const generator = new TrackGenerator(this.scene, this.trackManager, WorldManager.world?.seed);
    const tracks = generator.generateTracks({
      startPoint: new Phaser.Math.Vector2(0, 500),
      startAngle: Phaser.Math.DegToRad(90),
      sections: GameConfig.GENERATION.MAIN.SECTIONS,
      minLength: GameConfig.GENERATION.MAIN.MIN_LENGTH,
      maxLength: GameConfig.GENERATION.MAIN.MAX_LENGTH,
      curveProbability: GameConfig.GENERATION.MAIN.CURVE_PROB,
      minCurveAngle: GameConfig.GENERATION.MAIN.MIN_ANGLE,
      maxCurveAngle: GameConfig.GENERATION.MAIN.MAX_ANGLE,
      smoothness: GameConfig.GENERATION.MAIN.SMOOTHNESS,
    });

    for (const track of tracks) {
      WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
    }

    const firstTrack = tracks[0];
    const startPt = firstTrack.getCurvePath().getPoint(0);
    const train = this.trainManager.createInitialTrain();
    train.getMatterBody().setPosition(startPt.x, startPt.y);
    train.currentTrack = firstTrack;
    train.getMatterBody().setAngle(firstTrack.getTrackAngle(train.getMatterBody()));
  }
}
