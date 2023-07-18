import Phaser from "phaser";

export default class Train extends Phaser.GameObjects.Container {
    constructor(scene, p0, p1, p2) {
        super(scene);
        scene.add.existing(this);

        this.texture1 = 'train';

        this.updateTrackVectors(p0, p1, p2);
    }
}