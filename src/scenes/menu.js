import Phaser from 'phaser';

export default class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create() {
        this.add.text(400, 300, 'Phaser Game', { fontSize: '32px', fill: '#fff' });

        this.add.text(400, 400, 'Start', { fontSize: '32px', fill: '#fff' })
            .setInteractive()
            .on('pointerdown', () => this.startGame());
    }

    startGame() {
        this.scene.start('GameScene');
    }
}
