import Phaser, {Scene} from "phaser";
import GameObject = Phaser.GameObjects.GameObject;
import Camera = Phaser.Cameras.Scene2D.Camera;

export class CameraController {

    private readonly controlConfig: {
        acceleration: number;
        camera: any;
        down: Phaser.Input.Keyboard.Key;
        drag: number;
        left: Phaser.Input.Keyboard.Key;
        maxSpeed: number;
        right: Phaser.Input.Keyboard.Key;
        up: Phaser.Input.Keyboard.Key;
        zoomIn: Phaser.Input.Keyboard.Key;
        zoomOut: Phaser.Input.Keyboard.Key
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
            acceleration: 0.06,
            drag: 0.0015,
            maxSpeed: 3.0
        };

        this.controls = new Phaser.Cameras.Controls.SmoothedKeyControl(this.controlConfig);

        // Setup middle mouse button drag
        scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (pointer.middleButtonDown()) {
                console.log('Camera: Starting drag');
                this.isDragging = true;
                this.dragStartX = pointer.x;
                this.dragStartY = pointer.y;
                // Stop following when starting to drag
                this.stopFollow();
            }
        });

        scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (this.isDragging) {
                const deltaX = pointer.x - this.dragStartX;
                const deltaY = pointer.y - this.dragStartY;
                this.cam.scrollX -= deltaX / this.cam.zoom;  // Account for zoom
                this.cam.scrollY -= deltaY / this.cam.zoom;  // Account for zoom
                this.dragStartX = pointer.x;
                this.dragStartY = pointer.y;
            }
        });

        scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            if (pointer.button === 1) { // Middle button
                console.log('Camera: Stopping drag');
                this.isDragging = false;
            }
        });

        // Setup mouse wheel zoom
        scene.input.on('wheel', (pointer: Phaser.Input.Pointer, gameObjects: GameObject[], deltaX: number, deltaY: number) => {
            const zoomAmount = 0.03;
            const minZoom = 0.1;
            const maxZoom = 2.0;
            
            // Calculate new zoom level
            const oldZoom = this.cam.zoom;
            const newZoom = Phaser.Math.Clamp(
                oldZoom * (deltaY > 0 ? (1 - zoomAmount) : (1 + zoomAmount)),
                minZoom,
                maxZoom
            );

            // Get the world point that we want to zoom toward
            const mouseX = pointer.x;
            const mouseY = pointer.y;
            
            // Calculate the distance from the camera's current scroll position to the mouse in world space
            const distanceX = (mouseX - this.cam.width / 2) / oldZoom;
            const distanceY = (mouseY - this.cam.height / 2) / oldZoom;
            
            // Set the new zoom
            this.cam.zoom = newZoom;
            
            // Update camera position to maintain the relative distance
            this.cam.scrollX += distanceX * (1 - oldZoom / newZoom);
            this.cam.scrollY += distanceY * (1 - oldZoom / newZoom);
        });
    }

    startFollow(object: GameObject) {
        console.log('Camera: Starting follow');
        this.following = object;
        this.cam.startFollow(object);
    }

    stopFollow() {
        if (this.following) {
            console.log('Camera: Stopping follow');
            this.following = null;
            this.cam.stopFollow();
        }
    }

    update(time: number, delta: number) {
        if (!this.isDragging && !this.following) {
            this.controls.update(delta);
        }
    }
}