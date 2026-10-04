import Phaser from 'phaser';
import { SaveService } from '../services/SaveService';
import { createPlatformStorage } from '../platform/PlatformStorage';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {}

  create(): void {
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    if (typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined' && __RAIL_SIM_TEST_CONTROLS__
      && new URL(window.location.href).searchParams.get('legacyAcceptanceFixture') === '1') {
      SaveService.useLegacyPersistenceForAcceptanceTests();
      this.scene.start('PreloadScene');
      return;
    }
    try { await SaveService.initialize(await createPlatformStorage()); }
    catch (error) {
      // Keep existing exports accessible when the platform refuses storage.
      SaveService.reportPersistenceFailure(error);
      console.error('Save storage unavailable; prototype saves remain accessible.', error);
    }
    this.scene.start('PreloadScene');
  }
}
