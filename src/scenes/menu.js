import Phaser from 'phaser';

export default class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    preload() {
        this.load.image('grassbackground', 'assets/images/grass.png');
    }

    create() {


        this.add.tileSprite(0, 0, 1920, 1080, 'grassbackground').setOrigin(0, 0);

        // Set the camera to show a smaller portion of the tilemap, creating the appearance of repetition

        this.add.text(400, 300, 'Phaser Game', { fontSize: '32px', fill: '#fff' });

        this.add.text(400, 400, 'Start', { fontSize: '32px', fill: '#fff' })
            .setInteractive()
            .on('pointerdown', () => this.startGame());
    }

    startGame() {
        this.scene.start('GameScene');
    }
}
