import Phaser from 'phaser';
import Train from '../entities/Train';
import Carriage from '../entities/Carriage';
import type TrackManager from './TrackManager';
import { CameraController } from '../systems/CameraController';
import { GameStateManager } from './GameStateManager';
import { EventBus } from '../services/EventBus';
import TrackFlowSolver from '../systems/TrackFlowSolver';
import { GameConfig } from '../config/GameConfig';
import type { ITrackFollower } from '../config/VehicleTypes';
import type RailTrack from '../entities/RailTrack';

interface Bounds {
  min: { x: number; y: number };
  max: { x: number; y: number };
  corners: Array<{ x: number; y: number }>;
}

/** Shared snap-and-reset transition for recovering any derailed vehicle. */
export function recoverDerailedFollowerOnTrack(
  follower: ITrackFollower,
  track: RailTrack,
): void {
  const body = follower.getMatterBody();
  const snappedPoint = track.getTrackPoint(body);
  const snappedAngle = track.getTrackAngle(body);
  body.setPosition(snappedPoint.x, snappedPoint.y);
  body.setAngle(snappedAngle);
  follower.currentTrack = track;
  follower.recover();
  follower.pidControllerFront.reset();
  follower.pidControllerRear.reset();
  follower.enginePower = 0;
}

export class TrainManager {
  private scene: Phaser.Scene;
  private _selectedTrain: Train | null = null;
  trains: Train[] = [];
  private trackManager: TrackManager;
  private cameraController: CameraController;
  carriages: Carriage[] = [];
  private trackSolvers: Map<ITrackFollower, TrackFlowSolver> = new Map();

  /** Map from Matter body game objects back to their owning vehicle (Train or Carriage). */
  static readonly bodyToTrain: WeakMap<Phaser.GameObjects.GameObject, ITrackFollower> = new WeakMap();

