import Phaser from "phaser";
import {matterVec, qVec} from "../utils/math";

export default class Train extends Phaser.GameObjects.Container {
    constructor(scene, x, y) {
        super(scene);
        this.scene = scene;
        this.scene.add.existing(this);
        //const Bodies = Phaser.Physics.Matter.Matter.Bodies;
        this.texture = 'train1';
        this.train = scene.matter.add.image(x, y, this.texture, null);
        this.train.setScale(0.6, 0.6)
        this.train.setMass(100)
        this.add(this.train)
    }

    getMatterBody() {
        return this.train;
    }




}