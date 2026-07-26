import { expect, test, type Page } from '@playwright/test';

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 375, height: 667 };
const WORLD_SEED = 'economy-presentation-017';

interface Point {
  x: number;
  y: number;
}

interface PresentationSnapshot {
  camera: {
    scrollX: number;
    scrollY: number;
    zoom: number;
    width: number;
    height: number;
  };
  world: {
    tracks: unknown[];
    trains: unknown[];
    economy: {
      tick: number;
      facilities: Array<{
        id: string;
        name: string;
        x: number;
        y: number;
        recipeProgressTicks: number;
        inventories: Record<string, { quantity: number; capacity: number }>;
      }>;
    };
    starterOpportunity: {
      sites: Array<{ id: string; label: string; x: number; y: number }>;
    };
  };
}

declare global {
  interface Window {
    __railSimConstructionSnapshot?: () => PresentationSnapshot;
  }
}

async function snapshot(page: Page): Promise<PresentationSnapshot> {
  return page.evaluate(() => {
    if (!window.__railSimConstructionSnapshot) {
      throw new Error('World snapshot is unavailable');
    }
    return window.__railSimConstructionSnapshot();
  });
}

async function waitForWorld(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene
      === 'WorldScene'
      && typeof window.__railSimConstructionSnapshot === 'function',
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
}

async function createFixedSeedWorld(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('economy-presentation-cleared') !== 'yes') {
      localStorage.clear();
      sessionStorage.setItem('economy-presentation-cleared', 'yes');
    }
  });
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene
      === 'MenuScene',
    { timeout: 25_000 },
  );
  await page.keyboard.press('Enter');
  await page.locator('canvas').click({
    position: { x: viewport.width / 2, y: viewport.height - 90 },
  });
  page.once('dialog', (dialog) => dialog.accept(WORLD_SEED));
  await page.locator('canvas').click({
    position: {
      x: viewport.width / 2,
      y: viewport.width <= 720 ? 146 : viewport.height / 2 - 219,
    },
  });
  await page.locator('canvas').click({
    position: {
      x: viewport.width / 2,
      y: viewport.width <= 720 ? 603 : viewport.height / 2 + 301,
    },
  });
  await waitForWorld(page);
}

async function openOnlySavedWorld(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene
      === 'MenuScene',
    { timeout: 25_000 },
  );
  await page.keyboard.press('Enter');
  await page.locator('canvas').click({
    position: {
      x: viewport.width / 2,
      y: 200,
    },
  });
  await waitForWorld(page);
}

async function toScreen(
  page: Page,
  point: Point,
  state: PresentationSnapshot,
): Promise<Point> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is unavailable');
  const x = state.camera.width / 2
    + (
      point.x
      - state.camera.scrollX
      - state.camera.width / 2
    ) * state.camera.zoom;
  const y = state.camera.height / 2
    + (
      point.y
      - state.camera.scrollY
      - state.camera.height / 2
    ) * state.camera.zoom;
  return {
    x: canvas.x + x * canvas.width / state.camera.width,
    y: canvas.y + y * canvas.height / state.camera.height,
  };
}

async function inspectSawmill(page: Page): Promise<void> {
  const state = await snapshot(page);
  const sawmill = state.world.economy.facilities.find(
    ({ id }) => id === 'sawmill',
  );
  if (!sawmill) throw new Error('Sawmill was not generated');
  const screen = await toScreen(page, sawmill, state);
  await page.mouse.click(screen.x, screen.y);
  const inspector = page.locator('[data-testid="facility-inspector"]');
  await expect(inspector).toBeVisible();
  await expect(page.locator('[data-testid="facility-name"]'))
    .toHaveText('Sawmill');
  await expect(page.locator('[data-testid="facility-status"]'))
    .toHaveText('Needs logs');
  // Proves the global scene pointerdown did not immediately clear the marker.
  await page.waitForTimeout(100);
  await expect(inspector).toBeVisible();
}

