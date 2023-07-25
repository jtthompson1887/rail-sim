import Phaser, {Scene} from "phaser";


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


    constructor(scene :Scene) {

        const cursors = scene.input.keyboard.createCursorKeys();

        this.controlConfig = {
            camera: scene.cameras.main,
            left: cursors.left,
            right: cursors.right,
            up: cursors.up,
            down: cursors.down,
            zoomIn: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
            zoomOut: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            acceleration: 0.06,
            drag: 0.0005,
            maxSpeed: 1.0
        };

        this.controls = new Phaser.Cameras.Controls.SmoothedKeyControl(this.controlConfig);

    }

    public update(time, delta) {
        this.controls.update(delta);
    }


}