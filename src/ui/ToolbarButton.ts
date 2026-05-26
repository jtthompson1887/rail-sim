import Phaser from 'phaser';

export interface ToolbarButtonConfig {
  label: string;
  tooltip?: string;
  width?: number;
  height?: number;
  color?: number;
  activeColor?: number;
  /** Font size string for the button label, e.g. '22px'. Defaults to '22px'. */
  labelFontSize?: string;
  onPress?: () => void;
}

/**
 * A single rectangular button for use in the create-mode toolbar.
 * Supports an "active" (pressed/toggled) visual state.
 */
export class ToolbarButton {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private _isActive: boolean = false;

  readonly config: Required<ToolbarButtonConfig>;

  constructor(scene: Phaser.Scene, x: number, y: number, cfg: ToolbarButtonConfig) {
    this.config = {
      label: cfg.label,
      tooltip: cfg.tooltip ?? cfg.label,
      width: cfg.width ?? 160,
      height: cfg.height ?? 56,
      color: cfg.color ?? 0x1a3a5c,
      activeColor: cfg.activeColor ?? 0x2a8cff,
      labelFontSize: cfg.labelFontSize ?? '22px',
      onPress: cfg.onPress ?? (() => {}),
    };

    this.container = scene.add.container(x, y).setDepth(600).setScrollFactor(0);

    this.bg = scene.add.rectangle(0, 0, this.config.width, this.config.height, this.config.color, 0.92)
      .setStrokeStyle(2, 0xffffff, 0.3);
    this.bg.setInteractive({ useHandCursor: true })
      .on('pointerover', () => {
        if (!this._isActive) this.bg.setFillStyle(this.config.color, 1);
      })
      .on('pointerout', () => {
        if (!this._isActive) this.bg.setFillStyle(this.config.color, 0.92);
      })
      .on('pointerdown', () => {
        this.config.onPress();
      });

    this.label = scene.add.text(0, 0, this.config.label, {
      fontFamily: 'Verdana',
      fontSize: this.config.labelFontSize,
      color: '#ffffff',
    }).setOrigin(0.5);

    this.container.add([this.bg, this.label]);
  }

  get isActive(): boolean { return this._isActive; }

  setActive(active: boolean): void {
    this._isActive = active;
    if (active) {
      this.bg.setFillStyle(this.config.activeColor, 1);
      this.bg.setStrokeStyle(2, 0xffffff, 0.8);
    } else {
      this.bg.setFillStyle(this.config.color, 0.92);
      this.bg.setStrokeStyle(2, 0xffffff, 0.3);
    }
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  destroy(): void {
    this.container.destroy();
  }
}
