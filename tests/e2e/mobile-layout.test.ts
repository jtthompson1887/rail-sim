import { createLegacyWorld } from './helpers/CreateLegacyWorld';
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
import type { FirstRouteBrowserSnapshot } from '../../src/scenes/WorldScene';

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

async function openFreshWorld(
  page: import('@playwright/test').Page,
  viewport: { width: number; height: number },
  seed: string,
): Promise<void> {
  await page.setViewportSize(viewport);
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
  await createLegacyWorld(page, seed);
  await page.waitForFunction(
    () => (window as any).__railSimScene === 'WorldScene',
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => (window as unknown as {
      __railSimScene?: string;
      __railSimFirstRouteHarness?: {
        snapshot?: unknown;
      };
    }).__railSimScene === 'WorldScene'
      && typeof window.__railSimFirstRouteHarness?.snapshot === 'function',
    undefined,
    { timeout: 60_000 },
  );
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
}

const rectanglesOverlap = (
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
): boolean => first.x < second.x + second.width
  && first.x + first.width > second.x
  && first.y < second.y + second.height
  && first.y + first.height > second.y;

const snapshot = async (
  page: import('@playwright/test').Page,
): Promise<FirstRouteBrowserSnapshot> => page.evaluate(() => {
  const harness = window.__railSimFirstRouteHarness;
  if (!harness) throw new Error('Mobile browser harness is unavailable');
  return harness.snapshot();
});

const worldToRenderedPoint = async (
  page: import('@playwright/test').Page,
  target: { readonly x: number; readonly y: number },
): Promise<{ x: number; y: number }> => page.evaluate((point) => {
  const scene = window.__railSimGame.scene.getScene('WorldScene');
  const camera = scene.cameras.main;
  const origin = camera.getWorldPoint(0, 0);
  const xUnit = camera.getWorldPoint(1, 0);
  const yUnit = camera.getWorldPoint(0, 1);
  const a = xUnit.x - origin.x;
  const b = yUnit.x - origin.x;
  const c = xUnit.y - origin.y;
  const d = yUnit.y - origin.y;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-12) {
    throw new Error('Camera transform is not invertible');
  }
  const worldX = point.x - origin.x;
  const worldY = point.y - origin.y;
  return {
    x: (d * worldX - b * worldY) / determinant,
    y: (-c * worldX + a * worldY) / determinant,
  };
}, target);

async function panWorldPointToCentre(
  page: import('@playwright/test').Page,
  target: { readonly x: number; readonly y: number },
  desiredPoint?: { readonly x: number; readonly y: number },
): Promise<void> {
  await page.keyboard.press('h');
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await snapshot(page);
    const internal = await worldToRenderedPoint(page, target);
    const desired = desiredPoint ?? {
      x: state.camera.width / 2,
      y: state.camera.height / 2,
    };
    const dx = desired.x - internal.x;
    const dy = desired.y - internal.y;
    if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) return;
    const moveX = Math.max(-240, Math.min(
      240,
      dx * canvas.width / state.camera.width,
    ));
    const moveY = Math.max(-240, Math.min(
      240,
      dy * canvas.height / state.camera.height,
    ));
    await page.mouse.move(
      canvas.x + canvas.width * 0.48,
      canvas.y + canvas.height * 0.68,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvas.x + canvas.width * 0.48 + moveX,
      canvas.y + canvas.height * 0.68 + moveY,
      { steps: 8 },
    );
    await page.mouse.up();
  }
  throw new Error(`Could not centre ${JSON.stringify(target)}`);
}

async function enterPlayThroughPointer(
  page: import('@playwright/test').Page,
): Promise<void> {
  const canvas = page.locator('canvas');
  await canvas.click({
    position: { x: 30, y: 40 },
  });
  await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
    .toBeHidden();
}

