import Phaser from 'phaser';
import { SaveService } from '../services/SaveService';
import { MainMenu } from '../ui/MainMenu';
import { createRiversideRegion } from '../region/RiversideRegion';

declare global {
  interface Window {
    __railSimScene: string;
  }
}

/** Title presentation has no physics, world ownership or persistence side effects. */
export default class MenuScene extends Phaser.Scene {
  private menu?: MainMenu;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    this.menu?.destroy();
    const worldId = SaveService.getLastPlayedWorldId();
    const world = worldId ? SaveService.loadWorld(worldId) : null;

    this.menu = new MainMenu({
      parent: this.game.canvas.parentElement ?? document.body,
      savedWorldName: world?.name,
      onNew: () => {
        const brookford = createRiversideRegion();
        if (!SaveService.saveWorld(brookford)) return false;
        this.scene.start('WorldScene', { worldId: brookford.id, mode: 'create' });
      },
      onWorlds: () => { this.scene.start('WorldSelectScene'); },
      onSettings: () => { this.scene.start('SettingsScene'); },
      onContinue: () => {
        // A save may have been removed in another window since opening the menu.
        if (worldId && SaveService.loadWorld(worldId)) {
          this.scene.start('WorldScene', { worldId, mode: 'create' });
        } else {
          this.scene.start('WorldSelectScene');
        }
      },
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menu?.destroy();
      this.menu = undefined;
    });

    if (typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined' && __RAIL_SIM_TEST_CONTROLS__) {
      window.__railSimScene = 'MenuScene';
    }
  }
}
