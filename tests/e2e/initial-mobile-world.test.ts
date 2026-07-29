import { expect, test, type Page } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 375, height: 667 };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

interface CameraSnapshot {
  camera: {
    zoom: number;
  };
}

declare global {
  interface Window {
    __railSimConstructionSnapshot?: () => CameraSnapshot;
  }
}

async function cameraZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    if (!window.__railSimConstructionSnapshot) {
      throw new Error('Construction snapshot is not available');
    }
    return window.__railSimConstructionSnapshot().camera.zoom;
  });
}

async function unobstructedCanvasPoint(
  page: Page,
): Promise<{ x: number; y: number }> {
  return page.locator('canvas').evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    const points: Array<{ x: number; y: number }> = [];
    for (let y = bounds.top + 16; y < bounds.bottom - 16; y += 16) {
      for (let x = bounds.left + 16; x < bounds.right - 16; x += 16) {
        points.push({ x, y });
      }
    }
    points.sort((first, second) => {
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      return Math.hypot(first.x - centerX, first.y - centerY)
        - Math.hypot(second.x - centerX, second.y - centerY);
    });
    const point = points.find(({ x, y }) =>
      document.elementFromPoint(x, y) === canvas);
    if (!point) throw new Error('No unobstructed canvas point is available');
    return point;
  });
}

test('creates and initially frames a mobile world within continuous camera bounds', async ({
  page,
}) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
    { timeout: 25_000 },
  );

  await page.keyboard.press('Enter');
  await page.locator('canvas').click({
    position: {
      x: MOBILE_VIEWPORT.width / 2,
      y: MOBILE_VIEWPORT.height - 90,
    },
  });
  page.once('dialog', (dialog) => dialog.accept('real-terrain-alpha'));
  await page.locator('canvas').click({
    position: {
      x: MOBILE_VIEWPORT.width / 2,
      y: 146,
    },
  });
  await page.locator('canvas').click({
    position: {
      x: MOBILE_VIEWPORT.width / 2,
      y: 603,
    },
  });
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'WorldScene'
      && typeof window.__railSimConstructionSnapshot === 'function',
    { timeout: 30_000 },
  );

  const initialZoom = await cameraZoom(page);
  expect(initialZoom).toBeGreaterThanOrEqual(MIN_ZOOM);
  expect(initialZoom).toBeLessThanOrEqual(MAX_ZOOM);

  const wheelPoint = await unobstructedCanvasPoint(page);
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => cameraZoom(page)).toBeGreaterThan(initialZoom);
  const zoomAfterOneWheelStep = await cameraZoom(page);
  expect(zoomAfterOneWheelStep / initialZoom).toBeCloseTo(1.03, 5);
});
