import Phaser from 'phaser';
import { GameStateManager } from '../managers/GameStateManager';
import { EventBus } from '../services/EventBus';

export default class HUDScene extends Phaser.Scene {
  private timeText!: Phaser.GameObjects.Text;
  private trainsText!: Phaser.GameObjects.Text;
  private modeToggleBtn!: Phaser.GameObjects.Text;
  private modeLabelText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'HUDScene' });
  }

  create(): void {
    const { height } = this.scale;

    // Time display (bottom-left)
    this.timeText = this.add.text(20, height - 60, '', {
      fontFamily: 'Verdana',
      fontSize: '20px',
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 10, y: 6 },
    }).setScrollFactor(0).setDepth(300);

    this.trainsText = this.add.text(20, height - 100, '', {
      fontFamily: 'Verdana',
      fontSize: '18px',
      color: '#d2e6ff',
    }).setScrollFactor(0).setDepth(300);

    // Current mode label (top-right)
    this.modeLabelText = this.add.text(20, 20, '', {
      fontFamily: 'Verdana',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#4ad5ff',
      backgroundColor: '#00000088',
      padding: { x: 10, y: 6 },
    }).setScrollFactor(0).setDepth(300);

    // Mode toggle button
    const { width } = this.scale;
    this.modeToggleBtn = this.add.text(width - 20, 20, '', {
      fontFamily: 'Verdana',
      fontSize: '26px',
      fontStyle: 'bold',
      color: '#ffffff',
      backgroundColor: '#1a3a5c',
      padding: { x: 16, y: 8 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(300)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.modeToggleBtn.setColor('#4ad5ff'))
      .on('pointerout', () => this.modeToggleBtn.setColor('#ffffff'))
      .on('pointerdown', () => this.toggleMode());

    if (this.sys.game.device.input.touch) {
      this.createMobileControls();
    }
  }

  private toggleMode(): void {
    const current = GameStateManager.worldMode;
    const worldId = GameStateManager.currentWorldId;
    if (!worldId) return;

    if (current === 'create') {
      GameStateManager.enterPlay(worldId);
    } else {
      GameStateManager.returnToCreate();
    }
  }

  /**
   * Create on-screen throttle buttons for touch/mobile devices.
   */
  private createMobileControls(): void {
    const { width, height } = this.scale;
    const btnSize = 130;
    const margin = 40;
    const btnX = width - margin - btnSize / 2;

    const accelY = height - margin - btnSize * 2 - 20;
    const accelBtn = this.add
      .rectangle(btnX, accelY, btnSize, btnSize, 0x22bb44, 0.85)
      .setStrokeStyle(3, 0xffffff, 0.6)
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(btnX, accelY, '▲', { fontFamily: 'Verdana', fontSize: '56px', color: '#ffffff' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(201);

    accelBtn.on('pointerdown', () => EventBus.emit('mobile:throttle', { value: 1 }));
    accelBtn.on('pointerup', () => EventBus.emit('mobile:throttle', { value: 0 }));
    accelBtn.on('pointerout', () => EventBus.emit('mobile:throttle', { value: 0 }));

    const brakeY = height - margin - btnSize / 2;
    const brakeBtn = this.add
      .rectangle(btnX, brakeY, btnSize, btnSize, 0xbb2222, 0.85)
      .setStrokeStyle(3, 0xffffff, 0.6)
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(btnX, brakeY, '▼', { fontFamily: 'Verdana', fontSize: '56px', color: '#ffffff' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(201);

    brakeBtn.on('pointerdown', () => EventBus.emit('mobile:throttle', { value: -1 }));
    brakeBtn.on('pointerup', () => EventBus.emit('mobile:throttle', { value: 0 }));
    brakeBtn.on('pointerout', () => EventBus.emit('mobile:throttle', { value: 0 }));

    this.add.text(btnX, accelY - btnSize / 2 - 24, 'THROTTLE', {
      fontFamily: 'Verdana', fontSize: '22px', color: '#d2e6ff',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(200);
  }

  update(): void {
    const mode = GameStateManager.worldMode;
    const isPlay = mode === 'play';

    this.modeLabelText.setText(mode === 'create' ? '✎ Create Mode' : '▶ Play Mode');
    this.modeToggleBtn.setText(isPlay ? '✎ Edit World' : '▶ Play');
    this.timeText.setText(`Time: ${GameStateManager.elapsedSecs.toFixed(1)}s`);
    this.trainsText.setText(`Trains: ${GameStateManager.activeTrains}`);
  }
}
