import { EventBus } from '../services/EventBus';
import type { ICabSnapshotSource } from './contracts/ICabSnapshotSource';
import type { ICabRenderer } from './contracts/ICabRenderer';
import { CabConfig } from './CabConfig';

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
 * Babylon renderer into its own webpack chunk, and responds to the `cab:toggle`
 * EventBus event. All rendering state is delegated to the renderer.
 */
export class CabViewHost {
  private active = false;
  private renderer: ICabRenderer | null = null;
  private rendererPromise: Promise<ICabRenderer> | null = null;

  constructor(
    private readonly source: ICabSnapshotSource,
    private readonly rendererLoader: RendererLoader = defaultRendererLoader,
  ) {
    EventBus.on('cab:toggle', this.handleToggle);
  }

  /** Destroy the host and release the renderer. */
  destroy(): void {
    EventBus.off('cab:toggle', this.handleToggle);
    this.renderer?.hide();
    this.renderer?.destroy();
    this.renderer = null;
    this.rendererPromise = null;
    this.active = false;
  }

  /** Per-frame update, called from WorldScene. */
  update(time: number, delta: number): void {
    if (!this.active || !this.renderer?.isReady()) return;
    const snapshot = this.source.capture(time, delta);
    if (snapshot.valid) {
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
    void this.setActive(!this.active);
  };

  private async setActive(active: boolean): Promise<void> {
    if (this.active === active) return;

    if (active && !this.renderer && !this.rendererPromise) {
      this.rendererPromise = this.rendererLoader();
      try {
        this.renderer = await this.rendererPromise;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[CabViewHost] failed to load cab renderer:', error);
        this.rendererPromise = null;
        return;
      }
    }

    if (active && this.renderer) {
      this.renderer.show();
    } else {
      this.renderer?.hide();
    }

    this.active = active;
    EventBus.emit('cab:state', { active });
  }
}
