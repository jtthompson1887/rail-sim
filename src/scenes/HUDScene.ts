import Phaser from 'phaser';
import { GameStateManager } from '../managers/GameStateManager';
import { EventBus } from '../services/EventBus';
import { isMobileWidth, responsiveFontSize, touchSafeSize } from '../utils/responsive';

export default class HUDScene extends Phaser.Scene {
  private timeText!: Phaser.GameObjects.Text;
  private trainsText!: Phaser.GameObjects.Text;
  private modeToggleBtn!: Phaser.GameObjects.Text;
  private modeLabelText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'HUDScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const mobile = isMobileWidth(width);

    const hudFontSize = responsiveFontSize(20, width, height, 12, 20);
    const labelFontSize = responsiveFontSize(22, width, height, 13, 22);

    // Time display (bottom-left)
    this.timeText = this.add.text(12, height - 48, '', {
      fontFamily: 'Verdana',
      fontSize: hudFontSize,
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 8, y: 5 },
    }).setScrollFactor(0).setDepth(300);

    this.trainsText = this.add.text(12, height - 84, '', {
      fontFamily: 'Verdana',
      fontSize: responsiveFontSize(18, width, height, 11, 18),
      color: '#d2e6ff',
    }).setScrollFactor(0).setDepth(300);

    // Current mode label (top-left)
    this.modeLabelText = this.add.text(12, 12, '', {
      fontFamily: 'Verdana',
      fontSize: labelFontSize,
      fontStyle: 'bold',
      color: '#4ad5ff',
      backgroundColor: '#00000088',
      padding: { x: 8, y: 5 },
    }).setScrollFactor(0).setDepth(300);

    // Mode toggle button (top-right)
    const toggleFontSize = responsiveFontSize(26, width, height, 14, 26);
    const togglePadX = mobile ? 10 : 16;
    const togglePadY = mobile ? 6 : 8;
    this.modeToggleBtn = this.add.text(width - 12, 12, '', {
      fontFamily: 'Verdana',
      fontSize: toggleFontSize,
      fontStyle: 'bold',
      color: '#ffffff',
      backgroundColor: '#1a3a5c',
      padding: { x: togglePadX, y: togglePadY },
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
   * Sizes are proportional to the viewport so buttons remain easily tappable.
   */
  private createMobileControls(): void {
    const { width, height } = this.scale;

    // Button size: 15% of viewport width, but at least MIN_TOUCH_TARGET_PX and
    // no more than 120 px, so they're comfortably tappable on any screen.
    const btnSize = touchSafeSize(Math.min(120, Math.round(width * 0.15)));
    const margin = Math.round(width * 0.04);
    const btnX = width - margin - btnSize / 2;

    const iconFontSize = `${Math.round(btnSize * 0.42)}px`;
    const labelFontSize = `${Math.max(11, Math.round(btnSize * 0.2))}px`;

    const accelY = height - margin - btnSize * 2 - 10;
    const accelBtn = this.add
      .rectangle(btnX, accelY, btnSize, btnSize, 0x22bb44, 0.85)
      .setStrokeStyle(3, 0xffffff, 0.6)
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(btnX, accelY, '▲', { fontFamily: 'Verdana', fontSize: iconFontSize, color: '#ffffff' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(201);

    accelBtn.on('pointerdown', () => EventBus.emit('mobile:throttle', { value: 1 }));
    accelBtn.on('pointerup',   () => EventBus.emit('mobile:throttle', { value: 0 }));
    accelBtn.on('pointerout',  () => EventBus.emit('mobile:throttle', { value: 0 }));

    const brakeY = height - margin - btnSize / 2;
    const brakeBtn = this.add
      .rectangle(btnX, brakeY, btnSize, btnSize, 0xbb2222, 0.85)
      .setStrokeStyle(3, 0xffffff, 0.6)
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(btnX, brakeY, '▼', { fontFamily: 'Verdana', fontSize: iconFontSize, color: '#ffffff' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(201);

    brakeBtn.on('pointerdown', () => EventBus.emit('mobile:throttle', { value: -1 }));
    brakeBtn.on('pointerup',   () => EventBus.emit('mobile:throttle', { value: 0 }));
    brakeBtn.on('pointerout',  () => EventBus.emit('mobile:throttle', { value: 0 }));

    this.add.text(btnX, accelY - btnSize / 2 - 6, 'THROTTLE', {
      fontFamily: 'Verdana', fontSize: labelFontSize, color: '#d2e6ff',
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
