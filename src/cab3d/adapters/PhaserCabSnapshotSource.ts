import Phaser from 'phaser';
import type TrackManager from '../../managers/TrackManager';
import type { TrainManager } from '../../managers/TrainManager';
import type { TerrainGenerator } from '../../systems/TerrainGenerator';
import { GameConfig } from '../../config/GameConfig';
import { CabConfig } from '../CabConfig';
import type { ICabSnapshotSource } from '../contracts/ICabSnapshotSource';
import {
  INVALID_SNAPSHOT,
  type CabWorldSnapshot,
  type CabVehicleSnapshot,
  type CabTrackSample,
  type SceneryObjectDef,
} from '../model/CabWorldSnapshot';
import type { BiomeType } from '../model/CabWorldSnapshot';
import { SceneryGenerator } from '../../systems/SceneryGenerator';
import { computeSpeedMps } from '../model/CabSpeed';
import { CabPathSampler } from '../model/CabPathSampler';
import { buildCabTrackSpans } from './CabTrackGraphAdapter';
import RailTrack from '../../entities/RailTrack';

export interface CabFacilityPlacement {
  readonly x: number;
  readonly y: number;
  readonly railAccessX?: number;
  readonly railAccessY?: number;
}

export type CabFacilityProvider = () => ReadonlyArray<CabFacilityPlacement>;

/**
 * Phaser-side adapter that reads the live world and produces a frozen
 * {@link CabWorldSnapshot} once per frame.
 *
 * This is the only module in `src/cab3d` that is allowed to import Phaser and
 * the existing managers/entities.
 */
export class PhaserCabSnapshotSource implements ICabSnapshotSource {
  private static readonly EMPTY_SCENERY: ReadonlyArray<SceneryObjectDef> = Object.freeze([]);
  private readonly pathSampler = new CabPathSampler();
  private readonly sceneryGenerator: SceneryGenerator;
  private lastSceneryChunkKey: string | null = null;
  private lastScenery: ReadonlyArray<SceneryObjectDef> = PhaserCabSnapshotSource.EMPTY_SCENERY;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trackManager: TrackManager,
    private readonly trainManager: TrainManager,
    private readonly terrainGenerator: TerrainGenerator,
    private readonly seed: string = '',
    private readonly biome: BiomeType = 'temperate',
    private readonly facilityProvider: CabFacilityProvider = () => [],
  ) {
    this.sceneryGenerator = new SceneryGenerator(terrainGenerator);
  }

  capture(time: number, delta: number): Readonly<CabWorldSnapshot> {
    const train = this.trainManager.selectedTrain;
    if (!train) return INVALID_SNAPSHOT;

    const body = train.getMatterBody();
    const velocity = (body.body as any)?.velocity ?? { x: 0, y: 0 };
    const speedMps = computeSpeedMps(velocity.x, velocity.y, delta, CabConfig.SPEED_SCALE);
    const maxPower = GameConfig.TRAIN.ENGINE_POWER;
    const throttle = maxPower ? Math.max(-1, Math.min(1, train.enginePower / maxPower)) : 0;

    const vehicle: CabVehicleSnapshot = Object.freeze({
      id: train.getUUID(),
      x: body.x,
      y: body.y,
      headingRad: body.rotation,
      speedMps,
      throttle,
      derailed: train.derailed,
      onTrack: train.currentTrack !== null && !train.derailed,
    });

    let path: ReadonlyArray<CabTrackSample> = Object.freeze([]);
    if (train.currentTrack instanceof RailTrack && !train.derailed) {
      const currentTrack = train.currentTrack;
      const trainT = currentTrack.getTrackPosition(body);
      const spans = buildCabTrackSpans(
        currentTrack,
        trainT,
        body.rotation,
        this.terrainGenerator,
      );
      path = this.pathSampler.sample(spans, {
        near: CabConfig.NEAR_DISTANCE_M,
        far: CabConfig.FAR_DISTANCE_M,
        spacing: CabConfig.SAMPLE_SPACING_M,
      });
    }

    const scenery = this.ensureScenery(vehicle);

    return Object.freeze({
      valid: true,
      seed: this.seed,
      biome: this.biome,
      vehicle,
      path,
      scenery,
      nearestFacilityDistanceM: this.computeNearestFacilityDistance(vehicle),
      elapsedSecs: time / 1000,
      terrain: {
        getHeightAt: (worldX: number, worldY: number) =>
          this.terrainGenerator.getHeightAt(worldX, worldY),
      },
    });
  }

  private ensureScenery(vehicle: CabVehicleSnapshot): ReadonlyArray<SceneryObjectDef> {
    const eyeDistance = CabConfig.EYE_FORWARD_OFFSET_M;
    const eyeX = vehicle.x + Math.cos(vehicle.headingRad) * eyeDistance;
    const eyeY = vehicle.y + Math.sin(vehicle.headingRad) * eyeDistance;

    const chunkSize = GameConfig.WORLD.CHUNK_SIZE;
    const chunkX = Math.floor(eyeX / chunkSize) * chunkSize;
    const chunkY = Math.floor(eyeY / chunkSize) * chunkSize;
    const chunkKey = `${chunkX}:${chunkY}`;

    if (chunkKey === this.lastSceneryChunkKey) {
      return this.lastScenery;
    }

    const generated = this.sceneryGenerator.generateForChunk(chunkX, chunkY, this.seed, this.biome);
    const radius = CabConfig.SCENERY_DRAW_RADIUS_M;
    const filtered = generated.filter(
      (def) => Math.hypot(def.x - eyeX, def.y - eyeY) <= radius,
    );

    this.lastSceneryChunkKey = chunkKey;
    this.lastScenery = filtered.length > 0
      ? Object.freeze(filtered)
      : PhaserCabSnapshotSource.EMPTY_SCENERY;
    return this.lastScenery;
  }

  private computeNearestFacilityDistance(vehicle: CabVehicleSnapshot): number | null {
    const facilities = this.facilityProvider();
    if (facilities.length === 0) return null;

    let nearest: number | null = null;
    for (const facility of facilities) {
      const targetX = facility.railAccessX ?? facility.x;
      const targetY = facility.railAccessY ?? facility.y;
      const distance = Math.hypot(targetX - vehicle.x, targetY - vehicle.y);
      if (nearest === null || distance < nearest) {
        nearest = distance;
      }
    }
    return nearest;
  }
}
