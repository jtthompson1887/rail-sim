import Phaser from 'phaser';
import { GameConfig } from './config/GameConfig';
import BootScene from './scenes/BootScene';
import DebugOverlayScene from './scenes/DebugOverlayScene';
import GameOverScene from './scenes/GameOverScene';
import GameScene from './scenes/GameScene';
import HUDScene from './scenes/HUDScene';
import LevelSelectScene from './scenes/LevelSelectScene';
import MenuScene from './scenes/MenuScene';
import PauseScene from './scenes/PauseScene';
import PreloadScene from './scenes/PreloadScene';
import SettingsScene from './scenes/SettingsScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: GameConfig.RESOLUTION.WIDTH,
  height: GameConfig.RESOLUTION.HEIGHT,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'matter',
    matter: {
      debug: GameConfig.DEBUG,
      gravity: {
        y: GameConfig.PHYSICS.GRAVITY_Y,
      },
    },
  },
  scene: [
    BootScene,
    PreloadScene,
    MenuScene,
    LevelSelectScene,
    GameScene,
    HUDScene,
    PauseScene,
    GameOverScene,
    DebugOverlayScene,
    SettingsScene,
  ],
};

new Phaser.Game(config);
