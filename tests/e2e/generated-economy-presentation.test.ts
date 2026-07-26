import { expect, test, type Page } from '@playwright/test';

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 375, height: 667 };
const WORLD_SEEDS = [
  'economy-presentation-017',
  'economy-presentation-113',
  'economy-presentation-271',
] as const;

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
    company: { cash: number };
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
      corridors: Array<{ estimatedCost: number }>;
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
  seed: string,
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
  page.once('dialog', (dialog) => dialog.accept(seed));
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
  const expectedSlots = [
    { productId: 'logs', displayName: 'Logs' },
    {
      productId: 'structural-timber',
      displayName: 'Structural Timber',
    },
  ] as const;
  const inventories = page.locator('[data-testid="facility-inventories"]');
  const inventoryRows = inventories.locator(':scope > div');
  await expect(inventoryRows).toHaveCount(expectedSlots.length);
  const quotes = page.locator('[data-testid="facility-quotes"]');
  const quoteRows = quotes.locator(':scope > div');
  await expect(quoteRows).toHaveCount(expectedSlots.length);
  for (const { productId, displayName } of expectedSlots) {
    const slot = sawmill.inventories[productId];
    expect(slot).toBeDefined();
    await expect(inventories).toContainText(
      `${displayName} ${slot.quantity.toLocaleString('en-GB')} / `
        + slot.capacity.toLocaleString('en-GB'),
    );
    const progress = page.getByRole('progressbar', {
      name: `${displayName} inventory`,
    });
    await expect(progress).toHaveAttribute('max', String(slot.capacity));
    await expect(progress).toHaveJSProperty('value', slot.quantity);
    await expect(quotes).toContainText(
      new RegExp(`${displayName} · £[\\d,]+ / unit`),
    );
  }
  await expect(quotes).toContainText('Global construction');
  await expect(quotes).toContainText('Regional demand');
  await expect(quotes).toContainText('Inventory pressure');
  // Proves the global scene pointerdown did not immediately clear the marker.
  await page.waitForTimeout(100);
  await expect(inspector).toBeVisible();
}

const playtestCases = [
  { seed: WORLD_SEEDS[0], viewport: DESKTOP },
  { seed: WORLD_SEEDS[0], viewport: MOBILE },
  { seed: WORLD_SEEDS[1], viewport: DESKTOP },
  { seed: WORLD_SEEDS[2], viewport: DESKTOP },
] as const;

for (const { seed, viewport } of playtestCases) {
  const label = viewport === MOBILE ? '375x667' : 'desktop';
  test(`presents and persists ${seed} at ${label}`, async ({ page }) => {
    await createFixedSeedWorld(page, viewport, seed);
    const generated = await snapshot(page);
    expect(generated.world.tracks).toHaveLength(0);
    expect(generated.world.trains).toHaveLength(0);
    expect(generated.world.economy.facilities).toHaveLength(7);
    expect(Math.min(...generated.world.starterOpportunity.corridors.map(
      ({ estimatedCost }) => estimatedCost,
    ))).toBeLessThanOrEqual(generated.world.company.cash);
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

    if (seed === WORLD_SEEDS[0] && viewport === DESKTOP) {
      await page.evaluate(() => {
        const key = 'rail-sim-worlds';
        const worlds = JSON.parse(localStorage.getItem(key) ?? '{}');
        const world = Object.values(worlds)[0] as
          PresentationSnapshot['world'] & { id: string };
        const forest = world.economy.facilities.find(
          ({ id }) => id === 'managed-forest',
        )!;
        const quarry = world.economy.facilities.find(
          ({ id }) => id === 'quarry',
        )!;
        forest.inventories.logs.quantity = 232;
        forest.recipeProgressTicks = 0;
        quarry.inventories['limestone-aggregate'].quantity = 290;
        quarry.recipeProgressTicks = 0;
        localStorage.setItem(key, JSON.stringify({
          [world.id]: world,
        }));
      });
      await page.reload();
      await openOnlySavedWorld(page, viewport);
      await page.locator('canvas').click({
        position: { x: viewport.width - 28, y: 30 },
      });
      await expect.poll(async () => {
        const current = await snapshot(page);
        const currentForest = current.world.economy.facilities.find(
          ({ id }) => id === 'managed-forest',
        )!;
        const currentQuarry = current.world.economy.facilities.find(
          ({ id }) => id === 'quarry',
        )!;
        return {
          forestLogs: currentForest.inventories.logs.quantity,
          quarryAggregate:
            currentQuarry.inventories['limestone-aggregate'].quantity,
        };
      }, { timeout: 8_000 }).toEqual({
        forestLogs: 240,
        quarryAggregate: 300,
      });
      await page.locator('canvas').click({
        position: { x: viewport.width - 28, y: 30 },
      });
      const saturated = await snapshot(page);
      const saturatedForest = saturated.world.economy.facilities.find(
        ({ id }) => id === 'managed-forest',
      )!;
      await page.waitForTimeout(1_100);
      expect((await snapshot(page)).world.economy.tick)
        .toBe(saturated.world.economy.tick);
      const saturatedForestScreen = await toScreen(
        page,
        saturatedForest,
        saturated,
      );
      await page.mouse.click(
        saturatedForestScreen.x,
        saturatedForestScreen.y,
      );
      await expect(page.locator('[data-testid="facility-name"]'))
        .toHaveText('Managed Forest');
      await expect(page.locator('[data-testid="facility-status"]'))
        .toHaveText('Output storage full');
    }
  });
}
