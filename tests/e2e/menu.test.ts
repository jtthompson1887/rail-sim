/**
 * E2E tests for the MenuScene.
 *
 * Verifies that:
 *  1. The game canvas loads and the MenuScene becomes active.
 *  2. The demo trains drive themselves around the circular track for at least
 *     five seconds without permanently derailing (derail count stays at 0).
 *
 * Run after building the project:
 *   npm run build && npx playwright test
 */

import { test, expect } from '@playwright/test';

const waitForRenderedFrame = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
};

const menuTransitionActivity = async (
  page: import('@playwright/test').Page,
) => page.evaluate(() => {
  const manager = window.__railSimGame.scene;
  return {
    menu: manager.isActive('MenuScene'),
    worldSelect: manager.isActive('WorldSelectScene'),
    world: manager.isActive('WorldScene'),
    editorUI: manager.isActive('EditorUIScene'),
    game: manager.isActive('GameScene'),
    hud: manager.isActive('HUDScene'),
    pause: manager.isActive('PauseScene'),
    debug: manager.isActive('DebugOverlayScene'),
  };
});

test.describe('MenuScene – self-driving trains', () => {
  test('opens Worlds with a real pointer after returning from play', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1400 });
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
      { timeout: 25_000, polling: 500 },
    );

    await page.keyboard.press('Enter');
    await expect.poll(
      () => page.evaluate(
        () => (window as unknown as Record<string, string>).__railSimScene,
      ),
    ).toBe('WorldSelectScene');

    const canvas = page.locator('canvas');
    await canvas.click({ position: { x: 960, y: 1310 } });
    page.once('dialog', (dialog) => dialog.accept('playtest-753'));
    await canvas.click({ position: { x: 960, y: 481 } });
    await canvas.click({ position: { x: 960, y: 1001 } });
    await expect.poll(
      () => page.evaluate(
        () => (window as unknown as Record<string, string>).__railSimScene,
      ),
    ).toBe('WorldScene');
    await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
    await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
      .toBeVisible();

    await canvas.click({ position: { x: 36, y: 40 } });
    await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
      .toBeHidden();
    await page.keyboard.press('Escape');
    await canvas.click({ position: { x: 960, y: 938 } });
    await expect.poll(() => menuTransitionActivity(page)).toEqual({
      menu: true,
      worldSelect: false,
      world: false,
      editorUI: false,
      game: false,
      hud: false,
      pause: false,
      debug: false,
    });
    await expect.poll(
      () => page.evaluate(
        () => (window as unknown as Record<string, string>).__railSimScene,
      ),
    ).toBe('MenuScene');
    await waitForRenderedFrame(page);

    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas is not visible');
    const layout = await page.evaluate(() => {
      const menu = window.__railSimGame.scene.getScene('MenuScene');
      const worlds = menu.children.list.find(
        (child: any) => child.text === 'Worlds',
      ) as any;
      if (!worlds) throw new Error('Worlds menu item was not rendered');
      return {
        width: menu.scale.width,
        height: menu.scale.height,
        x: worlds.x,
        y: worlds.y,
      };
    });
    const worldsPoint = {
      x: layout.x * box.width / layout.width,
      y: layout.y * box.height / layout.height,
    };
    await canvas.hover({ position: worldsPoint });
    await expect(canvas).toHaveCSS('cursor', 'pointer');
    await canvas.click({ position: worldsPoint });
    await expect.poll(() => menuTransitionActivity(page)).toEqual({
      menu: false,
      worldSelect: true,
      world: false,
      editorUI: false,
      game: false,
      hud: false,
      pause: false,
      debug: false,
    });
    await expect.poll(
      () => page.evaluate(
        () => (window as unknown as Record<string, string>).__railSimScene,
      ),
    ).toBe('WorldSelectScene');
  });

  test('trains drive continuously without derailing', async ({ page }) => {
    await page.goto('/');

    // 1. Wait for the Phaser canvas to appear in the DOM.
    await page.waitForSelector('canvas', { timeout: 15_000 });

    // 2. Wait until MenuScene has initialised and set the window flag.
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
      { timeout: 25_000, polling: 500 },
    );

    // 3. Let the physics simulation run for 5 seconds.
    await page.waitForTimeout(5_000);

    // 4. Assert no permanent derailments occurred during the observation window.
    const derailCount = await page.evaluate(
      () => (window as unknown as Record<string, number>).__railSimMenuDerailCount ?? 0,
    );
    expect(derailCount).toBe(0);

    // 5. Confirm the scene is still MenuScene (no crash / unexpected transition).
    const scene = await page.evaluate(
      () => (window as unknown as Record<string, string>).__railSimScene,
    );
    expect(scene).toBe('MenuScene');
  });
});
