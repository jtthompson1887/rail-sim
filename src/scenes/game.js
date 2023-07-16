import Phaser from 'phaser';

export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    preload() {
        // Load your game assets here. For example:
        // this.load.image('star', 'assets/star.png');
    }

    create() {
        // Create your game objects here. For example:
        // this.add.image(400, 300, 'star');
    }

    update() {
        // Game loop. You can create movement and game logic here.
    }
}
