import Phaser from 'phaser';
import Background from "../components/background";

export default class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    preload() {

    }

    create() {


        //this.add.tileSprite(0, 0, 1920, 1080, 'grassbackground').setOrigin(0, 0).setTileScale(0.1, 0.1).setFlipY(Phaser.Math.Between(0, 1));
        let bg = new Background(this, 20, 20)



        // Set the camera to show a smaller portion of the tilemap, creating the appearance of repetition

        this.add.text(400, 300, 'Rail Sim', { fontSize: '164px', fill: '#fff', fontFamily: 'Verdana' });

        this.add.text(400, 500, 'Start', { fontSize: '64px', fill: '#fff', fontFamily: 'Verdana' })
            .setInteractive()
            .on('pointerdown', () => this.startGame());
    }

    startGame() {
        this.scene.start('GameScene');
    }
}
