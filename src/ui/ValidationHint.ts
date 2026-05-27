import Phaser from 'phaser';
import { EventBus } from '../services/EventBus';
import { scalePx, isMobileWidth } from '../utils/responsive';

/** How long (ms) to wait after an 'ok' state before hiding the hint. */
const HIDE_DELAY_MS = 2000;

const COLOURS: Record<'ok' | 'warning' | 'error', number> = {
  ok:      0x00c966,
  warning: 0xffcc00,
  error:   0xff4444,
};

const TEXT_COLOURS: Record<'ok' | 'warning' | 'error', string> = {
  ok:      '#ffffff',
  warning: '#1a1a00',
  error:   '#ffffff',
};

/**
 * ValidationHint
 *
 * A small pill banner rendered at the bottom-centre of the EditorUIScene.
 * It subscribes to `ui:validation-hint` EventBus events and animates
 * in/out to show the current track-placement validation state.
 *
 * Colours:
 *   ok      – green  (auto-hides after HIDE_DELAY_MS)
 *   warning – yellow (tunnel required)
 *   error   – red    (cannot place)
 */
export class ValidationHint {
  private readonly scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private pill!: Phaser.GameObjects.Rectangle;
  private label!: Phaser.GameObjects.Text;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private currentState: 'ok' | 'warning' | 'error' = 'ok';

  private readonly hintHandler = (data: { state: 'ok' | 'warning' | 'error'; message: string }) => {
    this.show(data.state, data.message);
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.build();
    EventBus.on('ui:validation-hint', this.hintHandler);
  }

  private get sw(): number { return this.scene.scale.width; }
  private get sh(): number { return this.scene.scale.height; }

  private build(): void {
    const pillW = isMobileWidth(this.sw) ? this.sw * 0.85 : 420;
    const pillH = scalePx(36, this.sw, this.sh);
    const fontSize = scalePx(13, this.sw, this.sh);

    this.pill = this.scene.add.rectangle(0, 0, pillW, pillH, COLOURS.ok, 0.92).setOrigin(0.5);
    this.label = this.scene.add.text(0, 0, '', {
      fontSize: `${fontSize}px`,
      fontFamily: 'Arial, sans-serif',
      color: TEXT_COLOURS.ok,
      align: 'center',
      wordWrap: { width: pillW - scalePx(16, this.sw, this.sh), useAdvancedWrap: true },
    }).setOrigin(0.5);

    const x = this.sw / 2;
    const y = this.sh - scalePx(56, this.sw, this.sh);
    this.container = this.scene.add.container(x, y, [this.pill, this.label]);
    this.container.setDepth(900).setScrollFactor(0).setAlpha(0);
  }

  /** Show (or update) the hint with the given state and message. */
  show(state: 'ok' | 'warning' | 'error', message: string): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.currentState = state;

    if (state === 'ok') {
      if (message) {
        this.applyStyle(state, message);
        this.animateIn();
        this.scheduleHide();
      } else {
        // Empty 'ok' — just hide immediately
        this.animateOut();
      }
      return;
    }

    this.applyStyle(state, message);
    this.animateIn();
  }

  private scheduleHide(): void {
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.currentState === 'ok') this.animateOut();
    }, HIDE_DELAY_MS);
  }

  private applyStyle(state: 'ok' | 'warning' | 'error', message: string): void {
    this.pill.setFillStyle(COLOURS[state], 0.92);
    this.label.setColor(TEXT_COLOURS[state]);
    this.label.setText(message);
    const pillW = isMobileWidth(this.sw) ? this.sw * 0.85 : 420;
    this.pill.setSize(pillW, scalePx(36, this.sw, this.sh));
  }

  private animateIn(): void {
    this.scene.tweens.killTweensOf(this.container);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 180,
      ease: 'Quad.easeOut',
    });
  }

  private animateOut(): void {
    this.scene.tweens.killTweensOf(this.container);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 250,
      ease: 'Quad.easeIn',
    });
  }

  /** Reposition after a resize event. */
  resize(): void {
    this.container.setPosition(this.sw / 2, this.sh - scalePx(56, this.sw, this.sh));
    const pillW = isMobileWidth(this.sw) ? this.sw * 0.85 : 420;
    this.pill.setSize(pillW, scalePx(36, this.sw, this.sh));
    this.label.setWordWrapWidth(pillW - scalePx(16, this.sw, this.sh));
  }

  destroy(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    EventBus.off('ui:validation-hint', this.hintHandler);
    this.container.destroy();
  }
}
