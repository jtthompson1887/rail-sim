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

  /**
   * When true the camera ignores single-pointer left-button pans so that
   * editor tools (junction, completer, etc.) can claim left-button drags.
   */
  private _blockPan: boolean = false;

  /** Reference to the host game canvas for cursor updates. */
  private canvas: HTMLCanvasElement | null = null;

  // ── Multi-touch tracking (pinch-to-zoom + two-finger pan) ─────────────────
  private readonly pinchPointers = new Map<number, { x: number; y: number }>();
  private lastPinchCenter: { x: number; y: number } | null = null;
  private lastPinchDist: number = 0;

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

    // Grab the canvas reference for cursor changes
    this.canvas = (scene.game as any)?.canvas ?? null;

    // Enable a second touch pointer so two-finger gestures can be tracked
    scene.input.addPointer(1);

    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Middle-mouse drag (desktop) — always allowed
      if (pointer.middleButtonDown()) {
        this.isDragging = true;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.setCursor('grabbing');
        this.stopFollow();
      }

      // Left-button single-pointer pan (only in pan-allowed mode)
      if (pointer.leftButtonDown() && !this._blockPan && this.pinchPointers.size < 2) {
        this.isDragging = true;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.setCursor('grabbing');
        this.stopFollow();
      }

      // Track all active pointers for two-finger gestures
      this.pinchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
      if (this.pinchPointers.size === 2) {
        this.isDragging = false; // two-finger gesture takes over panning
        this.stopFollow();
        const pts = Array.from(this.pinchPointers.values());
        this.lastPinchCenter = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };
        this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      }
    });

    scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      // Middle-mouse single-pointer pan
      if (this.isDragging) {
        const deltaX = pointer.x - this.dragStartX;
        const deltaY = pointer.y - this.dragStartY;
        this.cam.scrollX -= deltaX / this.cam.zoom;
        this.cam.scrollY -= deltaY / this.cam.zoom;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
      }

      // Update tracked pointer position
      if (this.pinchPointers.has(pointer.id)) {
        this.pinchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
      }

      // Two-finger pan + pinch-to-zoom
      if (this.pinchPointers.size === 2 && this.lastPinchCenter) {
        const pts = Array.from(this.pinchPointers.values());
        const newCenter = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        };
        const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

        // Pan by the delta of the gesture centre
        const dcx = newCenter.x - this.lastPinchCenter.x;
        const dcy = newCenter.y - this.lastPinchCenter.y;
        this.cam.scrollX -= dcx / this.cam.zoom;
        this.cam.scrollY -= dcy / this.cam.zoom;

        // Zoom by the ratio of finger distances
        if (this.lastPinchDist > 0) {
          const scale = newDist / this.lastPinchDist;
          this.cam.zoom = Phaser.Math.Clamp(
            this.cam.zoom * scale,
            GameConfig.CAMERA.MIN_ZOOM,
            GameConfig.CAMERA.MAX_ZOOM,
          );
        }

        this.lastPinchCenter = newCenter;
        this.lastPinchDist = newDist;
      }
    });

    scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0 || pointer.button === 1) {
        this.isDragging = false;
        this.setCursor('default');
      }
      this.pinchPointers.delete(pointer.id);
      if (this.pinchPointers.size < 2) {
        this.lastPinchCenter = null;
        this.lastPinchDist = 0;
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

  /**
   * Block (true) or allow (false) single-pointer left-button panning.
   * Set to true when an editor tool is active so tool clicks are not
   * accidentally intercepted by camera pan logic.
   */
  setBlockPan(block: boolean): void {
    this._blockPan = block;
    if (block) this.setCursor('default');
  }

  /** Update the CSS cursor on the game canvas. */
  setCursor(cursor: string): void {
    if (this.canvas) this.canvas.style.cursor = cursor;
  }

  update(_time: number, delta: number): void {
    if (!this.isDragging && !this.following) {
      this.controls.update(delta);
    }
  }
}
