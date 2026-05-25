import Phaser from 'phaser';
import type Train from '../entities/Train';
import type { TrainManager } from '../managers/TrainManager';
import { GameConfig } from '../config/GameConfig';

export class InputManager {
  private scene: Phaser.Scene;
  private wKey: Phaser.Input.Keyboard.Key;
  private sKey: Phaser.Input.Keyboard.Key;
  private clickedGameObject: boolean = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.wKey = this.scene.input.keyboard.addKey('W');
    this.sKey = this.scene.input.keyboard.addKey('S');
  }

  setupClickHandling(trainManager: TrainManager): void {
    this.scene.input.on('gameobjectdown', (pointer: Phaser.Input.Pointer, gameObject: any) => {
      this.clickedGameObject = true;
      let clickedTrain: Train | null = null;
      if (gameObject.parentTrain) {
        clickedTrain = gameObject.parentTrain as Train;
      } else if (trainManager.trains.indexOf(gameObject as Train) !== -1) {
        clickedTrain = gameObject as Train;
      }
      if (clickedTrain) {
        trainManager.handleTrainClick(clickedTrain, pointer);
      }
    });

    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0 && !this.clickedGameObject) {
        trainManager.deselectTrain();
      }
      this.clickedGameObject = false;
    });
  }

  handleTrainMovement(selectedTrain: Train | null): void {
    if (!selectedTrain) return;
    if (this.wKey.isDown) {
      selectedTrain.enginePower = GameConfig.TRAIN.ENGINE_POWER;
    } else if (this.sKey.isDown) {
      selectedTrain.enginePower = -GameConfig.TRAIN.ENGINE_POWER;
    } else {
      selectedTrain.enginePower = 0;
    }
  }
}