for (const viewport of [DESKTOP, MOBILE]) {
  const label = viewport === MOBILE ? '375x667' : 'desktop';
  test(`presents and persists the fixed-seed blank economy at ${label}`, async ({
    page,
  }) => {
    await createFixedSeedWorld(page, viewport);
    const generated = await snapshot(page);
    expect(generated.world.tracks).toHaveLength(0);
    expect(generated.world.trains).toHaveLength(0);
    expect(generated.world.economy.facilities).toHaveLength(7);
    const forest = generated.world.economy.facilities.find(
      ({ id }) => id === 'managed-forest',
    )!;
    const sawmill = generated.world.economy.facilities.find(
      ({ id }) => id === 'sawmill',
    )!;
    const quarry = generated.world.economy.facilities.find(
      ({ id }) => id === 'quarry',
    )!;
    expect({ name: forest.name, x: forest.x, y: forest.y }).toEqual({
      name: 'Managed Forest',
      x: generated.world.starterOpportunity.sites[0].x,
      y: generated.world.starterOpportunity.sites[0].y,
    });
    expect({ name: sawmill.name, x: sawmill.x, y: sawmill.y }).toEqual({
      name: 'Sawmill',
      x: generated.world.starterOpportunity.sites[1].x,
      y: generated.world.starterOpportunity.sites[1].y,
    });

    await inspectSawmill(page);
    const panel = page.locator('[data-testid="facility-inspector"]');
    await expect(panel).toHaveAttribute(
      'data-layout',
      viewport === MOBILE ? 'mobile' : 'desktop',
    );
    if (viewport === MOBILE) {
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(56);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      const hud = await page.locator('[data-testid="company-hud"]')
        .boundingBox();
      expect(hud).not.toBeNull();
      expect(hud!.x + hud!.width).toBeLessThanOrEqual(viewport.width + 1);
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
      expect(overflow.body).toBeLessThanOrEqual(overflow.viewport);
    }

    const openingLogs = forest.inventories.logs.quantity;
    const openingAggregate =
      quarry.inventories['limestone-aggregate'].quantity;
    await page.locator('canvas').click({
      position: { x: viewport.width - 28, y: 30 },
    });
    await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
    let observedOperation: PresentationSnapshot | null = null;
    await expect.poll(async () => {
      const current = await snapshot(page);
      const currentForest = current.world.economy.facilities.find(
        ({ id }) => id === 'managed-forest',
      )!;
      const currentQuarry = current.world.economy.facilities.find(
        ({ id }) => id === 'quarry',
      )!;
      const progress = {
        forestOutputAdvanced:
          currentForest.inventories.logs.quantity > openingLogs,
        quarryOutputAdvanced:
          currentQuarry.inventories['limestone-aggregate'].quantity
            > openingAggregate,
        bothRecipesInProgress:
          currentForest.recipeProgressTicks > 0
          && currentQuarry.recipeProgressTicks > 0,
      };
      if (
        progress.forestOutputAdvanced
        && progress.quarryOutputAdvanced
        && progress.bothRecipesInProgress
      ) {
        observedOperation = current;
      }
      return progress;
    }, { timeout: 12_000 }).toEqual({
      forestOutputAdvanced: true,
      quarryOutputAdvanced: true,
      bothRecipesInProgress: true,
    });
    const operated = observedOperation as PresentationSnapshot | null;
    if (!operated) throw new Error('Raw-producer progress was not observed');
    const operatedForest = operated.world.economy.facilities.find(
      ({ id }) => id === 'managed-forest',
    )!;
    const operatedQuarry = operated.world.economy.facilities.find(
      ({ id }) => id === 'quarry',
    )!;
    const operatedSawmill = operated.world.economy.facilities.find(
      ({ id }) => id === 'sawmill',
    )!;
    expect(operatedForest.inventories.logs.quantity)
      .toBeGreaterThan(openingLogs);
    expect(operatedQuarry.inventories['limestone-aggregate'].quantity)
      .toBeGreaterThan(openingAggregate);
    expect(operatedForest.recipeProgressTicks).toBeGreaterThan(0);
    expect(operatedQuarry.recipeProgressTicks).toBeGreaterThan(0);
    expect(operatedSawmill.inventories.logs.quantity).toBe(0);
    await expect(page.locator('[data-testid="facility-status"]'))
      .toHaveText('Needs logs');
    await page.locator('canvas').click({
      position: { x: viewport.width - 28, y: 30 },
    });
    await expect(page.locator('[data-testid="company-save-state"]'))
      .toHaveText('Saved');
    const stopped = await snapshot(page);
    await page.waitForTimeout(1_100);
    expect((await snapshot(page)).world.economy.tick)
      .toBe(stopped.world.economy.tick);
    const saved = await snapshot(page);
    const savedForest = saved.world.economy.facilities.find(
      ({ id }) => id === 'managed-forest',
    )!;
    const savedSawmill = saved.world.economy.facilities.find(
      ({ id }) => id === 'sawmill',
    )!;
    const savedQuarry = saved.world.economy.facilities.find(
      ({ id }) => id === 'quarry',
    )!;
    expect(savedForest.recipeProgressTicks).toBeGreaterThan(0);
    expect(savedQuarry.recipeProgressTicks).toBeGreaterThan(0);
    const persisted = {
      tick: saved.world.economy.tick,
      forestLogs: savedForest.inventories.logs.quantity,
      forestProgressTicks: savedForest.recipeProgressTicks,
      quarryAggregate:
        savedQuarry.inventories['limestone-aggregate'].quantity,
      quarryProgressTicks: savedQuarry.recipeProgressTicks,
      sawmillLogs: savedSawmill.inventories.logs.quantity,
      status: await page.locator('[data-testid="facility-status"]').textContent(),
    };

    await page.reload();
    await openOnlySavedWorld(page, viewport);
    const reloaded = await snapshot(page);
    const reloadedForest = reloaded.world.economy.facilities.find(
      ({ id }) => id === 'managed-forest',
    )!;
    const reloadedSawmill = reloaded.world.economy.facilities.find(
      ({ id }) => id === 'sawmill',
    )!;
    const reloadedQuarry = reloaded.world.economy.facilities.find(
      ({ id }) => id === 'quarry',
    )!;
    expect({
      tick: reloaded.world.economy.tick,
      forestLogs: reloadedForest.inventories.logs.quantity,
      forestProgressTicks: reloadedForest.recipeProgressTicks,
      quarryAggregate:
        reloadedQuarry.inventories['limestone-aggregate'].quantity,
      quarryProgressTicks: reloadedQuarry.recipeProgressTicks,
      sawmillLogs: reloadedSawmill.inventories.logs.quantity,
    }).toEqual({
      tick: persisted.tick,
      forestLogs: persisted.forestLogs,
      forestProgressTicks: persisted.forestProgressTicks,
      quarryAggregate: persisted.quarryAggregate,
      quarryProgressTicks: persisted.quarryProgressTicks,
      sawmillLogs: persisted.sawmillLogs,
    });
    await inspectSawmill(page);
    await expect(page.locator('[data-testid="facility-status"]'))
      .toHaveText(persisted.status ?? '');
  });
}
