import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    preload() {
        // Display a progress bar
        let progressBar = this.add.graphics();
        let progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(240, 270, 320, 50);

        // Update progress bar
        this.load.on('progress', value => {
            progressBar.clear();
            progressBar.fillStyle(0xffffff, 1);
            progressBar.fillRect(250, 280, 300 * value, 30);
        });

        // Load all your assets here, for example:
        this.load.image('grass', 'assets/images/grass.png');
        this.load.image('grass2', 'assets/images/grass2.png');
        this.load.image('grass3', 'assets/images/grass3.png');
        this.load.image('grass-set', 'assets/images/grass-set-edited.png');
        this.load.image('ballast', 'assets/images/ballast.png');
        this.load.image('rail', 'assets/images/rail.png');
        // this.load.image('enemy', 'assets/images/enemy.png');
        // this.load.audio('backgroundMusic', 'assets/sounds/background.mp3');

        // Remove progress bar when complete
        this.load.on('complete', () => {
            progressBar.destroy();
            progressBox.destroy();
        });
    }

    create() {
        // Once everything is loaded, switch to the menu scene
        this.scene.start('MenuScene');
    }
}
