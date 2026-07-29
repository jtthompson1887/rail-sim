import Phaser from 'phaser';
import { GameStateManager } from '../managers/GameStateManager';
import { EventBus } from '../services/EventBus';

export default class PauseScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PauseScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7);
    this.add.text(width / 2, height * 0.3, 'Paused', { fontFamily: 'Verdana', fontSize: '64px', color: '#ffffff' }).setOrigin(0.5);

    const resume = this.add.text(width / 2, height * 0.45, 'Resume', { fontFamily: 'Verdana', fontSize: '36px', color: '#7dff9b' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.resumeGame());
    resume.setPadding(12);

    const toCreate = this.add.text(width / 2, height * 0.56, '✎ Return to Create', { fontFamily: 'Verdana', fontSize: '32px', color: '#4ad5ff' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.returnToCreate());
    toCreate.setPadding(12);

    const quit = this.add.text(width / 2, height * 0.67, 'Quit to Menu', { fontFamily: 'Verdana', fontSize: '32px', color: '#ffffff' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.quitToMenu());
    quit.setPadding(12);

    this.input.keyboard.once('keydown-ESC', () => this.resumeGame());
    this.input.keyboard.once('keydown-SPACE', () => this.resumeGame());
    this.input.keyboard.once('keydown-ENTER', () => this.resumeGame());
  }

  private resumeGame(): void {
    EventBus.emit('ui:pause-visible', { visible: false });
    GameStateManager.resume();
    this.scene.resume('WorldScene');
    this.scene.resume('GameScene');
    this.scene.stop();
  }

  private returnToCreate(): void {
    GameStateManager.returnToCreate();
    EventBus.emit('ui:pause-visible', { visible: false });
    this.scene.resume('WorldScene');
    this.scene.stop();
  }

  private quitToMenu(): void {
    EventBus.emit('ui:pause-visible', { visible: false });
    this.scene.stop('HUDScene');
    this.scene.stop('DebugOverlayScene');
    this.scene.stop('WorldScene');
    this.scene.stop('GameScene');
    this.scene.start('MenuScene');
    this.scene.stop();
  }
}
