import { expect, test, type Locator, type Page } from '@playwright/test';
import { worldToCameraPoint } from './helpers/CameraCoordinates';

const DESKTOP_VIEWPORT = { width: 1920, height: 1400 };
const MOBILE_VIEWPORTS = [
  { name: 'portrait', width: 375, height: 667 },
  { name: 'landscape', width: 667, height: 375 },
] as const;

interface Point {
  x: number;
  y: number;
}

interface CostBreakdown {
  track: number;
  earthworks: number;
  bridge: number;
  tunnel: number;
  total: number;
}

interface ConstructionSnapshot {
  phase: 'idle' | 'dragging' | 'review' | 'committed' | 'chained';
  preview: null | {
    engineeringSubtotal: number;
    totalCost: number;
    affordable: boolean;
    canConfirm: boolean;
    proposal: {
      valid: boolean;
      costs: CostBreakdown;
      structures: Array<{ type: string }>;
    };
  };
  camera: {
    scrollX: number;
    scrollY: number;
    zoom: number;
    width: number;
    height: number;
  };
  world: {
    company: { cash: number };
    starterOpportunity: {
      resolvedAttempt: number;
      sites: Array<Point>;
      corridors: Array<{
        id: string;
        estimatedCost: number;
        feasibilityWitness: {
          totalCost: number;
          segments: Array<{
            geometry: { p0: Point; p3: Point };
            costs: CostBreakdown;
            structures: Array<{ type: string }>;
            topologyCost: number;
          }>;
        };
      }>;
    };
    tracks: unknown[];
  };
}

declare global {
  interface Window {
    __railSimConstructionSnapshot?: () => ConstructionSnapshot;
  }
}

async function snapshot(page: Page): Promise<ConstructionSnapshot> {
  return page.evaluate(() => {
    if (!window.__railSimConstructionSnapshot) {
      throw new Error('Construction snapshot is not available');
    }
    return window.__railSimConstructionSnapshot();
  });
}

async function createFixedSeedWorld(page: Page, seed: string): Promise<void> {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('rail-sim-task9-cleared') !== 'yes') {
      localStorage.clear();
      sessionStorage.setItem('rail-sim-task9-cleared', 'yes');
    }
  });
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
    { timeout: 25_000 },
  );
  await page.keyboard.press('Enter');
  await page.locator('canvas').click({
    position: {
      x: DESKTOP_VIEWPORT.width / 2,
      y: DESKTOP_VIEWPORT.height - 90,
    },
  });
  page.once('dialog', (dialog) => dialog.accept(seed));
  await page.locator('canvas').click({
    position: {
      x: DESKTOP_VIEWPORT.width / 2,
      y: DESKTOP_VIEWPORT.height / 2 - 219,
    },
  });
  await page.locator('canvas').click({
    position: {
      x: DESKTOP_VIEWPORT.width / 2,
      y: DESKTOP_VIEWPORT.height / 2 + 301,
    },
  });
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'WorldScene'
      && typeof window.__railSimConstructionSnapshot === 'function',
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
}

async function openOnlySavedWorld(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
    { timeout: 25_000 },
  );
  await page.keyboard.press('Enter');
  await page.locator('canvas').click({
    position: { x: DESKTOP_VIEWPORT.width / 2, y: 200 },
  });
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'WorldScene'
      && typeof window.__railSimConstructionSnapshot === 'function',
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
}

async function toScreen(
  page: Page,
  point: Point,
  state: ConstructionSnapshot,
): Promise<Point> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  const internal = worldToCameraPoint(point, state.camera);
  return {
    x: canvas.x + internal.x * canvas.width / state.camera.width,
    y: canvas.y + internal.y * canvas.height / state.camera.height,
  };
}

async function dragRoute(page: Page, start: Point, end: Point): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function reviewDirectCorridor(page: Page): Promise<ConstructionSnapshot> {
  const state = await snapshot(page);
  const direct = state.world.starterOpportunity.corridors[0];
  const witness = direct.feasibilityWitness.segments[0];
  await page.keyboard.press('p');
  await dragRoute(
    page,
    await toScreen(page, witness.geometry.p0, state),
    await toScreen(page, witness.geometry.p3, state),
  );
  await expect(page.locator('[data-testid="construction-inspector"]')).toBeVisible();
  return snapshot(page);
}

