import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';

/**
 * Renderer contract used by {@link CabViewHost}.
 *
 * Implementations are responsible for all DOM/WebGL work and are loaded lazily
 * so the main bundle never pulls in a 3D engine.
 */
export interface ICabRenderer {
  /** True once the renderer has finished asynchronous initialisation. */
  isReady(): boolean;

  /** Make the overlay visible. */
  show(): void;

  /** Hide the overlay but keep resources allocated. */
  hide(): void;

  /** Render a single frame from the supplied world snapshot. */
  render(snapshot: CabWorldSnapshot): void;

  /** Dispose the renderer and release all DOM/WebGL resources. */
  destroy(): void;
}
