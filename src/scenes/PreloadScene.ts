import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload(): void {
    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(240, 270, 320, 50);

    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0xffffff, 1);
      progressBar.fillRect(250, 280, 300 * value, 30);
    });

    this.load.image('grass', 'assets/images/grass.png');
    this.load.image('grass2', 'assets/images/grass2.png');
    this.load.image('grass3', 'assets/images/grass3.png');
    this.load.image('grass-set', 'assets/images/grass-set-edited.png');
    this.load.image('ballast', 'assets/images/ballast.png');
    this.load.image('rail', 'assets/images/rail.png');
    this.load.image('train1', 'assets/images/class43-top-view.png');
    this.load.image('train2', 'assets/images/train2.png');

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
    });
  }

  create(): void {
    this.scene.start('MenuScene');
  }
}
