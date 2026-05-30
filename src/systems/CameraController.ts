import Phaser, { Scene } from 'phaser';
type GameObject = Phaser.GameObjects.GameObject;
type Camera = Phaser.Cameras.Scene2D.Camera;
import { GameConfig } from '../config/GameConfig';
import type { InputLockOwner } from './tools/IEditorTool';

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
   * Input-lock owner. When 'camera', all camera controls work normally.
   * When 'editor-tool', 'ui', or 'object-drag', camera pan/zoom/wheel
   * is suppressed so the owner can claim exclusive pointer control.
   */
  private _inputLockOwner: InputLockOwner = 'camera';

  /** Reference to the host game canvas for cursor updates. */
  private canvas: HTMLCanvasElement | null = null;

  // ── Multi-touch tracking (pinch-to-zoom + two-finger pan) ─────────────────
  private readonly pinchPointers = new Map<number, { x: number; y: number }>();
  private lastPinchCenter: { x: number; y: number } | null = null;
  private lastPinchDist: number = 0;

  /**
   * True while any Phaser drag event is active (a game object is being dragged,
   * e.g. a track reshape handle or a derailed train body). During this time
   * single-pointer panning is suppressed to prevent the camera from jumping.
   */
  private _objectDragActive: boolean = false;

  // ── Edge scrolling during drag ────────────────────────────────────────────
  private _edgeScrollEnabled: boolean = true;
  private _edgeScrollMargin: number = 40;
  private _edgeScrollSpeed: number = 400;

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

    // Track when any game object (handle or train body) is being dragged so
    // we can suppress single-pointer camera panning during that drag.
    scene.input.on('dragstart', () => {
      this._objectDragActive = true;
      // Cancel any camera drag that may have started on the same pointerdown
      this.isDragging = false;
    });
    scene.input.on('dragend', () => {
      this._objectDragActive = false;
    });

    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Middle-mouse drag (desktop) — suppressed when editor tool owns input
      if (pointer.middleButtonDown() && this._inputLockOwner === 'camera') {
        this.isDragging = true;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.setCursor('grabbing');
        this.stopFollow();
      }

      // Left-button single-pointer pan (only in pan-allowed mode and no object drag)
      if (pointer.leftButtonDown() && this._inputLockOwner === 'camera' && !this._objectDragActive && this.pinchPointers.size < 2) {
        this.isDragging = true;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.setCursor('grabbing');
        this.stopFollow();
      }

      // Track all active pointers for two-finger gestures (suppressed when editor tool owns input)
      if (this._inputLockOwner === 'camera') {
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
      }
    });

    scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      // Stop camera pan the moment an object drag takes over
      if (this._objectDragActive) {
        this.isDragging = false;
      }

      // Single-pointer camera pan
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

      // Two-finger pan + pinch-to-zoom (suppressed when editor tool owns input)
      if (this._inputLockOwner === 'camera' && this.pinchPointers.size === 2 && this.lastPinchCenter) {
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
      // Wheel zoom is suppressed when editor tool owns input
      if (this._inputLockOwner !== 'camera') return;
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
   * Set the input-lock owner. When a non-camera owner takes the lock,
   * immediately cancels any active camera drag and clears gesture state.
   */
  setInputLockOwner(owner: InputLockOwner): void {
    const wasCamera = this._inputLockOwner === 'camera';
    const isCamera = owner === 'camera';
    this._inputLockOwner = owner;

    // When a non-camera owner takes the lock, cancel active drag immediately
    if (!isCamera && wasCamera) {
      this.isDragging = false;
      this.pinchPointers.clear();
      this.lastPinchCenter = null;
      this.lastPinchDist = 0;
      this.setCursor('default');
    }

    if (!isCamera) this.setCursor('default');
  }

  /** Get the current input-lock owner for debugging. */
  getInputLockOwner(): InputLockOwner {
    return this._inputLockOwner;
  }

  /** @deprecated Use setInputLockOwner instead */
  setBlockPan(block: boolean): void {
    this.setInputLockOwner(block ? 'editor-tool' : 'camera');
  }

  /** Update the CSS cursor on the game canvas. */
  setCursor(cursor: string): void {
    if (this.canvas) this.canvas.style.cursor = cursor;
  }

  update(_time: number, delta: number): void {
    if (!this.isDragging && !this.following && this._inputLockOwner === 'camera') {
      this.controls.update(delta);
    }

    // Edge scrolling during drag when object-drag is active (suppresses keyboard control panning)
    if (this._edgeScrollEnabled && this._inputLockOwner === 'object-drag') {
      const { width, height } = this.cam;
      const ptr = this.cam.scene.input.activePointer;
      let scrollX = 0;
      let scrollY = 0;

      if (ptr.x < this._edgeScrollMargin) scrollX = -this._edgeScrollSpeed * (delta / 1000);
      if (ptr.x > width - this._edgeScrollMargin) scrollX = this._edgeScrollSpeed * (delta / 1000);
      if (ptr.y < this._edgeScrollMargin) scrollY = -this._edgeScrollSpeed * (delta / 1000);
      if (ptr.y > height - this._edgeScrollMargin) scrollY = this._edgeScrollSpeed * (delta / 1000);

      if (scrollX !== 0 || scrollY !== 0) {
        this.cam.scrollX += scrollX / this.cam.zoom;
        this.cam.scrollY += scrollY / this.cam.zoom;
      }
    }
  }

  /** Enable or disable edge scrolling during drag. */
  setEdgeScrollEnabled(enabled: boolean): void {
    this._edgeScrollEnabled = enabled;
  }
}
