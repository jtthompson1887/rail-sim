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

/**
 * Phaser-side adapter that reads the live world and produces a frozen
 * {@link CabWorldSnapshot} once per frame.
 *
 * This is the only module in `src/cab3d` that is allowed to import Phaser and
 * the existing managers/entities.
 */
export class PhaserCabSnapshotSource implements ICabSnapshotSource {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trackManager: TrackManager,
    private readonly trainManager: TrainManager,
    private readonly terrainGenerator: TerrainGenerator,
  ) {}

  capture(time: number, _delta: number): Readonly<CabWorldSnapshot> {
    const train = this.trainManager.selectedTrain;
    if (!train) return INVALID_SNAPSHOT;

    const body = train.getMatterBody();
    const velocity = (body.body as any)?.velocity ?? { x: 0, y: 0 };
    const speedMps = Math.hypot(velocity.x, velocity.y) * CabConfig.SPEED_SCALE;
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

    // Phase 1: path is empty; Phase 2 will fill it from the track network.
    const path: ReadonlyArray<CabTrackSample> = Object.freeze([]);

    return Object.freeze({
      valid: true,
      seed: '',
      biome: 'temperate',
      vehicle,
      path,
      elapsedSecs: time / 1000,
    });
  }
}
