import Phaser from "phaser";
import {matterVec, qVec} from "../utils/math";

export default class Train extends Phaser.GameObjects.Container {
    constructor(scene, x, y) {
        super(scene);
        this.scene = scene;
        this.scene.add.existing(this);
        //const Bodies = Phaser.Physics.Matter.Matter.Bodies;
        this.texture = 'train1';
        this._trainBody = scene.matter.add.image(x, y, this.texture, null);
        this._trainBody.setScale(0.6, 0.6)
        this._trainBody.setMass(100)
        this.add(this._trainBody)
        this._currentTrack = null
    }

    getMatterBody() {
        return this._trainBody;
    }

    get currentTrack() {
        return this._currentTrack;
    }

    set currentTrack(value) {
        this._currentTrack = value;
    }
}