async function returnToCreateThroughPause(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.keyboard.press('Escape');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await canvas.click({
    position: { x: box.width / 2, y: box.height * 0.56 },
  });
  await page.keyboard.press('h');
  await expect(canvas).toHaveCSS('cursor', 'grab');
  await expect(page.locator('[data-testid="train-inspector"]')).toBeHidden();
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
}

async function openFacilityAtMobile(
  page: import('@playwright/test').Page,
  definitionId: string,
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  if (await page.locator('[data-testid="company-hud"]').isVisible()) {
    await enterPlayThroughPointer(page);
  }
  let state = await snapshot(page);
  const target = state.world.economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!target) throw new Error(`Missing ${definitionId}`);
  const desiredMobile = { x: 80, y: 420 };
  const desiredDesktop = {
    x: desiredMobile.x
      + (state.camera.width - 375) * (1 - state.camera.zoom) / 2,
    y: desiredMobile.y
      + (state.camera.height - 667) * (1 - state.camera.zoom) / 2,
  };
  await panWorldPointToCentre(
    page,
    target.railAccess,
    desiredDesktop,
  );
  await page.setViewportSize({ width: 375, height: 667 });
  await waitForCanvas(page);
  state = await snapshot(page);
  const internal = await worldToRenderedPoint(page, target.railAccess);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  await page.mouse.click(
    canvas.x + internal.x * canvas.width / state.camera.width,
    canvas.y + internal.y * canvas.height / state.camera.height,
  );
  if (!await page.locator('[data-testid="facility-inspector"]').isVisible()) {
    throw new Error(JSON.stringify(await page.evaluate((details) => {
      const worldScene = window.__railSimGame.scene.getScene(
        'WorldScene',
      ) as Phaser.Scene;
      const pointer = worldScene.input.activePointer;
      const element = document.elementFromPoint(details.x, details.y);
      return {
        ...details,
        element: element?.tagName ?? null,
        testId: element instanceof HTMLElement
          ? element.dataset.testid ?? null
          : null,
        pointer: {
          x: pointer.x,
          y: pointer.y,
          worldX: pointer.worldX,
          worldY: pointer.worldY,
        },
      };
    }, {
      definitionId,
      target: {
        x: target.x,
        y: target.y,
        railX: target.railAccess.x,
        railY: target.railAccess.y,
      },
      camera: state.camera,
      internal,
      canvas,
      x: canvas.x + internal.x * canvas.width / state.camera.width,
      y: canvas.y + internal.y * canvas.height / state.camera.height,
    })));
  }
  await expect(page.locator('[data-testid="facility-inspector"]'))
    .toBeVisible();
}

async function expectScrollableTarget(
  page: import('@playwright/test').Page,
  targetSelector: string,
): Promise<void> {
  const inspector = page.locator('[data-testid="facility-inspector"]');
  const target = page.locator(targetSelector);
  await inspector.hover();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const position = await target.evaluate((element, selector) => {
      const container = element.closest(
        '[data-testid="facility-inspector"]',
      );
      if (!(container instanceof HTMLElement)) {
        throw new Error(`${selector} is outside the facility inspector`);
      }
      const inspectorBox = container.getBoundingClientRect();
      const targetBox = element.getBoundingClientRect();
      return {
        visible: targetBox.top >= inspectorBox.top - 1
          && targetBox.bottom <= inspectorBox.bottom + 1,
        direction: targetBox.top < inspectorBox.top ? -1 : 1,
      };
    }, targetSelector);
    if (position.visible) return;
    await page.mouse.wheel(0, position.direction * 180);
    await page.waitForTimeout(16);
  }
  throw new Error(`${targetSelector} was not reachable by user scrolling`);
}

