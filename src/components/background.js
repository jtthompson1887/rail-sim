import Phaser from "phaser";


export default class Background extends Phaser.GameObjects.Container {

    constructor(scene, width, height) {
        super(scene);
        scene.add.existing(this);
        this.setupBackground(scene, width, height)
    }

    setupBackground(scene, width, height) {
        this.map = scene.make.tilemap({ tileWidth: 1380, tileHeight: 1380, width: width, height: height });

        let grass = this.map.addTilesetImage('grass-set')

        let mainLayer = this.map.createBlankLayer("main", grass, 0, 0, 20, 20, 1380, 1380);
        mainLayer.setScale(0.2);
        let gridSize = 20; // Number of tiles in each row and column
        let tileIndices = [0, 1, 2]; // Tile indices for the different textures

        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                let randomIndex = Phaser.Math.RND.between(0, tileIndices.length - 1);
                let tileIndex = tileIndices[randomIndex];
                mainLayer.putTileAt(tileIndex, x, y);
            }
        }
        scene.add.existing(this.map)
    }
}