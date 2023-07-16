import Phaser from 'phaser';

import BootScene from './scenes/boot';
import PreloadScene from './scenes/preload';
import MenuScene from './scenes/menu';
import GameScene from './scenes/game';

const config = {
    type: Phaser.AUTO,
    width: 1920,
    height: 1080,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
        default: 'matter',
        matter: {
            // Matter.js configuration
            // ...
        }
    },
    scene: [BootScene, PreloadScene, MenuScene, GameScene]
};

const game = new Phaser.Game(config);
