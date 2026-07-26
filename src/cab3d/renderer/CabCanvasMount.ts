/**
 * Fixed-position WebGL overlay canvas.
 *
 * This module lives in `renderer/` because it touches the DOM; it is never
 * loaded in unit tests and is excluded from coverage.
 */
export class CabCanvasMount {
  readonly canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'rail-sim-cab3d-canvas';
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.zIndex = '1500';
    this.canvas.style.display = 'none';
    this.canvas.style.touchAction = 'none';
    document.body.appendChild(this.canvas);
  }

  show(): void {
    this.canvas.style.display = 'block';
  }

  hide(): void {
    this.canvas.style.display = 'none';
  }

  destroy(): void {
    this.canvas.remove();
  }
}