function aggregateWitnessCosts(
  corridor: ConstructionSnapshot['world']['starterOpportunity']['corridors'][number],
): CostBreakdown {
  return corridor.feasibilityWitness.segments.reduce<CostBreakdown>(
    (total, segment) => ({
      track: total.track + segment.costs.track,
      earthworks: total.earthworks + segment.costs.earthworks,
      bridge: total.bridge + segment.costs.bridge,
      tunnel: total.tunnel + segment.costs.tunnel,
      total: total.total + segment.costs.total,
    }),
    { track: 0, earthworks: 0, bridge: 0, tunnel: 0, total: 0 },
  );
}

async function expectPanelWithinViewport(
  page: Page,
  panel: Locator,
  viewport: { width: number; height: number },
): Promise<void> {
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  const panelOverflow = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(panelOverflow.scrollWidth).toBeLessThanOrEqual(panelOverflow.clientWidth + 1);
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport);
}

async function scrollPanelNormally(page: Page, panel: Locator): Promise<void> {
  await panel.hover();
  await page.mouse.wheel(0, 1_000);
  const scroll = await panel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  if (scroll.scrollHeight > scroll.clientHeight) {
    await expect.poll(
      () => panel.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
  }
}

test.describe('Task 9 fixed-seed construction playtest', () => {
  const terrainCases = [
    {
      name: 'cheap low-earthworks route',
      seed: 'playtest-632',
      attempt: 2,
      direct: {
        estimatedTotal: 30_127,
        total: 30_127,
        track: 17_500,
        earthworks: 12_627,
        bridge: 0,
        tunnel: 0,
      },
      detour: {
        estimatedTotal: 51_388,
        total: 48_888,
        track: 19_488,
        earthworks: 29_400,
        bridge: 0,
        tunnel: 0,
      },
      expectedPreviewStructure: null,
      liveCostProfile: 'cheap',
      checkAffordableMobile: true,
    },
    {
      name: 'rolling earthworks choice',
      seed: 'playtest-601',
      attempt: 3,
      direct: {
        estimatedTotal: 185_131,
        total: 185_131,
        track: 27_893,
        earthworks: 136_953,
        bridge: 7_607,
        tunnel: 12_678,
      },
      detour: {
        estimatedTotal: 119_718,
        total: 117_218,
        track: 33_821,
        earthworks: 83_397,
        bridge: 0,
        tunnel: 0,
      },
      expectedPreviewStructure: 'tunnel',
      liveCostProfile: 'earthworks',
      checkAffordableMobile: false,
    },
    {
      name: 'tunnel versus bridge tradeoff',
      seed: 'playtest-657',
      attempt: 6,
      direct: {
        estimatedTotal: 286_794,
        total: 286_794,
        track: 37_710,
        earthworks: 197_952,
        bridge: 0,
        tunnel: 51_132,
      },
      detour: {
        estimatedTotal: 253_739,
        total: 251_239,
        track: 44_617,
        earthworks: 168_679,
        bridge: 37_943,
        tunnel: 0,
      },
      expectedPreviewStructure: 'tunnel',
      liveCostProfile: 'tunnel',
      checkAffordableMobile: false,
    },
  ] as const;

  for (const terrainCase of terrainCases) {
    test(`quotes the ${terrainCase.name} for ${terrainCase.seed}`, async ({ page }) => {
      await createFixedSeedWorld(page, terrainCase.seed);
      const generated = await snapshot(page);
      const [direct, detour] = generated.world.starterOpportunity.corridors;

      expect(generated.world.tracks).toHaveLength(0);
      expect(generated.world.starterOpportunity.resolvedAttempt).toBe(terrainCase.attempt);
      expect(direct.id).toBe('direct');
      expect(detour.id).toBe('detour');
      expect(direct.estimatedCost).toBe(terrainCase.direct.estimatedTotal);
      expect(direct.feasibilityWitness.totalCost)
        .toBe(terrainCase.direct.estimatedTotal);
      expect(aggregateWitnessCosts(direct)).toEqual({
        total: terrainCase.direct.total,
        track: terrainCase.direct.track,
        earthworks: terrainCase.direct.earthworks,
        bridge: terrainCase.direct.bridge,
        tunnel: terrainCase.direct.tunnel,
      });
      expect(direct.feasibilityWitness.segments.map(
        (segment) => segment.topologyCost,
      )).toEqual([0]);
      expect(detour.estimatedCost).toBe(terrainCase.detour.estimatedTotal);
      expect(detour.feasibilityWitness.totalCost)
        .toBe(terrainCase.detour.estimatedTotal);
      expect(aggregateWitnessCosts(detour)).toEqual({
        total: terrainCase.detour.total,
        track: terrainCase.detour.track,
        earthworks: terrainCase.detour.earthworks,
        bridge: terrainCase.detour.bridge,
        tunnel: terrainCase.detour.tunnel,
      });
      expect(detour.feasibilityWitness.segments.map(
        (segment) => segment.topologyCost,
      )).toEqual([0, 2_500]);

      const reviewed = await reviewDirectCorridor(page);
      expect(reviewed.phase).toBe('review');
      expect(reviewed.preview?.proposal.valid).toBe(true);
      expect(reviewed.preview?.canConfirm).toBe(true);
      expect(reviewed.preview?.affordable).toBe(true);
      expect(reviewed.preview?.engineeringSubtotal)
        .toBe(reviewed.preview?.proposal.costs.total);
      expect(reviewed.preview?.totalCost).toBe(reviewed.preview?.engineeringSubtotal);
      if (terrainCase.liveCostProfile === 'cheap') {
        expect(reviewed.preview?.totalCost).toBeLessThan(50_000);
        expect(reviewed.preview?.proposal.costs.earthworks)
          .toBeLessThan(reviewed.preview?.proposal.costs.track ?? 0);
      } else if (terrainCase.liveCostProfile === 'earthworks') {
        expect(reviewed.preview?.proposal.costs.earthworks).toBeGreaterThan(100_000);
        expect(reviewed.preview?.proposal.costs.earthworks)
          .toBeGreaterThan((reviewed.preview?.proposal.costs.track ?? 0) * 4);
      } else {
        expect(reviewed.preview?.proposal.costs.tunnel).toBeGreaterThan(0);
        expect(reviewed.preview?.proposal.costs.bridge).toBe(0);
      }
      if (terrainCase.expectedPreviewStructure) {
        expect(reviewed.preview?.proposal.structures.map(({ type }) => type))
          .toContain(terrainCase.expectedPreviewStructure);
      } else {
        expect(reviewed.preview?.proposal.structures.some(
          ({ type }) => type === 'bridge' || type === 'tunnel',
        )).toBe(false);
      }
      await expect(page.locator('[data-testid="construction-primary"]'))
        .toContainText((reviewed.preview?.totalCost ?? 0).toLocaleString('en-GB'));
      await expect(page.locator('[data-testid="construction-detail"]'))
        .toContainText('Maximum grade');
      if (terrainCase.checkAffordableMobile) {
        const panel = page.locator('[data-testid="construction-inspector"]');
        const actions = page.locator('[data-testid="construction-actions"]');
        for (const viewport of MOBILE_VIEWPORTS) {
          await page.setViewportSize(viewport);
          await expect(panel).toHaveAttribute('data-layout', 'mobile');
          await expectPanelWithinViewport(page, panel, viewport);
          await expect(page.locator('[data-testid="construction-primary"]')).toBeVisible();
          await scrollPanelNormally(page, panel);
          await expect(actions).toBeInViewport();
          await expect(page.locator('[data-testid="construction-confirm"]')).toBeEnabled();
          await expect(page.locator('[data-testid="construction-confirm"]')).toBeVisible();
        }
      }
    });
  }

  test('shows deterministic unaffordability and readable blocking UI on mobile', async ({ page }) => {
    await createFixedSeedWorld(page, 'playtest-607');
    const generated = await snapshot(page);
    const [direct, detour] = generated.world.starterOpportunity.corridors;

    expect(generated.world.company.cash).toBe(1_000_000);
    expect(generated.world.starterOpportunity.resolvedAttempt).toBe(1);
    expect(direct.estimatedCost).toBe(98_077);
    expect(aggregateWitnessCosts(direct)).toEqual({
      total: 98_077,
      track: 31_579,
      earthworks: 66_498,
      bridge: 0,
      tunnel: 0,
    });
    expect(direct.feasibilityWitness.segments.map(
      (segment) => segment.topologyCost,
    )).toEqual([0]);
    expect(detour.estimatedCost).toBe(100_953);
    expect(detour.feasibilityWitness.totalCost).toBe(100_953);
    expect(aggregateWitnessCosts(detour)).toEqual({
      total: 98_453,
      track: 32_754,
      earthworks: 65_699,
      bridge: 0,
      tunnel: 0,
    });
    expect(detour.feasibilityWitness.segments.map(
      (segment) => segment.topologyCost,
    )).toEqual([0, 2_500]);

    await page.evaluate((cash) => {
      const key = 'rail-sim-worlds';
      const worlds = JSON.parse(localStorage.getItem(key) ?? '{}');
      const source = Object.values(worlds)[0] as any;
      const fixture = JSON.parse(JSON.stringify(source));
      fixture.id = 'task9-low-cash-world';
      fixture.name = 'Task 9 Low Cash Fixture';
      fixture.company.cash = cash;
      fixture.company.ledger[0].amount = cash;
      fixture.metadata.createdAt = Date.now() + 1;
      fixture.metadata.updatedAt = Date.now() + 1;
      localStorage.setItem(key, JSON.stringify({ [fixture.id]: fixture }));
    }, direct.estimatedCost - 1);
    await page.reload();
    await openOnlySavedWorld(page);
    const lowCash = await snapshot(page);
    expect(lowCash.world.company.cash).toBe(98_076);
    expect(lowCash.world.tracks).toHaveLength(0);

    const reviewed = await reviewDirectCorridor(page);
    expect(reviewed.phase).toBe('review');
    expect(reviewed.preview?.proposal.valid).toBe(true);
    expect(reviewed.preview?.totalCost).toBeGreaterThan(
      lowCash.world.company.cash,
    );
    expect(reviewed.preview?.proposal.costs.bridge).toBe(0);
    expect(reviewed.preview?.proposal.costs.tunnel).toBe(0);
    expect(reviewed.preview?.affordable).toBe(false);
    expect(reviewed.preview?.canConfirm).toBe(false);
    await expect(page.locator('[data-testid="construction-primary"]'))
      .toContainText('Unaffordable');
    await expect(page.locator('[data-testid="construction-remedy"]')).toBeVisible();
    await expect(page.locator('[data-testid="construction-confirm"]')).toBeDisabled();

    const panel = page.locator('[data-testid="construction-inspector"]');
    const primary = page.locator('[data-testid="construction-primary"]');
    const remedy = page.locator('[data-testid="construction-remedy"]');
    const actions = page.locator('[data-testid="construction-actions"]');
    for (const viewport of MOBILE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(panel).toHaveAttribute('data-layout', 'mobile');
      await expectPanelWithinViewport(page, panel, viewport);
      await expect(primary).toBeVisible();
      await expect(remedy).toBeVisible();

      await scrollPanelNormally(page, panel);
      await expect(actions).toBeInViewport();
      await expect(page.locator('[data-testid="construction-confirm"]')).toBeVisible();
      await expect(page.locator('[data-testid="construction-back"]')).toBeVisible();
      await expect(page.locator('[data-testid="construction-cancel"]')).toBeVisible();
    }

    await page.keyboard.press('Enter');
    const rejected = await snapshot(page);
    expect(rejected.world.tracks).toHaveLength(0);
    expect(rejected.world.company.cash).toBe(98_076);
  });
});
