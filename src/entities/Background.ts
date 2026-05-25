import Phaser from 'phaser';

export default class Background extends Phaser.GameObjects.Container {
  private map?: Phaser.Tilemaps.Tilemap;

  constructor(scene: Phaser.Scene, width: number, height: number) {
    super(scene);
    scene.add.existing(this);
    this.setupBackground(scene, width, height);
  }

  private setupBackground(scene: Phaser.Scene, width: number, height: number): void {
    this.map = scene.make.tilemap({ tileWidth: 1380, tileHeight: 1380, width, height });

    const grass = this.map.addTilesetImage('grass-set');
    if (!grass) {
      return;
    }

    const mainLayer = this.map.createBlankLayer('main', grass, 0, 0, width, height, 1380, 1380);
    if (!mainLayer) {
      return;
    }

    mainLayer.setScale(0.2);
    const gridSize = 20;
    const tileIndices = [0, 1, 2];

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const randomIndex = Phaser.Math.RND.between(0, tileIndices.length - 1);
        mainLayer.putTileAt(tileIndices[randomIndex], x, y);
      }
    }
  }
}
