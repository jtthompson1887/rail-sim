import Phaser from "phaser";
import {PIDController} from "../utils/math";
import type RailTrack from "./track";

export default class Train extends Phaser.GameObjects.Container {

    private _trainBody: Phaser.Physics.Matter.Image;
    private texture: string;
    private readonly _pidController: PIDController = new PIDController();
    private _currentTrack: RailTrack = null;
    private _derailed: boolean = false;
    private _enginePower: number = -0.5;
    constructor(scene:Phaser.Scene, x:number, y:number) {
        super(scene);
        this.scene = scene;
        this.scene.add.existing(this);
        //const Bodies = Phaser.Physics.Matter.Matter.Bodies;
        this.texture = 'train1';
        this._trainBody = scene.matter.add.image(x, y, this.texture, null);
        this._trainBody.setScale(0.6, 0.6)
        this._trainBody.setMass(1000)
        this.add(this._trainBody)
    }

    update(time, delta) {
        if (!this.derailed)
            this.getMatterBody().thrust(this._enginePower)
    }

    get derailed(): boolean {
        return this._derailed;
    }

    set derailed(value: boolean) {

        if (value) {
            this.texture = 'train2'
            this._trainBody.setTexture(this.texture)
        }

        this._derailed = value;
    }

    get enginePower(): number {
        return this._enginePower;
    }

    set enginePower(value: number) {
        this._enginePower = value;
    }

    get pidController(): PIDController {
        return this._pidController;
    }
    getMatterBody() {
        return this._trainBody;
    }

    get currentTrack() : RailTrack {
        return this._currentTrack;
    }

    set currentTrack(value : RailTrack) {
        this._currentTrack = value;
    }

}