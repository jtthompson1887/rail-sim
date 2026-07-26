/**
 * E2E regression test: derailed train recovery fling bug
 *
 * Verifies that after a derailed train is recovered onto a track,
 * real Matter.js physics does not immediately fling it off again.
 *
 * Uses Playwright to run the actual Phaser engine in a browser.
 * Tests against MenuScene because it has a stable circular track
 * and self-driving trains that are known to work (verified by
 * menu.test.ts).
 */

import { test, expect } from '@playwright/test';

const MENU_SCENE_TIMEOUT = 25_000;

async function waitForMenuScene(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('canvas', { timeout: 15_000 });
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
    undefined,
    { timeout: MENU_SCENE_TIMEOUT, polling: 500 },
  );
}

test.describe('MenuScene – derailed train recovery', () => {
  test('recovered train stays on track after real physics ticks', async ({ page }) => {
    await page.goto('/');

    // 1. Wait for the MenuScene to be active
    await waitForMenuScene(page);

    // 2. Let the scene settle and trains start driving
    await page.waitForTimeout(2_000);

    // 3. Programmatically derail train[0] and recover it
    const recoveryResult = await page.evaluate(() => {
      const trains = (window as any).__railSimMenuTrains;
      if (!trains || trains.length === 0) {
        throw new Error('No trains found in MenuScene');
      }

      const train = trains[0];
      const body = train.getMatterBody();
      const track = train.currentTrack;

      if (!track) {
        throw new Error('Train[0] has no currentTrack before derailment');
      }

      // Save pre-derail state
      const pre = {
        hadTrack: true,
        bodyX: body.x,
        bodyY: body.y,
        angle: body.angle,
      };

      // Derail: move off the track and mark derailed
      body.setPosition(body.x, body.y + 80);
      train.derailed = true;
      train.currentTrack = null;

      const recover = (window as any).__railSimRecoverDerailedFollowerOnTrack;
      if (!recover) throw new Error('Production recovery routine is not exposed');
      recover(train, track);

      return { pre, postAngle: body.angle };
    });

    expect(recoveryResult.pre.hadTrack).toBe(true);

    // 4. Check immediately after recovery — should be stationary
    const immediate = await page.evaluate(() => {
      const trains = (window as any).__railSimMenuTrains;
      const train = trains[0];
      const b = train.getMatterBody().body as any;
      return {
        derailed: train.derailed,
        hasTrack: train.currentTrack !== null,
        speed: Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y),
        angularSpeed: b.angularSpeed || 0,
      };
    });
    expect(immediate.derailed).toBe(false);
    expect(immediate.hasTrack).toBe(true);
    expect(immediate.speed).toBeLessThan(5);
    expect(immediate.angularSpeed).toBeLessThan(0.5);

    // 5. Let a few physics frames run to detect an immediate fling
    await page.waitForTimeout(100);

    // 6. Assert the train is still healthy (not derailed, low speed)
    const postPhysics = await page.evaluate(() => {
      const trains = (window as any).__railSimMenuTrains;
      const train = trains[0];
      const body = train.getMatterBody();
      const b = body.body as any;

      const vx = b.velocity.x;
      const vy = b.velocity.y;
      const speed = Math.sqrt(vx * vx + vy * vy);
      const angularSpeed = b.angularSpeed || 0;

      return {
        derailed: train.derailed,
        hasTrack: train.currentTrack !== null,
        speed,
        angularSpeed,
        bodyX: body.x,
        bodyY: body.y,
      };
    });

    expect(postPhysics.derailed).toBe(false);
    expect(postPhysics.hasTrack).toBe(true);
    // After 100ms a fling would already be obvious (>30), whereas normal
    // track-force acceleration from stand-still stays well below this.
    expect(postPhysics.speed).toBeLessThan(30);
    expect(postPhysics.angularSpeed).toBeLessThan(0.5);
  });

  test('does not fling after fast off-track displacement', async ({ page }) => {
    await page.goto('/');
    await waitForMenuScene(page);
    await page.waitForTimeout(2_000);

    // Simulate a fast displacement (large position jump) followed by recovery
    await page.evaluate(() => {
      const trains = (window as any).__railSimMenuTrains;
      const train = trains[0];
      const body = train.getMatterBody();

      const track = train.currentTrack;
      if (!track) {
        throw new Error('Train[0] has no currentTrack before derailment');
      }

      // Large jump off the track
      body.setPosition(body.x + 60, body.y + 60);
      train.derailed = true;
      train.currentTrack = null;

      const recover = (window as any).__railSimRecoverDerailedFollowerOnTrack;
      if (!recover) throw new Error('Production recovery routine is not exposed');
      recover(train, track);
    });

    // Check immediately after recovery
    const immediate = await page.evaluate(() => {
      const trains = (window as any).__railSimMenuTrains;
      const train = trains[0];
      const b = train.getMatterBody().body as any;
      return {
        derailed: train.derailed,
        hasTrack: train.currentTrack !== null,
        speed: Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y),
        angularSpeed: b.angularSpeed || 0,
      };
    });
    expect(immediate.derailed).toBe(false);
    expect(immediate.hasTrack).toBe(true);
    expect(immediate.speed).toBeLessThan(5);
    expect(immediate.angularSpeed).toBeLessThan(0.5);

    // Let a few physics frames run to detect an immediate fling
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const trains = (window as any).__railSimMenuTrains;
      const train = trains[0];
      const body = train.getMatterBody();
      const b = body.body as any;
      return {
        derailed: train.derailed,
        hasTrack: train.currentTrack !== null,
        speed: Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y),
        angularSpeed: b.angularSpeed || 0,
      };
    });

    expect(result.derailed).toBe(false);
    expect(result.hasTrack).toBe(true);
    expect(result.speed).toBeLessThan(30);
    expect(result.angularSpeed).toBeLessThan(0.5);
  });
});
