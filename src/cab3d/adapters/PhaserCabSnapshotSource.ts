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
} from '../model/CabWorldSnapshot';
import type { BiomeType } from '../model/CabWorldSnapshot';
import { computeSpeedMps } from '../model/CabSpeed';
import { CabPathSampler } from '../model/CabPathSampler';
import { buildCabTrackSpans } from './CabTrackGraphAdapter';
import RailTrack from '../../entities/RailTrack';

/**
 * Phaser-side adapter that reads the live world and produces a frozen
 * {@link CabWorldSnapshot} once per frame.
 *
 * This is the only module in `src/cab3d` that is allowed to import Phaser and
 * the existing managers/entities.
 */
export class PhaserCabSnapshotSource implements ICabSnapshotSource {
  private readonly pathSampler = new CabPathSampler();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trackManager: TrackManager,
    private readonly trainManager: TrainManager,
    private readonly terrainGenerator: TerrainGenerator,
    private readonly seed: string = '',
    private readonly biome: BiomeType = 'temperate',
  ) {}

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

    return Object.freeze({
      valid: true,
      seed: this.seed,
      biome: this.biome,
      vehicle,
      path,
      elapsedSecs: time / 1000,
    });
  }
}
