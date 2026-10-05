import Phaser from 'phaser';
import { GameStateManager } from '../managers/GameStateManager';
import { WorldManager } from '../managers/WorldManager';
import { EventBus } from '../services/EventBus';
import { isRiverside } from '../region/RiversideRegion';
import { isMobileWidth, responsiveFontSize, touchSafeSize, scalePx } from '../utils/responsive';

export default class HUDScene extends Phaser.Scene {
  private timeText!: Phaser.GameObjects.Text;
  private trainsText!: Phaser.GameObjects.Text;
  private modeToggleBtn!: Phaser.GameObjects.Text;
  private modeLabelText!: Phaser.GameObjects.Text;
  private mobileControls: Phaser.GameObjects.GameObject[] = [];
  private mobileThrottleHeld = false;
  private readonly regionalEnabledHandler = () => {
    if (this.isRegionalWorld()) this.destroyMobileControls(true);
  };

  constructor() {
    super({ key: 'HUDScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const mobile = isMobileWidth(width);

    // The left sidebar (EditorToolbar in WorldScene) occupies the first N px.
    // Use the same breakpoint formula so our top-bar elements don't overlap it.
    const sidebarW = scalePx(72, width, height, mobile ? 44 : 56);

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

    // Current mode label – placed just to the right of the left sidebar
    this.modeLabelText = this.add.text(sidebarW + 8, 8, '', {
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
    this.modeToggleBtn = this.add.text(width - 12, 8, '', {
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
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    EventBus.on('railway:enabled', this.regionalEnabledHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.destroyMobileControls(true);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      EventBus.off('railway:enabled', this.regionalEnabledHandler);
    });
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
  private layoutHud(width: number, height: number): void {
    const mobile = isMobileWidth(width);
    const sidebarW = scalePx(72, width, height, mobile ? 44 : 56);
    this.timeText
      .setPosition(12, height - 48)
      .setFontSize(responsiveFontSize(20, width, height, 12, 20))
      .setPadding({ left: 8, right: 8, top: 5, bottom: 5 });
    this.trainsText
      .setPosition(12, height - 84)
      .setFontSize(responsiveFontSize(18, width, height, 11, 18));
    this.modeLabelText
      .setPosition(sidebarW + 8, 8)
      .setFontSize(responsiveFontSize(22, width, height, 13, 22))
      .setPadding({ left: 8, right: 8, top: 5, bottom: 5 });
    this.modeToggleBtn
      .setPosition(width - 12, 8)
      .setFontSize(responsiveFontSize(26, width, height, 14, 26))
      .setPadding({
        left: mobile ? 10 : 16,
        right: mobile ? 10 : 16,
        top: mobile ? 6 : 8,
        bottom: mobile ? 6 : 8,
      });
  }

  private emitMobileThrottle(value: -1 | 0 | 1): void {
    this.mobileThrottleHeld = value !== 0;
    EventBus.emit('mobile:throttle', {
      value,
      hardStop: false,
    });
  }

  private isRegionalWorld(): boolean {
    const world = WorldManager.world;
    return !!world?.management && world.id === GameStateManager.currentWorldId;
  }

  private destroyMobileControls(neutralize: boolean): void {
    if (neutralize && this.mobileThrottleHeld) {
      this.emitMobileThrottle(0);
    }
    this.mobileControls.forEach((control) => control.destroy());
    this.mobileControls = [];
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.layoutHud(gameSize.width, gameSize.height);
    if (this.sys.game.device.input.touch) {
      this.destroyMobileControls(true);
      this.createMobileControls(gameSize.width, gameSize.height);
    }
  }

  private createMobileControls(
    width = this.scale.width,
    height = this.scale.height,
  ): void {
    if (this.isRegionalWorld()) return;

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
    const accelIcon = this.add
      .text(btnX, accelY, '▲', { fontFamily: 'Verdana', fontSize: iconFontSize, color: '#ffffff' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(201);

    accelBtn.on('pointerdown', () => this.emitMobileThrottle(1));
    accelBtn.on('pointerup',   () => this.emitMobileThrottle(0));
    accelBtn.on('pointerout',  () => this.emitMobileThrottle(0));

    const brakeY = height - margin - btnSize / 2;
    const brakeBtn = this.add
      .rectangle(btnX, brakeY, btnSize, btnSize, 0xbb2222, 0.85)
      .setStrokeStyle(3, 0xffffff, 0.6)
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });
    const brakeIcon = this.add
      .text(btnX, brakeY, '▼', { fontFamily: 'Verdana', fontSize: iconFontSize, color: '#ffffff' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(201);

    brakeBtn.on('pointerdown', () => this.emitMobileThrottle(-1));
    brakeBtn.on('pointerup',   () => this.emitMobileThrottle(0));
    brakeBtn.on('pointerout',  () => this.emitMobileThrottle(0));

    const throttleLabel = this.add.text(
      btnX,
      accelY - btnSize / 2 - 6,
      'THROTTLE',
      {
      fontFamily: 'Verdana', fontSize: labelFontSize, color: '#d2e6ff',
      },
    ).setOrigin(0.5, 1).setScrollFactor(0).setDepth(200);
    this.mobileControls = [
      accelBtn,
      accelIcon,
      brakeBtn,
      brakeIcon,
      throttleLabel,
    ];
  }

  update(): void {
    if (isRiverside(WorldManager.world)) {
      [this.timeText,this.trainsText,this.modeLabelText,this.modeToggleBtn].forEach(item=>item.setVisible(false));
      return;
    }
    const mode = GameStateManager.worldMode;
    const isPlay = mode === 'play';

    this.modeLabelText.setText(mode === 'create' ? '✎ Create Mode' : '▶ Play Mode');
    this.modeToggleBtn.setText(isPlay ? '✎ Edit World' : '▶ Play');
    this.timeText.setText(`Time: ${GameStateManager.elapsedSecs.toFixed(1)}s`);
    this.trainsText.setText(`Trains: ${GameStateManager.activeTrains}`);
  }
}
