import Phaser from 'phaser';
import { SaveService } from '../services/SaveService';
import { MainMenu } from '../ui/MainMenu';
import { createRiversideRegion } from '../region/RiversideRegion';
import { MenuRailway } from '../presentation/MenuRailway';

declare global {
  interface Window {
    __railSimScene: string;
    __railSimMenuPreview?: () => ReturnType<MenuRailway['frame']>;
  }
}

/** Live title railway is detached from player worlds and never saved. */
export default class MenuScene extends Phaser.Scene {
  private menu?: MainMenu;
  private railway?: MenuRailway;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    this.menu?.destroy();
    this.railway?.destroy();
    this.railway = new MenuRailway(this);
    const worldId = SaveService.getLastPlayedWorldId();
    const world = worldId ? SaveService.loadWorld(worldId) : null;

    this.menu = new MainMenu({
      parent: this.game.canvas.parentElement ?? document.body,
      savedWorldName: world?.name,
      onMotionChange: paused => this.railway?.setPaused(paused),
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
      this.railway?.destroy();
      this.railway = undefined;
      if (typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined' && __RAIL_SIM_TEST_CONTROLS__) delete window.__railSimMenuPreview;
    });

    if (typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined' && __RAIL_SIM_TEST_CONTROLS__) {
      window.__railSimScene = 'MenuScene';
      window.__railSimMenuPreview = () => this.railway!.frame();
    }
  }

  update(_time: number, delta: number): void { this.railway?.update(delta); }
}
