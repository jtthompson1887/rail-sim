import { EventBus } from '../services/EventBus';
import type { ICabSnapshotSource } from './contracts/ICabSnapshotSource';
import type { ICabRenderer } from './contracts/ICabRenderer';
import { CabConfig } from './CabConfig';
import { CabViewToggleButton } from './ui/CabViewToggleButton';
import { CabHudOverlay } from './ui/CabHudOverlay';

export type RendererLoader = () => Promise<ICabRenderer>;

const defaultRendererLoader: RendererLoader = async () => {
  const module = await import(
    /* webpackChunkName: "cab3d" */
    './renderer/BabylonCabRenderer'
  );
  return new module.default();
};

/**
 * Lifecycle owner for the 3-D cab view.
 *
 * The host is intentionally thin: it holds the Phaser adapter, lazily loads the
 * Babylon renderer into its own webpack chunk, responds to the `cab:toggle`
 * EventBus event, and owns the DOM toggle button and HUD overlay.
 */
export class CabViewHost {
  private active = false;
  private requestedActive = false;
  private destroyed = false;
  private renderer: ICabRenderer | null = null;
  private rendererPromise: Promise<ICabRenderer> | null = null;
  private pendingQualityTier: string | null = null;
  private readonly toggleButton: CabViewToggleButton;
  private readonly hudOverlay: CabHudOverlay;

  constructor(
    private readonly source: ICabSnapshotSource,
    private readonly rendererLoader: RendererLoader = defaultRendererLoader,
  ) {
    this.toggleButton = new CabViewToggleButton();
    this.hudOverlay = new CabHudOverlay();
    EventBus.on('cab:toggle', this.handleToggle);
    EventBus.on('cab:quality', this.handleQualityChange);
  }

  /** Destroy the host and release the renderer and UI. */
  destroy(): void {
    this.destroyed = true;
    EventBus.off('cab:toggle', this.handleToggle);
    EventBus.off('cab:quality', this.handleQualityChange);
    this.renderer?.hide();
    this.renderer?.destroy();
    this.renderer = null;
    this.pendingQualityTier = null;
    this.active = false;
    this.requestedActive = false;
    this.toggleButton.destroy();
    this.hudOverlay.destroy();
  }

  /** Per-frame update, called from WorldScene. */
  update(time: number, delta: number): void {
    if (!this.active) return;

    const snapshot = this.source.capture(time, delta);
    this.hudOverlay.update(snapshot);

    if (snapshot.valid && this.renderer?.isReady()) {
      this.renderer.render(snapshot, delta);
    }
  }

  /** True when the cab view is currently displayed. */
  get isActive(): boolean {
    return this.active;
  }

  /** Current active renderer instance, if any. */
  get currentRenderer(): ICabRenderer | null {
    return this.renderer;
  }

  private readonly handleToggle = (): void => {
    if (!CabConfig.ENABLED) return;
    this.requestedActive = !this.requestedActive;
    void this.setActive(this.requestedActive);
  };

  private async setActive(active: boolean): Promise<void> {
    if (this.destroyed) return;

    if (!active) {
      this.hudOverlay.hide();
      this.renderer?.hide();
      if (!this.active) return;
      this.active = false;
      EventBus.emit('cab:state', { active: false });
      return;
    }

    if (this.active) return;

    this.hudOverlay.show();

    if (!this.renderer) {
      if (!this.rendererPromise) {
        this.rendererPromise = this.rendererLoader();
      }
      const pendingRenderer = this.rendererPromise;
      try {
        const renderer = await pendingRenderer;
        if (this.destroyed) {
          if (this.rendererPromise === pendingRenderer) {
            this.rendererPromise = null;
            renderer.destroy();
          }
          return;
        }
        this.renderer = renderer;
        if (this.rendererPromise === pendingRenderer) {
          this.rendererPromise = null;
        }
      } catch (error) {
        if (this.destroyed) return;
        // eslint-disable-next-line no-console
        console.error('[CabViewHost] failed to load cab renderer:', error);
        this.hudOverlay.hide();
        this.rendererPromise = null;
        this.requestedActive = false;
        return;
      }
    }

    if (!this.requestedActive || this.active) {
      if (!this.requestedActive) this.hudOverlay.hide();
      return;
    }

    if (this.pendingQualityTier && this.renderer?.setQualityTier) {
      this.renderer.setQualityTier(this.pendingQualityTier);
      this.pendingQualityTier = null;
    }

    this.renderer?.show();
    this.active = true;
    EventBus.emit('cab:state', { active: true });
  }

  private readonly handleQualityChange = ({ tier }: { tier: string }): void => {
    if (this.renderer?.setQualityTier) {
      this.renderer.setQualityTier(tier);
    } else {
      this.pendingQualityTier = tier;
    }
  };
}
