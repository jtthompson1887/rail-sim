import { test, expect, type Page } from '@playwright/test';

async function openMenu(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.waitForFunction(() => !!window.__railSimMenuPreview);
  await expect(page.locator('.rail-main-menu img')).toHaveCount(0);
}
async function sceneIs(page: Page, name: string) {
  await expect.poll(() => page.evaluate(key => window.__railSimGame.scene.isActive(key), name)).toBe(true);
}
async function backFromWorlds(page: Page, height: number) {
  await page.locator('canvas').click({ position: { x: 70, y: height - 60 } });
  await expect(page.getByTestId('main-menu')).toBeVisible();
}

test('desktop: game view, pointer routes, keyboard focus and repeated scene cleanup', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMenu(page);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Pause preview' }).click();
  await page.mouse.move(1000, 30);
  await page.screenshot({ path: testInfo.outputPath('main-menu-desktop.png') });
  await page.getByRole('button', { name: 'Your railways', exact: true }).click();
  await sceneIs(page, 'WorldSelectScene');
  await expect(page.getByTestId('main-menu')).toHaveCount(0);
  await backFromWorlds(page, 900);
  await page.getByRole('button', { name: 'Your railways', exact: true }).click();
  await sceneIs(page, 'WorldSelectScene');
  await backFromWorlds(page, 900);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Play Brookford', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Your railways', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await sceneIs(page, 'SettingsScene');
  await expect(page.getByTestId('main-menu')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('main-menu')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await sceneIs(page, 'SettingsScene');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('main-menu')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await sceneIs(page, 'WorldSelectScene');
  expect(errors).toEqual([]);
});

test('opens Brookford, reloads the saved railway and continues it', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1400 });
  await openMenu(page);
  await page.getByRole('button', { name: 'Play Brookford', exact: true }).click();
  await sceneIs(page, 'WorldScene');
  await expect(page.getByTestId('company-hud')).toBeVisible();
  await page.getByRole('button', { name: 'Company', exact: true }).click();
  await page.getByRole('button', { name: 'Save world', exact: true }).click();
  await expect(page.getByTestId('company-hud')).toContainText('Saved', { timeout: 30000 });
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await expect(page.locator('.rmm-primary')).toContainText('Brookford');
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.getByRole('button', { name: 'Pause preview' }).click();
  await page.screenshot({ path: testInfo.outputPath('main-menu-continue.png') });
  for (const viewport of [{ width: 844, height: 390 }, { width: 668, height: 375 }]) {
    await page.setViewportSize(viewport);
    for (const button of await page.locator('.rail-main-menu button:visible').all()) {
      const box = await button.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({ path: testInfo.outputPath(`main-menu-continue-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await sceneIs(page, 'WorldScene');
  await expect(page.getByTestId('main-menu')).toHaveCount(0);
  await expect(page.getByTestId('company-hud')).toBeVisible();
});

test('respects reduced motion and allows explicit scenery pause / play', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page);
  const clock = () => page.evaluate(() => window.__railSimMenuPreview!().clockSeconds);
  const initial = await clock();
  await expect(page.getByTestId('main-menu')).toHaveAttribute('data-motion', 'paused');
  await page.waitForTimeout(250);
  expect(await clock()).toBe(initial);
  await page.getByRole('button', { name: 'Play preview' }).click();
  await expect.poll(clock).toBeGreaterThan(initial);
  await page.getByRole('button', { name: 'Pause preview' }).click();
  const paused = await clock();
  await page.waitForTimeout(250);
  expect(await clock()).toBe(paused);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(clock).toBeGreaterThan(paused);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => window.__railSimMenuPreview!().paused)).toBe(true);
});

test.describe('live title railway', () => {
  test('trains visibly move, pause exactly and do not create a saved game', async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL, viewport: { width: 1440, height: 900 },
      recordVideo: { dir: testInfo.outputPath('recording'), size: { width: 1440, height: 900 } },
    });
    const page = await context.newPage();
    try {
      await openMenu(page);
      const rendered = () => page.evaluate(() => window.__railSimGame.scene.getScene('MenuScene').children.list
        .filter((item: any) => item.depth === 103).map((item: any) => ({ x: item.x, y: item.y, angle: item.rotation })));
      const storageBefore = await page.evaluate(() => JSON.stringify(localStorage));
      const before = await rendered();
      expect(before.length).toBeGreaterThanOrEqual(2);
      await page.screenshot({ path: testInfo.outputPath('live-menu-before.png') });
      await expect.poll(async () => {
        const after = await rendered();
        return after.some((part, i) => Math.hypot(part.x - before[i].x, part.y - before[i].y) > 180);
      }, { timeout: 8000 }).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('live-menu-after.png') });
      await page.getByRole('button', { name: 'Pause preview' }).click();
      const stopped = await rendered();
      await page.waitForTimeout(500);
      expect(await rendered()).toEqual(stopped);
      await page.getByRole('button', { name: 'Play preview' }).click();
      await expect.poll(async () => JSON.stringify(await rendered())).not.toBe(JSON.stringify(stopped));
      expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storageBefore);
      await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    } finally { await context.close(); }
  });
});

test.describe('touch layout', () => {
  test.use({ hasTouch: true });
  for (const viewport of [{ width: 844, height: 390 }, { width: 668, height: 375 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    test(`${viewport.width}x${viewport.height}: controls fit and work without hover`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openMenu(page);
      const root = page.getByTestId('main-menu');
      expect(await root.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const buttons = page.locator('.rail-main-menu button:visible');
      for (const button of await buttons.all()) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        if (viewport.width > viewport.height) expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      }
      await page.screenshot({ path: testInfo.outputPath(`main-menu-${viewport.width}x${viewport.height}.png`) });
      await page.getByRole('button', { name: 'Your railways', exact: true }).tap();
      await sceneIs(page, 'WorldSelectScene');
      await expect(root).toHaveCount(0);
    });
  }
});
