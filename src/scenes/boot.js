import Phaser from 'phaser';

class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        // Load any assets you need for your preloader here
    }

    create() {
        // In this example, we'll just start the Preload scene right away
        this.scene.start('PreloadScene');
    }
}

export default BootScene;
