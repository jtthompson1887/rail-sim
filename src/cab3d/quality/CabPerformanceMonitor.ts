import { getTierForFps, type CabQualityTier } from './CabQualityTier';

/** Provider that returns the current instantaneous frame rate. */
export type FpsProvider = () => number;

/** Provider that returns a monotonic timestamp in milliseconds. */
export type NowProvider = () => number;

/**
 * Samples the frame rate for a short probe window and selects a concrete
 * quality tier from the average.
 *
 * This module is intentionally free of DOM/Babylon dependencies: callers
 * inject `getFps` and `getNow`. The renderer typically passes
 * `() => engine.getFps()` and `() => Date.now()`.
 */
export class CabPerformanceMonitor {
  private running = false;
  private startTime = 0;
  private samples: number[] = [];
  private onComplete: ((tier: CabQualityTier) => void) | null = null;

  /** Probe duration in milliseconds. */
  readonly durationMs: number;

  constructor(
    private readonly getFps: FpsProvider,
    private readonly getNow: NowProvider,
    durationMs = 3000,
  ) {
    this.durationMs = durationMs;
  }

  /** Begin a new probe. Any previous probe is cancelled. */
  start(onComplete: (tier: CabQualityTier) => void): void {
    this.onComplete = onComplete;
    this.startTime = this.getNow();
    this.samples = [];
    this.running = true;
  }

  /** Stop an in-progress probe without invoking the callback. */
  cancel(): void {
    this.running = false;
    this.samples = [];
    this.onComplete = null;
  }

  /** True while the probe is collecting samples. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Sample the current FPS and complete the probe once the configured
   * duration has elapsed. Call this once per frame.
   */
  update(): void {
    if (!this.running) return;

    const fps = this.getFps();
    if (fps > 0) {
      this.samples.push(fps);
    }

    const elapsed = this.getNow() - this.startTime;
    if (elapsed >= this.durationMs) {
      this.running = false;
      const average =
        this.samples.length > 0
          ? this.samples.reduce((sum, value) => sum + value, 0) /
            this.samples.length
          : 0;
      const tier = getTierForFps(average);
      this.onComplete?.(tier);
    }
  }
}