async function expectUserScrollableInspector(
  page: import('@playwright/test').Page,
  shouldOverflow: boolean,
): Promise<void> {
  const inspector = page.locator('[data-testid="facility-inspector"]');
  const before = await inspector.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(before.overflowY).toMatch(/auto|scroll/);
  if (!shouldOverflow) {
    expect(before.scrollHeight).toBe(before.clientHeight);
    return;
  }
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  await inspector.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(
    () => inspector.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(before.scrollTop);
}

test('375×667 blank-world purchase controls remain reachable', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openFreshWorld(
    page,
    { width: 375, height: 667 },
    'mobile-layout-controls',
  );

  for (const selector of [
    '[data-testid="company-hud"]',
    '[data-testid="company-cash"]',
    '[data-testid="freight-objective"]',
    '[data-testid="vehicle-purchase-panel"]',
    '[data-testid="flatbed-freight-set-buy"]',
  ]) {
    await expectWithinViewport(page, selector);
  }
  const companyBounds = await page.locator(
    '[data-testid="company-hud"]',
  ).boundingBox();
  const objectiveBounds = await page.locator(
    '[data-testid="freight-objective"]',
  ).boundingBox();
  if (!companyBounds || !objectiveBounds) {
    throw new Error('Finance HUD or freight objective has no mobile bounds');
  }
  expect(objectiveBounds.y).toBeGreaterThanOrEqual(
    companyBounds.y + companyBounds.height + 8,
  );
  const overflow = await page.evaluate(() => ({
    width: document.body.scrollWidth,
    height: document.body.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.height).toBeLessThanOrEqual(overflow.clientHeight);
});

test('667×375 fresh-world economy panels do not occlude each other', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openFreshWorld(
    page,
    { width: 667, height: 375 },
    'mobile-layout-landscape',
  );

  for (const selector of [
    '[data-testid="company-hud"]',
    '[data-testid="freight-objective"]',
    '[data-testid="vehicle-purchase-panel"]',
  ]) {
    await expectWithinViewport(page, selector);
  }
  const companyBounds = await page.locator(
    '[data-testid="company-hud"]',
  ).boundingBox();
  const objectiveBounds = await page.locator(
    '[data-testid="freight-objective"]',
  ).boundingBox();
  const purchaseBounds = await page.locator(
    '[data-testid="vehicle-purchase-panel"]',
  ).boundingBox();
  if (!companyBounds || !objectiveBounds || !purchaseBounds) {
    throw new Error('Fresh-world economy panel has no landscape bounds');
  }

  expect({
    companyBounds,
    objectiveBounds,
    purchaseBounds,
    overlaps: {
      companyObjective: rectanglesOverlap(companyBounds, objectiveBounds),
      companyPurchase: rectanglesOverlap(companyBounds, purchaseBounds),
      objectivePurchase: rectanglesOverlap(objectiveBounds, purchaseBounds),
    },
  }).toMatchObject({
    overlaps: {
      companyObjective: false,
      companyPurchase: false,
      objectivePurchase: false,
    },
  });
});

test('375×667 regional boundaries scroll and leave a construction lane', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await openFreshWorld(page, { width: 375, height: 667 }, 'playtest-825');
  } catch (error) {
    throw new Error(JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      errors,
      url: page.url(),
      scene: await page.evaluate(() => (
        window as unknown as { __railSimScene?: string }
      ).__railSimScene).catch(() => null),
      canvasCount: await page.locator('canvas').count().catch(() => -1),
    }));
  }

  for (const boundary of [
    {
      definitionId: 'port-interchange',
      name: 'Port Interchange',
      status: 'Imported steel available',
      trade: 'Offers Steel',
      shouldOverflow: false,
    },
    {
      definitionId: 'town-construction-market',
      name: 'Town Construction Market',
      status: 'Buying Building Modules',
      trade: 'Buys Building Modules',
      shouldOverflow: true,
    },
  ]) {
    await openFacilityAtMobile(page, boundary.definitionId);
    const inspector = page.locator('[data-testid="facility-inspector"]');
    await expect(inspector).toHaveAttribute('data-layout', 'mobile');
    await expectUserScrollableInspector(page, boundary.shouldOverflow);
    await expect(page.locator('[data-testid="facility-name"]'))
      .toHaveText(boundary.name);
    await expect(page.locator('[data-testid="facility-status"]'))
      .toHaveText(boundary.status);
    await expect(inspector).toContainText(boundary.trade);
    for (const selector of [
      '[data-testid="facility-name"]',
      '[data-testid="facility-status"]',
      '[data-testid="facility-inventories"]',
      '[data-testid="facility-quotes"]',
      '[data-testid="facility-rail"]',
    ]) {
      await expectScrollableTarget(page, selector);
    }
  }

  await returnToCreateThroughPause(page);
  await page.keyboard.press('p');
  await expect(page.locator('[data-testid="facility-inspector"]')).toBeHidden();
  await expect(page.locator('[data-testid="freight-objective"]')).toBeVisible();
  const clearPoint = await page.evaluate(() => {
    const editorUI = window.__railSimGame.scene.getScene(
      'EditorUIScene',
    ) as unknown as {
      containsScreenPoint(x: number, y: number): boolean;
    };
    for (let y = window.innerHeight - 24; y >= 24; y -= 16) {
      for (let x = 56; x <= window.innerWidth - 24; x += 16) {
        if (document.elementFromPoint(x, y) instanceof HTMLCanvasElement
          && !editorUI.containsScreenPoint(x, y)) {
          return { x, y };
        }
      }
    }
    return null;
  });
  expect(clearPoint).not.toBeNull();
  if (!clearPoint) throw new Error('No clear mobile construction point');
  await page.mouse.move(clearPoint.x, clearPoint.y);
  await page.mouse.down();
  await page.mouse.move(clearPoint.x + 20, clearPoint.y, { steps: 4 });
  expect((await snapshot(page)).construction.phase).toBe('dragging');
  await page.mouse.up();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test.describe('touch HUD live resize', () => {
  test.use({ hasTouch: true });

  test('repositions throttle controls and preserves touch input', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openFreshWorld(
      page,
      { width: 1280, height: 800 },
      'playtest-825',
    );
    const readHud = () => page.evaluate(() => {
      const scene = window.__railSimGame.scene.getScene('HUDScene') as Phaser.Scene & {
        mobileControls: Phaser.GameObjects.GameObject[];
        mobileThrottleHeld: boolean;
        timeText: Phaser.GameObjects.Text;
        trainsText: Phaser.GameObjects.Text;
        modeToggleBtn: Phaser.GameObjects.Text;
        modeLabelText: Phaser.GameObjects.Text;
      };
      const rectangles = scene.children.list.filter(
        (child): child is Phaser.GameObjects.Rectangle =>
          child instanceof Phaser.GameObjects.Rectangle,
      );
      const read = (fillColor: number) => {
        const button = rectangles.find(
          (rectangle) => rectangle.fillColor === fillColor,
        );
        if (!button) throw new Error(`Missing HUD button ${fillColor}`);
        return {
          x: button.x,
          y: button.y,
          width: button.displayWidth,
          height: button.displayHeight,
        };
      };
      const readText = (text: Phaser.GameObjects.Text) => {
        const bounds = text.getBounds();
        return {
          x: text.x,
          y: text.y,
          fontSize: Number.parseFloat(String(text.style.fontSize)),
          bounds: {
            x: bounds.x,
            y: bounds.y,
            right: bounds.right,
            bottom: bounds.bottom,
          },
          padding: {
            left: text.padding.left,
            right: text.padding.right,
            top: text.padding.top,
            bottom: text.padding.bottom,
          },
        };
      };
      return {
        accelerate: read(0x22bb44),
        brake: read(0xbb2222),
        throttleRectangleCount: rectangles.filter(
          ({ fillColor }) => fillColor === 0x22bb44
            || fillColor === 0xbb2222,
        ).length,
        mobileControlCount: scene.mobileControls.length,
        mobileThrottleHeld: scene.mobileThrottleHeld,
        resizeListenerCount: scene.scale.listenerCount(
          Phaser.Scale.Events.RESIZE,
        ),
        time: readText(scene.timeText),
        trains: readText(scene.trainsText),
        modeToggle: readText(scene.modeToggleBtn),
        modeLabel: readText(scene.modeLabelText),
      };
    });
    const armTouchProbe = () => page.evaluate(() => {
      const scene = window.__railSimGame.scene.getScene('HUDScene');
      const accelerate = scene.children.list.find(
        (child) => child instanceof Phaser.GameObjects.Rectangle
          && child.fillColor === 0x22bb44,
      ) as Phaser.GameObjects.Rectangle | undefined;
      if (!accelerate) throw new Error('Missing resized accelerator');
      const probe = window as unknown as {
        __hudTouchStarts?: number;
        __staleHudAccelerator?: Phaser.GameObjects.Rectangle;
      };
      probe.__hudTouchStarts = 0;
      probe.__staleHudAccelerator = accelerate;
      accelerate.on('pointerdown', () => {
        probe.__hudTouchStarts = (probe.__hudTouchStarts ?? 0) + 1;
      });
    });
    const touchStarts = () => page.evaluate(() => (
      window as unknown as { __hudTouchStarts?: number }
    ).__hudTouchStarts ?? 0);
    const touchPoint = async (
      button: { readonly x: number; readonly y: number },
      viewport: { readonly width: number; readonly height: number },
    ) => {
      const canvas = await page.locator('canvas').boundingBox();
      if (!canvas) throw new Error('Canvas is not visible');
      return {
        x: canvas.x + button.x * canvas.width / viewport.width,
        y: canvas.y + button.y * canvas.height / viewport.height,
      };
    };
    const assertHudWithin = (
      state: Awaited<ReturnType<typeof readHud>>,
      viewport: { readonly width: number; readonly height: number },
    ) => {
      for (const text of [
        state.time,
        state.trains,
        state.modeToggle,
        state.modeLabel,
      ]) {
        expect(text.bounds.x).toBeGreaterThanOrEqual(0);
        expect(text.bounds.y).toBeGreaterThanOrEqual(0);
        expect(text.bounds.right).toBeLessThanOrEqual(viewport.width);
        expect(text.bounds.bottom).toBeLessThanOrEqual(viewport.height);
      }
    };
    const before = await readHud();
    await enterPlayThroughPointer(page);

    await page.setViewportSize({ width: 375, height: 667 });
    await waitForCanvas(page);
    const portrait = await readHud();
    expect(portrait.accelerate.x).not.toBe(before.accelerate.x);
    expect(portrait.accelerate.y).not.toBe(before.accelerate.y);
    expect(portrait.mobileControlCount).toBe(5);
    expect(portrait.throttleRectangleCount).toBe(2);
    expect(portrait.resizeListenerCount).toBe(before.resizeListenerCount);
    expect(portrait.modeToggle).toMatchObject({ x: 363, y: 8 });
    expect(portrait.time.y).toBe(619);
    expect(portrait.trains.y).toBe(583);
    expect(portrait.modeLabel.x).not.toBe(before.modeLabel.x);
    expect(portrait.modeToggle.fontSize)
      .toBeLessThan(before.modeToggle.fontSize);
    expect(portrait.modeToggle.padding).toEqual({
      left: 10,
      right: 10,
      top: 6,
      bottom: 6,
    });
    for (const button of [portrait.accelerate, portrait.brake]) {
      expect(button.x - button.width / 2).toBeGreaterThanOrEqual(0);
      expect(button.x + button.width / 2).toBeLessThanOrEqual(375);
      expect(button.y - button.height / 2).toBeGreaterThanOrEqual(0);
      expect(button.y + button.height / 2).toBeLessThanOrEqual(667);
    }
    assertHudWithin(portrait, { width: 375, height: 667 });

    const cdp = await page.context().newCDPSession(page);
    try {
      await armTouchProbe();
      const portraitTouch = await touchPoint(
        portrait.accelerate,
        { width: 375, height: 667 },
      );
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [portraitTouch],
      });
      await expect.poll(touchStarts).toBe(1);
      await expect.poll(async () => (await readHud()).mobileThrottleHeld)
        .toBe(true);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await expect.poll(async () => (await readHud()).mobileThrottleHeld)
        .toBe(false);

      await page.setViewportSize({ width: 667, height: 375 });
      await waitForCanvas(page);
      const landscape = await readHud();
      expect(landscape.mobileControlCount).toBe(5);
      expect(landscape.throttleRectangleCount).toBe(2);
      expect(landscape.resizeListenerCount).toBe(before.resizeListenerCount);
      expect(landscape.modeToggle).toMatchObject({ x: 655, y: 8 });
      expect(landscape.time.y).toBe(327);
      expect(landscape.trains.y).toBe(291);
      for (const button of [landscape.accelerate, landscape.brake]) {
        expect(button.x - button.width / 2).toBeGreaterThanOrEqual(0);
        expect(button.x + button.width / 2).toBeLessThanOrEqual(667);
        expect(button.y - button.height / 2).toBeGreaterThanOrEqual(0);
        expect(button.y + button.height / 2).toBeLessThanOrEqual(375);
      }
      assertHudWithin(landscape, { width: 667, height: 375 });

      await armTouchProbe();
      const landscapeTouch = await touchPoint(
        landscape.accelerate,
        { width: 667, height: 375 },
      );
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [landscapeTouch],
      });
      await expect.poll(touchStarts).toBe(1);
      await expect.poll(async () => (await readHud()).mobileThrottleHeld)
        .toBe(true);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await expect.poll(async () => (await readHud()).mobileThrottleHeld)
        .toBe(false);

      await armTouchProbe();
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [landscapeTouch],
      });
      await expect.poll(async () => (await readHud()).mobileThrottleHeld)
        .toBe(true);
      await page.setViewportSize({ width: 375, height: 667 });
      await expect.poll(async () => (await readHud()).mobileThrottleHeld)
        .toBe(false);
      const rebuilt = await readHud();
      expect(rebuilt.mobileControlCount).toBe(5);
      expect(rebuilt.throttleRectangleCount).toBe(2);
      expect(rebuilt.resizeListenerCount).toBe(before.resizeListenerCount);
      expect(await page.evaluate(() => (
        window as unknown as {
          __staleHudAccelerator?: Phaser.GameObjects.Rectangle;
        }
      ).__staleHudAccelerator?.active ?? true)).toBe(false);

      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await armTouchProbe();
      const rebuiltTouch = await touchPoint(
        rebuilt.accelerate,
        { width: 375, height: 667 },
      );
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [rebuiltTouch],
      });
      await expect.poll(async () => (await readHud()).mobileThrottleHeld)
        .toBe(true);
      const shutdownListenerCount = await page.evaluate(() => {
        const scene = window.__railSimGame.scene.getScene('HUDScene') as
          Phaser.Scene & {
            mobileControls: Phaser.GameObjects.GameObject[];
            mobileThrottleHeld: boolean;
          };
        (window as unknown as {
          __stoppedHudScene?: typeof scene;
        }).__stoppedHudScene = scene;
        const count = scene.scale.listenerCount(Phaser.Scale.Events.RESIZE);
        scene.scene.stop();
        return count;
      });
      await expect.poll(() => page.evaluate(() => {
        const scene = (window as unknown as {
          __stoppedHudScene?: Phaser.Scene & {
            mobileControls: Phaser.GameObjects.GameObject[];
            mobileThrottleHeld: boolean;
          };
        }).__stoppedHudScene;
        if (!scene) throw new Error('Missing stopped HUD scene');
        return {
          held: scene.mobileThrottleHeld,
          controls: scene.mobileControls.length,
          resizeListeners: scene.scale.listenerCount(
            Phaser.Scale.Events.RESIZE,
          ),
        };
      })).toEqual({
        held: false,
        controls: 0,
        resizeListeners: shutdownListenerCount - 1,
      });
    } finally {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await cdp.detach();
    }
  });
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
