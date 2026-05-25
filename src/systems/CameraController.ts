import Phaser, { Scene } from 'phaser';
type GameObject = Phaser.GameObjects.GameObject;
type Camera = Phaser.Cameras.Scene2D.Camera;
import { GameConfig } from '../config/GameConfig';

export class CameraController {
  private readonly controlConfig: {
    acceleration: number;
    camera: Camera;
    down: Phaser.Input.Keyboard.Key;
    drag: number;
    left: Phaser.Input.Keyboard.Key;
    maxSpeed: number;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    zoomIn: Phaser.Input.Keyboard.Key;
    zoomOut: Phaser.Input.Keyboard.Key;
  };
  private controls: Phaser.Cameras.Controls.SmoothedKeyControl;
  private cam: Camera;
  private following: GameObject | null = null;
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;

  constructor(scene: Scene) {
    const cursors = scene.input.keyboard.createCursorKeys();
    this.cam = scene.cameras.main;

    this.controlConfig = {
      camera: scene.cameras.main,
      left: cursors.left,
      right: cursors.right,
      up: cursors.up,
      down: cursors.down,
      zoomIn: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      zoomOut: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      acceleration: GameConfig.CAMERA.ACCELERATION,
      drag: GameConfig.CAMERA.DRAG,
      maxSpeed: GameConfig.CAMERA.MAX_SPEED,
    };

    this.controls = new Phaser.Cameras.Controls.SmoothedKeyControl(this.controlConfig);

    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.middleButtonDown()) {
        this.isDragging = true;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.stopFollow();
      }
    });

    scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        const deltaX = pointer.x - this.dragStartX;
        const deltaY = pointer.y - this.dragStartY;
        this.cam.scrollX -= deltaX / this.cam.zoom;
        this.cam.scrollY -= deltaY / this.cam.zoom;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
      }
    });

    scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 1) {
        this.isDragging = false;
      }
    });

    scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _gameObjects: GameObject[], _deltaX: number, deltaY: number) => {
      const oldZoom = this.cam.zoom;
      const newZoom = Phaser.Math.Clamp(
        oldZoom * (deltaY > 0 ? (1 - GameConfig.CAMERA.ZOOM_AMOUNT) : (1 + GameConfig.CAMERA.ZOOM_AMOUNT)),
        GameConfig.CAMERA.MIN_ZOOM,
        GameConfig.CAMERA.MAX_ZOOM
      );
      const mouseX = pointer.x;
      const mouseY = pointer.y;
      const distanceX = (mouseX - this.cam.width / 2) / oldZoom;
      const distanceY = (mouseY - this.cam.height / 2) / oldZoom;
      this.cam.zoom = newZoom;
      this.cam.scrollX += distanceX * (1 - oldZoom / newZoom);
      this.cam.scrollY += distanceY * (1 - oldZoom / newZoom);
    });
  }

  startFollow(object: GameObject): void {
    this.following = object;
    this.cam.startFollow(object);
  }

  stopFollow(): void {
    if (this.following) {
      this.following = null;
      this.cam.stopFollow();
    }
  }

  update(_time: number, delta: number): void {
    if (!this.isDragging && !this.following) {
      this.controls.update(delta);
    }
  }
}
