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

test.describe('MenuScene – self-driving trains', () => {
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
