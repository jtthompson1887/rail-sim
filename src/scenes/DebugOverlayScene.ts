import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';

export default class DebugOverlayScene extends Phaser.Scene {
  private debugText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'DebugOverlayScene' });
  }

  create(): void {
    this.debugText = this.add.text(16, 16, '', {
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 10, y: 5 },
      fixedWidth: 320,
    }).setDepth(1000).setScrollFactor(0).setAlpha(0.8);

    if (!GameConfig.DEBUG) {
      this.debugText.setVisible(false);
    }
  }

  update(): void {
    if (!GameConfig.DEBUG) {
      return;
    }
    const debugState = this.registry.get('debug.overlay') as Record<string, string | number> | undefined;
    if (!debugState) {
      this.debugText.setText('Debug waiting...');
      return;
    }
    this.debugText.setText([
      `Camera: (${debugState.cameraX}, ${debugState.cameraY})`,
      `Zoom: ${debugState.zoom}`,
      `Mouse World: (${debugState.mouseX}, ${debugState.mouseY})`,
      `Train: (${debugState.trainX}, ${debugState.trainY})`,
      `Engine Power: ${debugState.enginePower}`,
      `Track: ${debugState.trackId}`,
    ].join('\n'));
  }
}
