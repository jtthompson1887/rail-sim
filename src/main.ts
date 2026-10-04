import Phaser from 'phaser';
import { GameConfig } from './config/GameConfig';
import BootScene from './scenes/BootScene';
import DebugOverlayScene from './scenes/DebugOverlayScene';
import EditorUIScene from './scenes/EditorUIScene';
import GameOverScene from './scenes/GameOverScene';
import GameScene from './scenes/GameScene';
import HUDScene from './scenes/HUDScene';
import LevelSelectScene from './scenes/LevelSelectScene';
import MenuScene from './scenes/MenuScene';
import PauseScene from './scenes/PauseScene';
import PreloadScene from './scenes/PreloadScene';
import SettingsScene from './scenes/SettingsScene';
import WorldSelectScene from './scenes/WorldSelectScene';
import WorldScene from './scenes/WorldScene';
import { recoverDerailedFollowerOnTrack } from './managers/TrainManager';
import { WorldManager } from './managers/WorldManager';
import { SaveService } from './services/SaveService';
import { EventBus } from './services/EventBus';

/** Expose game instance for Playwright / E2E tests. */
declare global {
  interface Window {
    __railSimGame: Phaser.Game;
    __railSimRecoverDerailedFollowerOnTrack: typeof recoverDerailedFollowerOnTrack;
  }
}

if (
  typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined'
  && __RAIL_SIM_TEST_CONTROLS__
) {
  window.__railSimRecoverDerailedFollowerOnTrack = recoverDerailedFollowerOnTrack;
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  scale: {
    mode: Phaser.Scale.RESIZE,
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
    WorldSelectScene,
    WorldScene,
    EditorUIScene,
    LevelSelectScene,
    GameScene,
    HUDScene,
    PauseScene,
    GameOverScene,
    DebugOverlayScene,
    SettingsScene,
  ],
};

const game = new Phaser.Game(config);
window.railSimStorage?.onBeforeClose?.(async () => {
  EventBus.emit('app:prepare-close', {});
  if (WorldManager.world && !WorldManager.save()) throw new Error('The current world could not be saved.');
  await SaveService.flush();
});
if (
  typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined'
  && __RAIL_SIM_TEST_CONTROLS__
) {
  window.__railSimGame = game;
}
