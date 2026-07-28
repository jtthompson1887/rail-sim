import Phaser from 'phaser';
import type Train from '../entities/Train';
import { TrainManager } from '../managers/TrainManager';
import { CameraController } from '../systems/CameraController';
import { GameConfig } from '../config/GameConfig';
import { EventBus } from '../services/EventBus';
import type { ITrackFollower } from '../config/VehicleTypes';

const GAMEPLAY_INPUT_PANELS = [
  '[data-testid="construction-inspector"]',
  '[data-testid="facility-inspector"]',
  '[data-testid="vehicle-purchase-panel"]',
  '[data-testid="train-inspector"]',
  '[data-testid="freight-objective"]',
].join(',');

export function isGameplayInputFocused(
  activeElement: Element | null = document.activeElement,
): boolean {
  if (!activeElement) return false;
  const interactive = activeElement.closest(
    'button,input,select,textarea',
  );
  if (interactive) return true;
  let candidate: Element | null = activeElement;
  while (candidate) {
    if (candidate instanceof HTMLElement && candidate.isContentEditable) {
      return true;
    }
    candidate = candidate.parentElement;
  }
  return activeElement.closest(GAMEPLAY_INPUT_PANELS) !== null;
}

export class InputManager {
  private scene: Phaser.Scene;
  private cameraController: CameraController;
  private wKey: Phaser.Input.Keyboard.Key;
  private sKey: Phaser.Input.Keyboard.Key;
  private clickedGameObject: boolean = false;
  /** -1 = brake/reverse, 0 = neutral, 1 = accelerate — driven by mobile buttons */
  private mobileThrottle: number = 0;
  private readonly mobileThrottleHandler = (data: { value: number }) => {
    this.mobileThrottle = data.value;
  };
  private clickHandlingSetup: boolean = false;

  constructor(scene: Phaser.Scene, cameraController: CameraController) {
    this.scene = scene;
    this.cameraController = cameraController;
    this.wKey = this.scene.input.keyboard.addKey('W');
    this.sKey = this.scene.input.keyboard.addKey('S');

    EventBus.on('mobile:throttle', this.mobileThrottleHandler);

    // Clean up EventBus subscription when the scene shuts down
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('mobile:throttle', this.mobileThrottleHandler);
    });
  }

  setupClickHandling(trainManager: TrainManager): void {
    for (const train of trainManager.trains) {
      this.scene.input.setDraggable(train.getMatterBody(), true);
    }
    for (const carriage of trainManager.carriages) {
      this.scene.input.setDraggable(carriage.getMatterBody(), true);
    }

    if (this.clickHandlingSetup) return;
    this.clickHandlingSetup = true;

    this.scene.input.on('gameobjectdown', (pointer: Phaser.Input.Pointer, gameObject: any) => {
      this.clickedGameObject = true;
      const mapped = TrainManager.bodyToTrain.get(gameObject);
      if (mapped && this.isTrain(mapped)) {
        trainManager.handleTrainClick(mapped, pointer);
      } else if (trainManager.trains.indexOf(gameObject as Train) !== -1) {
        trainManager.handleTrainClick(gameObject as Train, pointer);
      }
    });

    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0 && !this.clickedGameObject) {
        trainManager.deselectTrain();
      }
      this.clickedGameObject = false;
    });

    // Set input lock to object-drag when dragging starts to suppress camera panning
    this.scene.input.on('dragstart', (_pointer: Phaser.Input.Pointer, gameObject: any) => {
      const dragged = TrainManager.bodyToTrain.get(gameObject);
      if (dragged && dragged.derailed) {
        this.cameraController.setInputLockOwner('object-drag');
      }
    });

    this.scene.input.on(
      'drag',
      (_pointer: Phaser.Input.Pointer, gameObject: any, dragX: number, dragY: number) => {
        const dragged = TrainManager.bodyToTrain.get(gameObject);
        if (!dragged || !dragged.derailed) return;

        gameObject.setPosition(dragX, dragY);
        gameObject.setVelocity(0, 0);
        gameObject.setAngularVelocity(0);
        dragged.currentTrack = null;
      },
    );

    this.scene.input.on('dragend', (_pointer: Phaser.Input.Pointer, gameObject: any) => {
      const dragged = TrainManager.bodyToTrain.get(gameObject);
      // Release input lock back to camera
      this.cameraController.setInputLockOwner('camera');
      if (!dragged || !dragged.derailed) return;
      // Sync body position to game object position before recovery
      const body = dragged.getMatterBody();
      body.setPosition(gameObject.x, gameObject.y);
      const recovered = trainManager.tryRecoverDerailedTrain(dragged);
      const label = this.isTrain(dragged) ? 'Train' : 'Carriage';
      if (recovered) {
        EventBus.emit('ui:toast', { message: `${label} re-railed`, type: 'success' });
      } else {
        EventBus.emit('ui:toast', { message: `Drop ${label.toLowerCase()} closer to a track to re-rail it`, type: 'info' });
      }
    });
  }

  private isTrain(follower: ITrackFollower): follower is Train {
    return follower.vehicleType === 'locomotive';
  }

  /** Convert a screen-space pointer through the authoritative main camera. */
  toWorldPoint(pointer: Pick<Phaser.Input.Pointer, 'x' | 'y'>): Phaser.Math.Vector2 {
    return this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
  }

  handleTrainMovement(
    selectedTrain: Train | null,
    operationsLockedTrainIds: ReadonlySet<string> = new Set(),
  ): void {
    if (!selectedTrain) return;
    if (operationsLockedTrainIds.has(selectedTrain.getUUID())) {
      selectedTrain.enginePower = 0;
      return;
    }
    if (isGameplayInputFocused()) return;
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

  getThrottleKeyState(): { w: boolean; s: boolean } {
    return { w: this.wKey.isDown, s: this.sKey.isDown };
  }

  setThrottleKeys(w: boolean, s: boolean): void {
    this.wKey.isDown = w;
    this.sKey.isDown = s;
  }
}
