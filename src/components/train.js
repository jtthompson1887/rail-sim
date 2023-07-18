import Phaser from "phaser";

export default class Train extends Phaser.GameObjects.Container {
    constructor(scene, x, y) {
        super(scene);
        this.scene = scene;
        this.scene.add.existing(this);
        //const Bodies = Phaser.Physics.Matter.Matter.Bodies;
        this.texture = 'train1';
        this.train = scene.matter.add.image(x, y, this.texture, null);
        if (this.train instanceof Phaser.Physics.Matter.Image) {
            this.train.setVelocityX(5)
        }
        this.add(this.train)
    }
}