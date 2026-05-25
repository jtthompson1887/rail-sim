import Phaser from 'phaser';
import Train from '../entities/Train';
import type TrackManager from './TrackManager';
import { CameraController } from '../systems/CameraController';
import { GameStateManager } from './GameStateManager';
import { EventBus } from '../services/EventBus';
import TrackFlowSolver from '../systems/TrackFlowSolver';

interface Bounds {
  min: { x: number; y: number };
  max: { x: number; y: number };
  corners: Array<{ x: number; y: number }>;
}

export class TrainManager {
  private scene: Phaser.Scene;
  private _selectedTrain: Train | null = null;
  trains: Train[] = [];
  private trackManager: TrackManager;
  private cameraController: CameraController;
  private trackSolvers: Map<Train, TrackFlowSolver> = new Map();

  constructor(scene: Phaser.Scene, trackManager: TrackManager, cameraController: CameraController) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.cameraController = cameraController;
  }

  createInitialTrain(): Train {
    const train = new Train(this.scene, 0, 500);
    train.getMatterBody().angle = 90;
    this.trains.push(train);
    this.trackSolvers.set(train, new TrackFlowSolver(this.trackManager, train));
    GameStateManager.setActiveTrains(this.trains.length);
    return train;
  }

  handleTrainClick(train: Train, pointer: Phaser.Input.Pointer): void {
    if (pointer.button !== 0) return;
    if (this._selectedTrain && this._selectedTrain !== train) {
      this._selectedTrain.selected = false;
    }
    train.selected = true;
    this._selectedTrain = train;
    EventBus.emit('train:selected', { trainId: train.getUUID() });
    this.cameraController.startFollow(train.getMatterBody());
  }

  deselectTrain(): void {
    if (this._selectedTrain) {
      this._selectedTrain.selected = false;
      this._selectedTrain = null;
      EventBus.emit('train:deselected', {});
      this.cameraController.stopFollow();
    }
  }

  get selectedTrain(): Train | null {
    return this._selectedTrain;
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

  update(time: number, delta: number): void {
    for (const train of this.trains) {
      train.update(time, delta);
      const solver = this.trackSolvers.get(train);
      solver?.applyTrackFlowForces();
    }
    GameStateManager.setActiveTrains(this.trains.length);
  }
}
