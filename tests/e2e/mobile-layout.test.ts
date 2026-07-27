/**
 * E2E tests: Mobile-responsive layout verification
 *
 * Uses Playwright to load the game at several common viewport sizes and take
 * screenshots so that visual misalignment can be spotted quickly.  Each
 * viewport test also checks basic structural health (canvas visible, no JS
 * errors).
 *
 * Run after building the project:
 *   npm run build && npx playwright test
 *
 * Screenshots are saved to test-results/screenshots/ by default.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Viewport definitions – cover the most common device categories
// ---------------------------------------------------------------------------

const VIEWPORTS = [
  { name: 'mobile-portrait',  width: 375,  height: 667  }, // iPhone SE
  { name: 'mobile-landscape', width: 667,  height: 375  }, // iPhone SE rotated
  { name: 'tablet-portrait',  width: 768,  height: 1024 }, // iPad portrait
  { name: 'tablet-landscape', width: 1024, height: 768  }, // iPad landscape
  { name: 'desktop-hd',       width: 1280, height: 800  }, // common laptop
  { name: 'desktop-fullhd',   width: 1920, height: 1080 }, // full HD
];

const SCREENSHOT_DIR = path.join(__dirname, '../../test-results/screenshots');

// Ensure the screenshot directory exists before the first test
test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helper: wait for the game canvas to render
// ---------------------------------------------------------------------------

async function waitForCanvas(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('canvas', { timeout: 20_000 });
  // Give Phaser a moment to paint the first frame
  await page.waitForTimeout(1_000);
}

async function expectWithinViewport(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<void> {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`${selector} has no viewport bounds`);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('375×667 blank-world purchase controls remain reachable', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await page.waitForFunction(
    () => (window as any).__railSimScene === 'MenuScene',
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => (window as any).__railSimScene === 'WorldSelectScene',
    undefined,
    { timeout: 25_000 },
  );
  const canvas = page.locator('canvas');
  await canvas.click({ position: { x: 187.5, y: 577 } });
  page.once('dialog', (dialog) => dialog.accept('mobile-layout-controls'));
  await canvas.click({ position: { x: 187.5, y: 146 } });
  await canvas.click({ position: { x: 187.5, y: 603 } });
  await page.waitForFunction(
    () => (window as any).__railSimScene === 'WorldScene',
    undefined,
    { timeout: 60_000 },
  );

  for (const selector of [
    '[data-testid="company-hud"]',
    '[data-testid="company-cash"]',
    '[data-testid="vehicle-purchase-panel"]',
    '[data-testid="flatbed-freight-set-buy"]',
  ]) {
    await expectWithinViewport(page, selector);
  }
  const overflow = await page.evaluate(() => ({
    width: document.body.scrollWidth,
    height: document.body.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.height).toBeLessThanOrEqual(overflow.clientHeight);
});

// ---------------------------------------------------------------------------
// Feature: Game canvas renders at every viewport size
// ---------------------------------------------------------------------------

test.describe('Feature: Game canvas is visible on all viewports', () => {
  for (const vp of VIEWPORTS) {
    test(`Scenario: ${vp.name} (${vp.width}×${vp.height})`, async ({ page }) => {
      // Given a ${vp.name} viewport
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      // When the page has loaded
      await waitForCanvas(page);

      // Then the canvas should be present in the DOM
      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();

      // And the canvas should not exceed the viewport width (no horizontal overflow)
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(-1); // allow 1px rounding
        expect(box.width).toBeLessThanOrEqual(vp.width + 2);
      }

      // Take a screenshot for visual inspection
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}.png`),
        fullPage: false,
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Feature: No JavaScript errors on load
// ---------------------------------------------------------------------------

test.describe('Feature: No JavaScript errors during startup', () => {
  for (const vp of VIEWPORTS) {
    test(`Scenario: ${vp.name} loads without console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await waitForCanvas(page);

      // Filter out known non-fatal Phaser/browser noise
      const fatal = errors.filter(
        (e) => !e.includes('favicon') && !e.includes('sourceMap'),
      );
      expect(fatal).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Feature: MenuScene reaches a stable state on all viewports
// ---------------------------------------------------------------------------

test.describe('Feature: MenuScene stabilises on all viewports', () => {
  for (const vp of VIEWPORTS) {
    test(`Scenario: ${vp.name} – MenuScene active and stable after 3 s`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      // Wait for MenuScene to signal it is active (set by MenuScene.create())
      await page.waitForFunction(
        () => (window as any).__railSimScene === 'MenuScene',
        { timeout: 25_000, polling: 500 },
      );

      // Let the scene run for 3 seconds
      await page.waitForTimeout(3_000);

      // Confirm the scene is still MenuScene (no crash / unexpected transition)
      const scene = await page.evaluate(
        () => (window as any).__railSimScene,
      );
      expect(scene).toBe('MenuScene');

      // Take a post-settle screenshot for comparison
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${vp.name}-settled.png`),
        fullPage: false,
      });
    });
  }
});
