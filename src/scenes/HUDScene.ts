import Phaser from 'phaser';
import { GameStateManager } from '../managers/GameStateManager';
import { EventBus } from '../services/EventBus';

export default class HUDScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private trainsText!: Phaser.GameObjects.Text;
  private objectivesText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'HUDScene' });
  }

  create(): void {
    this.scoreText = this.add.text(20, 20, '', { fontFamily: 'Verdana', fontSize: '24px', color: '#ffffff', backgroundColor: '#00000088', padding: { x: 10, y: 6 } }).setScrollFactor(0);
    this.timeText = this.add.text(20, 60, '', { fontFamily: 'Verdana', fontSize: '20px', color: '#ffffff' }).setScrollFactor(0);
    this.trainsText = this.add.text(20, 90, '', { fontFamily: 'Verdana', fontSize: '20px', color: '#ffffff' }).setScrollFactor(0);
    this.objectivesText = this.add.text(20, 140, '', { fontFamily: 'Verdana', fontSize: '20px', color: '#ffe9a8', lineSpacing: 8, wordWrap: { width: 600 } }).setScrollFactor(0);

    if (this.sys.game.device.input.touch) {
      this.createMobileControls();
    }
  }

  /**
   * Create on-screen throttle buttons for touch/mobile devices.
   * Emits 'mobile:throttle' events via EventBus so InputManager
   * can control the selected train.
   */
  private createMobileControls(): void {
    const { width, height } = this.scale;
    const btnSize = 130;
    const margin = 40;
    const btnX = width - margin - btnSize / 2;

    // Accelerate button (top)
    const accelY = height - margin - btnSize * 2 - 20;
    const accelBtn = this.add
      .rectangle(btnX, accelY, btnSize, btnSize, 0x22bb44, 0.85)
      .setStrokeStyle(3, 0xffffff, 0.6)
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(btnX, accelY, '▲', { fontFamily: 'Verdana', fontSize: '56px', color: '#ffffff' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    accelBtn.on('pointerdown', () => EventBus.emit('mobile:throttle', { value: 1 }));
    accelBtn.on('pointerup', () => EventBus.emit('mobile:throttle', { value: 0 }));
    accelBtn.on('pointerout', () => EventBus.emit('mobile:throttle', { value: 0 }));

    // Brake / reverse button (bottom)
    const brakeY = height - margin - btnSize / 2;
    const brakeBtn = this.add
      .rectangle(btnX, brakeY, btnSize, btnSize, 0xbb2222, 0.85)
      .setStrokeStyle(3, 0xffffff, 0.6)
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(btnX, brakeY, '▼', { fontFamily: 'Verdana', fontSize: '56px', color: '#ffffff' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    brakeBtn.on('pointerdown', () => EventBus.emit('mobile:throttle', { value: -1 }));
    brakeBtn.on('pointerup', () => EventBus.emit('mobile:throttle', { value: 0 }));
    brakeBtn.on('pointerout', () => EventBus.emit('mobile:throttle', { value: 0 }));

    // Label
    this.add
      .text(btnX, accelY - btnSize / 2 - 24, 'THROTTLE', {
        fontFamily: 'Verdana',
        fontSize: '22px',
        color: '#d2e6ff',
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(200);
  }

  update(): void {
    this.scoreText.setText(`Score: ${GameStateManager.score}`);
    this.timeText.setText(`Time: ${GameStateManager.elapsedSecs.toFixed(1)}s`);
    this.trainsText.setText(`Active trains: ${GameStateManager.activeTrains}`);
    const objectives = (this.registry.get('hud.objectives') as Array<{ text: string; status: string; progress: number }> | undefined) || [];
    this.objectivesText.setText(objectives.length ? objectives.map((objective) => `${objective.status.toUpperCase()}: ${objective.text}`).join('\n') : 'Objectives loading...');
  }
}