  constructor(scene: Phaser.Scene, trackManager: TrackManager, cameraController: CameraController) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.cameraController = cameraController;
  }

  createInitialTrain(id?: string): Train {
    const train = new Train(this.scene, 0, 500, id);
    train.getMatterBody().angle = 90;
    this.trains.push(train);
    this.trackSolvers.set(train, new TrackFlowSolver(this.trackManager, train));
    TrainManager.bodyToTrain.set(train.getMatterBody(), train);
    GameStateManager.setActiveTrains(this.trains.length);
    return train;
  }

  createFreightTrain(id: string, freightSetId: string): Train {
    const train = new Train(this.scene, 0, 500, id, freightSetId);
    train.getMatterBody().angle = 90;
    this.trains.push(train);
    this.trackSolvers.set(
      train,
      new TrackFlowSolver(this.trackManager, train),
    );
    TrainManager.bodyToTrain.set(train.getMatterBody(), train);
    GameStateManager.setActiveTrains(this.trains.length);
    return train;
  }

  placeFreightTrain(
    train: Train,
    trackUUID: string,
    trackT: number,
    facing: 1 | -1,
  ): boolean {
    if (this.trains.indexOf(train) === -1
      || train.freightSetId === null
      || !Number.isFinite(trackT)
      || trackT < 0
      || trackT > 1
      || (facing !== 1 && facing !== -1)) return false;
    const track = this.trackManager.getTrack(trackUUID);
    if (!track) return false;
    try {
      const body = train.getMatterBody();
      const point = track.getCurvePath().getPoint(trackT);
      body.setPosition(point.x, point.y);
      train.currentTrack = track;
      body.setAngle(
        track.getTrackAngle(body) + (facing === -1 ? 180 : 0),
      );
      train.enginePower = 0;
      body.setVelocity(0, 0);
      body.setAngularVelocity(0);
      return true;
    } catch {
      return false;
    }
  }

  removeFreightTrain(trainId: string): boolean {
    const index = this.trains.findIndex(
      (train) => train.getUUID() === trainId
        && train.freightSetId !== null,
    );
    if (index === -1) return false;

    const train = this.trains[index];
    if (this._selectedTrain === train) this.deselectTrain();
    this.trains.splice(index, 1);
    this.trackSolvers.delete(train);
    const body = train.getMatterBody();
    TrainManager.bodyToTrain.delete(body);
    body.destroy();
    train.destroy();
    GameStateManager.setActiveTrains(this.trains.length);
    return true;
  }

  stopFreightTrains(trainIds: readonly string[]): void {
    const requested = new Set(trainIds);
    for (const train of this.trains) {
      if (train.freightSetId !== null
        && requested.has(train.getUUID())) train.enginePower = 0;
    }
  }

  createCarriage(id?: string): Carriage {
    const carriage = new Carriage(this.scene, 0, 500, id);
    carriage.getMatterBody().angle = 90;
    this.carriages.push(carriage);
    this.trackSolvers.set(carriage, new TrackFlowSolver(this.trackManager, carriage));
    TrainManager.bodyToTrain.set(carriage.getMatterBody(), carriage);
    return carriage;
  }

  handleTrainClick(train: Train, pointer: Phaser.Input.Pointer): void {
    if (pointer.button !== 0) return;
    this.selectTrain(train.getUUID());
  }

  /**
   * Programmatically select a train and start the camera following it.
   * Unlike handleTrainClick this does not require a pointer event, so it
   * can be called when entering play mode to auto-follow the first train.
   */
  selectTrain(trainId: string | null): void {
    const train = trainId === null
      ? null
      : this.trains.find((candidate) => candidate.getUUID() === trainId)
        ?? null;
    if (train === this._selectedTrain) return;

    const releasedSelection = this._selectedTrain !== null;
    if (releasedSelection) this.releaseSelectedTrain();

    if (train) {
      train.selected = true;
      this._selectedTrain = train;
      this.cameraController.startFollow(train.getMatterBody());
      EventBus.emit('train:selected', { trainId: train.getUUID() });
    } else if (releasedSelection) {
      EventBus.emit('train:deselected', {});
    }
  }

  deselectTrain(): void {
    if (!this._selectedTrain) return;
    this.releaseSelectedTrain();
    EventBus.emit('train:deselected', {});
  }

  get selectedTrain(): Train | null {
    return this._selectedTrain;
  }

  private releaseSelectedTrain(): void {
    if (!this._selectedTrain) return;
    this._selectedTrain.enginePower = 0;
    this._selectedTrain.selected = false;
    this._selectedTrain = null;
    this.cameraController.stopFollow();
  }

  tryRecoverDerailedTrain(follower: ITrackFollower): boolean {
    if (!follower.derailed) return false;
    const trainBody = follower.getMatterBody();
    const closestTrack = this.trackManager.getClosestTrack(
      { x: trainBody.x, y: trainBody.y },
      Math.max(GameConfig.TRACK.MAX_CLOSE_DISTANCE, 120),
      follower.currentTrack ?? undefined,
    );
    if (!closestTrack) {
      return false;
    }

    recoverDerailedFollowerOnTrack(follower, closestTrack);
    return true;
  }

  getBounds(trainBody: Phaser.Physics.Matter.Sprite): Bounds | null {
    if (!trainBody) return null;

    const width = trainBody.displayWidth;
    const height = trainBody.displayHeight;
    const x = trainBody.x;
    const y = trainBody.y;
    const angle = trainBody.angle * (Math.PI / 180);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    const corners = [
      { x: x + (-halfWidth * cos - halfHeight * sin), y: y + (-halfWidth * sin + halfHeight * cos) },
      { x: x + (halfWidth * cos - halfHeight * sin), y: y + (halfWidth * sin + halfHeight * cos) },
      { x: x + (halfWidth * cos + halfHeight * sin), y: y + (halfWidth * sin - halfHeight * cos) },
      { x: x + (-halfWidth * cos + halfHeight * sin), y: y + (-halfWidth * sin - halfHeight * cos) }
    ];

    const bounds = corners.reduce((acc, corner) => ({
      min: { x: Math.min(acc.min.x, corner.x), y: Math.min(acc.min.y, corner.y) },
      max: { x: Math.max(acc.max.x, corner.x), y: Math.max(acc.max.y, corner.y) }
    }), {
      min: { x: corners[0].x, y: corners[0].y },
      max: { x: corners[0].x, y: corners[0].y }
    });

    return { min: bounds.min, max: bounds.max, corners };
  }

  update(
    time: number,
    delta: number,
    operationsLockedTrainIds: ReadonlySet<string> = new Set(),
  ): void {
    for (const train of this.trains) {
      if (train.freightSetId !== null
        && operationsLockedTrainIds.has(train.getUUID())) {
        train.enginePower = 0;
      }
      train.update(time, delta);
      const solver = this.trackSolvers.get(train);
      solver?.applyTrackFlowForces();
    }
    for (const carriage of this.carriages) {
      carriage.update(time, delta);
      const solver = this.trackSolvers.get(carriage);
      solver?.applyTrackFlowForces();
    }
    GameStateManager.setActiveTrains(this.trains.length);
  }
}
