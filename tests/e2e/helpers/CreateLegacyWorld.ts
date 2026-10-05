import type { Page } from '@playwright/test';

/** Fixtures preserve historical terrain/economy measurements; the actual picker has separate coverage. */
export async function createLegacyWorld(page: Page, seed: string, biome: 'temperate' | 'alpine' | 'arid' | 'tropical' = 'temperate'): Promise<string> {
  await page.waitForFunction(
    () => (window as any).__railSimScene === 'WorldSelectScene',
    undefined,
    { timeout: 30_000 },
  );
  if (!await page.evaluate(() => typeof (window as any).__railSimCreateLegacyWorld === 'function')) {
    // The committed game predates the fixture hook. Use its real creation picker;
    // restore the requested phone viewport before exercising construction.
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 1920, height: 1400 });
    await page.reload();
    await page.waitForFunction(() => (window as any).__railSimScene === 'MenuScene');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).__railSimScene === 'WorldSelectScene');
    await page.locator('canvas').click({ position: { x: 960, y: 1310 } });
    page.once('dialog', dialog => dialog.accept(seed));
    await page.locator('canvas').click({ position: { x: 960, y: 481 } });
    const biomeIndex = ['temperate', 'alpine', 'arid', 'tropical'].indexOf(biome);
    await page.locator('canvas').click({ position: { x: 960, y: 603 + biomeIndex * 58 } });
    await page.locator('canvas').click({ position: { x: 960, y: 1001 } });
    await page.waitForFunction(() => (window as any).__railSimScene === 'WorldScene'
      && typeof (window as any).__railSimConstructionSnapshot === 'function');
    if (viewport && (viewport.width !== 1920 || viewport.height !== 1400)) {
      await page.setViewportSize(viewport);
      // Reopen at the phone size so Phaser's scene-owned HUD is laid out there.
      await page.reload();
      await page.waitForFunction(() => (window as any).__railSimScene === 'MenuScene');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => (window as any).__railSimScene === 'WorldSelectScene');
      await page.locator('canvas').click({ position: { x: viewport.width / 2, y: 200 } });
      await page.waitForFunction(() => (window as any).__railSimScene === 'WorldScene'
        && typeof (window as any).__railSimConstructionSnapshot === 'function');
    }
    return page.evaluate(() => (window as any).__railSimConstructionSnapshot().world.id);
  }
  return page.evaluate(async ({ seed: fixtureSeed, biome: fixtureBiome }) => {
    const create = (window as any).__railSimCreateLegacyWorld;
    if (typeof create !== 'function') throw new Error('The legacy fixture factory is unavailable; use a test-controls build.');
    return create(fixtureSeed, fixtureBiome);
  }, { seed, biome });
}
