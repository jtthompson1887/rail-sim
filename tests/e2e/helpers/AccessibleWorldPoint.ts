import type { Page } from '@playwright/test';
import { worldToCameraPoint, type CameraPoint } from './CameraCoordinates';

const settleRender = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));

/** Move scenery into a clear canvas lane through the same hand tool available to the player. */
export async function accessibleWorldPoint(page: Page, target: CameraPoint): Promise<CameraPoint> {
  let handSelected = false;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    await settleRender(page);
    const camera = await page.evaluate(() => window.__railSimFirstRouteHarness!.snapshot().camera);
    const canvas = await page.locator('canvas').boundingBox();
    if (!canvas) throw new Error('The world canvas is unavailable');
    const internal = worldToCameraPoint(target, camera);
    const screen = { x: canvas.x + internal.x * canvas.width / camera.width,
      y: canvas.y + internal.y * canvas.height / camera.height };
    const clear = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y)[0] instanceof HTMLCanvasElement, screen);
    if (clear) return screen;
    if (!handSelected) {
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await page.keyboard.press('h');
      handSelected = true;
    }
    const gesture = await page.evaluate(({ canvas, screen }) => {
      const isCanvas = (x: number, y: number) => document.elementsFromPoint(x, y)[0] instanceof HTMLCanvasElement;
      const candidates = [];
      for (let y = canvas.y + 80; y < canvas.y + canvas.height - 80; y += 64) {
        for (let x = canvas.x + 80; x < canvas.x + canvas.width - 80; x += 64) {
          if (isCanvas(x, y)) candidates.push({ x, y });
        }
      }
      candidates.sort((a, b) => Math.hypot(a.x - canvas.x - canvas.width / 2, a.y - canvas.y - canvas.height / 2)
        - Math.hypot(b.x - canvas.x - canvas.width / 2, b.y - canvas.y - canvas.height / 2));
      for (const start of candidates) {
        const dx = Math.max(-canvas.width * 0.2, Math.min(canvas.width * 0.2, start.x - screen.x));
        const dy = Math.max(-canvas.height * 0.2, Math.min(canvas.height * 0.2, start.y - screen.y));
        for (const scale of [1, 0.5, 0.25]) {
          if (Array.from({ length: 9 }, (_, i) => i / 8).every(t => isCanvas(start.x + dx * scale * t, start.y + dy * scale * t))) {
            return { start, end: { x: start.x + dx * scale, y: start.y + dy * scale } };
          }
        }
      }
      throw new Error('No unobstructed hand-pan gesture is available');
    }, { canvas, screen });
    await page.mouse.move(gesture.start.x, gesture.start.y);
    await page.mouse.down();
    await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 8 });
    await settleRender(page);
    await page.mouse.up();
  }
  throw new Error(`Could not expose world point ${JSON.stringify(target)} through the hand tool`);
}
