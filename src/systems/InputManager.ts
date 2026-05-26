import Phaser from 'phaser';
import type Train from '../entities/Train';
import type { TrainManager } from '../managers/TrainManager';
import { GameConfig } from '../config/GameConfig';
import { EventBus } from '../services/EventBus';

export class InputManager {
  private scene: Phaser.Scene;
  private wKey: Phaser.Input.Keyboard.Key;
  private sKey: Phaser.Input.Keyboard.Key;
  private clickedGameObject: boolean = false;
  /** -1 = brake/reverse, 0 = neutral, 1 = accelerate — driven by mobile buttons */
  private mobileThrottle: number = 0;
  private readonly mobileThrottleHandler = (data: { value: number }) => {
    this.mobileThrottle = data.value;
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.wKey = this.scene.input.keyboard.addKey('W');
    this.sKey = this.scene.input.keyboard.addKey('S');

    EventBus.on('mobile:throttle', this.mobileThrottleHandler);

    // Clean up EventBus subscription when the scene shuts down
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('mobile:throttle', this.mobileThrottleHandler);
    });
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
    // Keyboard input takes priority over mobile throttle buttons
    if (this.wKey.isDown) {
      selectedTrain.enginePower = GameConfig.TRAIN.ENGINE_POWER;
    } else if (this.sKey.isDown) {
      selectedTrain.enginePower = -GameConfig.TRAIN.ENGINE_POWER;
    } else if (this.mobileThrottle > 0) {
      selectedTrain.enginePower = GameConfig.TRAIN.ENGINE_POWER;
    } else if (this.mobileThrottle < 0) {
      selectedTrain.enginePower = -GameConfig.TRAIN.ENGINE_POWER;
    } else {
      selectedTrain.enginePower = 0;
    }
  }
}
