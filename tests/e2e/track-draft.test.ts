import { expect, test, type Page } from '@playwright/test';
import { createLegacyWorld } from './helpers/CreateLegacyWorld';
import { accessibleWorldPoint } from './helpers/AccessibleWorldPoint';
import { worldToCameraPoint } from './helpers/CameraCoordinates';

const snapshot = (page: Page): Promise<any> => page.evaluate(
  () => (window as any).__railSimConstructionSnapshot(),
);

async function screenPoint(page: Page, point: { x: number; y: number }) {
  const state = await snapshot(page);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('World canvas unavailable');
  const internal = worldToCameraPoint(point, state.camera);
  return {
    x: canvas.x + internal.x * canvas.width / state.camera.width,
    y: canvas.y + internal.y * canvas.height / state.camera.height,
  };
}

async function prepare(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__railSimScene === 'MenuScene');
  await page.keyboard.press('Enter');
  await createLegacyWorld(page, 'real-terrain-alpha');
  await page.waitForFunction(() => (window as any).__railSimScene === 'WorldScene'
    && typeof (window as any).__railSimConstructionSnapshot === 'function');
  const state = await snapshot(page);
  const segment = state.world.starterOpportunity.corridors[1].feasibilityWitness.segments[0];
  await accessibleWorldPoint(page, segment.geometry.p0);
  await accessibleWorldPoint(page, segment.geometry.p3);
  const viewport = page.viewportSize()!;
  if (viewport.width <= 1000) {
    // DOM hit tests cannot see Phaser panels or non-interactive HUD regions.
    // Frame this short section in the clear canvas lane before the touch gesture.
    const start = await screenPoint(page, segment.geometry.p0);
    const hand = { x: viewport.width * 0.55, y: viewport.height * 0.65 };
    await page.keyboard.press('h');
    await page.mouse.move(hand.x, hand.y);
    await page.mouse.down();
    await page.mouse.move(hand.x + viewport.width * 0.45 - start.x,
      hand.y + viewport.height * 0.38 - start.y, { steps: 12 });
    await page.mouse.up();
  }
  await page.keyboard.press('p');
  return {
    start: await screenPoint(page, segment.geometry.p0),
    end: await screenPoint(page, segment.geometry.p3),
  };
}

test.describe('mouse curve placement', () => {
  test.use({ viewport: { width: 1920, height: 1400 } });

  test('refines the draft without spending, then builds its displayed geometry', async ({ page }) => {
    const points = await prepare(page);
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.end.x, points.end.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByTestId('construction-shape-controls')).toBeVisible();
    const original = await snapshot(page);
    expect(original.phase).toBe('review');
    expect(original.preview.canConfirm).toBe(true);
    const engineering = page.getByTestId('construction-engineering').locator('summary');
    await engineering.focus();
    await page.keyboard.press('Space');
    expect((await snapshot(page)).world.tracks).toHaveLength(0);
    await page.keyboard.press('Space');
    const handle = await screenPoint(page, original.preview.proposal.geometry.p1);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x, handle.y - 6, { steps: 4 });
    await page.mouse.up();
    expect((await snapshot(page)).preview.proposal.geometry.p1).not.toEqual(original.preview.proposal.geometry.p1);
    await page.getByTestId('construction-undo-shape').click();
    expect((await snapshot(page)).preview.proposal.geometry).toEqual(original.preview.proposal.geometry);
    await page.getByTestId('construction-start-direction').click();
    await page.getByTestId('construction-rotate-left').click();
    const shaped = await snapshot(page);
    expect(shaped.preview.proposal.geometry.p1).not.toEqual(original.preview.proposal.geometry.p1);
    expect(shaped.world.company.cash).toBe(original.world.company.cash);
    expect(shaped.world.tracks).toHaveLength(0);
    await page.getByTestId('construction-undo-shape').click();
    expect((await snapshot(page)).preview.proposal.geometry).toEqual(original.preview.proposal.geometry);
    await page.getByTestId('construction-end-direction').click();
    await page.getByTestId('construction-rotate-right').click();
    await page.getByTestId('construction-reset-shape').click();
    await page.getByTestId('construction-undo-shape').click();
    const displayed = await snapshot(page);
    await expect(page.getByTestId('construction-confirm')).toBeEnabled();
    await page.screenshot({ path: 'test-results/rail-placement/desktop-curve.png' });
    await page.getByTestId('construction-confirm').click();
    const built = await snapshot(page);
    expect(built.world.tracks).toHaveLength(1);
    for (const key of ['p0', 'p1', 'p2', 'p3']) {
      expect(built.world.tracks[0][key]).toEqual(displayed.preview.proposal.geometry[key]);
    }
    expect(built.world.company.cash).toBe(original.world.company.cash - displayed.preview.totalCost);
  });
});

test.describe('touch curve placement', () => {
  test.use({ viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true });

  test('uses touch angle and reach controls with safe reset and explicit confirmation', async ({ page }) => {
    const points = await prepare(page);
    const cdp = await page.context().newCDPSession(page);
    const contact = (x: number, y: number) => [{ x, y, id: 1, radiusX: 8, radiusY: 8 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contact(points.start.x, points.start.y) });
    await expect.poll(async () => (await snapshot(page)).phase).toBe('dragging');
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contact(
        points.start.x + (points.end.x - points.start.x) * i / 12,
        points.start.y + (points.end.y - points.start.y) * i / 12,
      ) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await snapshot(page)).phase).toBe('review');
    const original = await snapshot(page);
    expect(original.phase).toBe('review');
    await page.getByTestId('construction-start-direction').tap();
    await page.getByTestId('construction-rotate-left').tap();
    await page.getByTestId('construction-longer').tap();
    const changed = await snapshot(page);
    expect(changed.preview.proposal.geometry.p1).not.toEqual(original.preview.proposal.geometry.p1);
    expect(changed.world.tracks).toHaveLength(0);
    expect(changed.world.company.cash).toBe(original.world.company.cash);
    await page.getByTestId('construction-reset-shape').tap();
    expect((await snapshot(page)).preview.proposal.geometry).toEqual(original.preview.proposal.geometry);
    await page.screenshot({ path: 'test-results/rail-placement/mobile-curve.png' });
    await page.getByTestId('construction-confirm').tap();
    expect((await snapshot(page)).world.tracks).toHaveLength(1);
    await cdp.detach();
  });
});
