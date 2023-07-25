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
    private following: boolean = false;


    constructor(scene :Scene) {

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

    }

    public startFollow(object :GameObject) {
        this.following = true;
        this.cam.startFollow(object, true);
    }

    public update(time, delta) {
        if (!this.following)
            this.controls.update(delta);
    }


}