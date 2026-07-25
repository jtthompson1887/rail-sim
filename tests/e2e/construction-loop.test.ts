import { expect, test, type Page } from '@playwright/test';

const VIEWPORT = { width: 1920, height: 1400 };
const WORLD_SEED = 'real-terrain-alpha';

interface Point {
  x: number;
  y: number;
}

interface ConstructionSnapshot {
  phase: 'idle' | 'dragging' | 'review' | 'committed' | 'chained';
  preview: null | {
    engineeringSubtotal: number;
    topologyCost: number;
    totalCost: number;
    cashBefore: number;
    cashAfter: number;
    affordable: boolean;
    canConfirm: boolean;
    proposal: {
      valid: boolean;
      length: number;
      maximumGradePercent: number;
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
    id: string;
    revision: number;
    company: { cash: number };
    starterOpportunity: {
      corridors: Array<{
        waypoints: Point[];
        feasibilityWitness: {
          segments: Array<{
            geometry: { p0: Point; p3: Point };
          }>;
        };
      }>;
    };
    tracks: Array<{
      uuid: string;
      p0: Point;
      p1: Point;
      p2: Point;
      p3: Point;
      verticalProfile: unknown;
      structures: unknown[];
      paidBuildCost: number;
    }>;
    junctions: unknown[];
    trains: unknown[];
  };
  topology: Array<{
    kind: 'track' | 'junction';
    uuid: string;
    previous: null | { kind: 'track' | 'junction'; uuid: string };
    next: null | { kind: 'track' | 'junction'; uuid: string };
  }>;
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

async function waitForWorld(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'WorldScene'
      && typeof window.__railSimConstructionSnapshot === 'function',
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
}

async function createFixedSeedWorld(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('rail-sim-e2e-cleared') !== 'yes') {
      localStorage.clear();
      sessionStorage.setItem('rail-sim-e2e-cleared', 'yes');
    }
  });
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
    { timeout: 25_000 },
  );
  await page.keyboard.press('Enter');
  await page.locator('canvas').click({
    position: { x: VIEWPORT.width / 2, y: VIEWPORT.height - 90 },
  });
  page.once('dialog', (dialog) => dialog.accept(WORLD_SEED));
  await page.locator('canvas').click({
    position: { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 - 219 },
  });
  await page.locator('canvas').click({
    position: { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 + 301 },
  });
  await waitForWorld(page);
}

async function openOnlySavedWorld(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
    { timeout: 25_000 },
  );
  await page.keyboard.press('Enter');
  await page.locator('canvas').click({
    position: { x: VIEWPORT.width / 2, y: 200 },
  });
  await waitForWorld(page);
}

async function toScreen(
  page: Page,
  point: Point,
  state: ConstructionSnapshot,
): Promise<Point> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  const internalX = state.camera.width / 2
    + (point.x - state.camera.scrollX - state.camera.width / 2) * state.camera.zoom;
  const internalY = state.camera.height / 2
    + (point.y - state.camera.scrollY - state.camera.height / 2) * state.camera.zoom;
  return {
    x: canvas.x + internalX * canvas.width / state.camera.width,
    y: canvas.y + internalY * canvas.height / state.camera.height,
  };
}

async function dragRoute(page: Page, start: Point, end: Point): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function frameSurfaceDetour(page: Page): Promise<ConstructionSnapshot> {
  const before = await snapshot(page);
  await page.keyboard.press('h');
  await dragRoute(page, { x: 1000, y: 500 }, { x: 1000, y: 600 });
  await page.waitForFunction(
    (scrollY) => window.__railSimConstructionSnapshot?.().camera.scrollY !== scrollY,
    before.camera.scrollY,
  );
  return snapshot(page);
}

function extendLiveTangent(
  track: ConstructionSnapshot['world']['tracks'][number],
  distance: number,
): Point {
  const dx = track.p3.x - track.p2.x;
  const dy = track.p3.y - track.p2.y;
  const length = Math.hypot(dx, dy);
  return {
    x: track.p3.x + dx / length * distance,
    y: track.p3.y + dy / length * distance,
  };
}

function chainedCandidates(
  track: ConstructionSnapshot['world']['tracks'][number],
): Point[] {
  return [
    extendLiveTangent(track, 600),
    { x: track.p3.x + 1_600, y: track.p3.y },
    { x: track.p3.x + 1_800, y: track.p3.y + 600 },
    { x: track.p3.x + 1_800, y: track.p3.y + 1_000 },
  ];
}

function persistedConstruction(state: ConstructionSnapshot) {
  return {
    cash: state.world.company.cash,
    tracks: state.world.tracks.map((track) => ({
      uuid: track.uuid,
      p0: track.p0,
      p1: track.p1,
      p2: track.p2,
      p3: track.p3,
      verticalProfile: track.verticalProfile,
      structures: track.structures,
      paidBuildCost: track.paidBuildCost,
    })),
    junctions: state.world.junctions,
    topology: state.topology,
  };
}

test.describe('fixed-seed construction decision loop', () => {
  test('builds, chains, undo/redoes, and reloads exact construction data', async ({ page }) => {
    await createFixedSeedWorld(page);
    const blank = await snapshot(page);
    expect(blank.world.tracks).toHaveLength(0);
    expect(blank.world.trains).toHaveLength(0);
    expect(blank.world.starterOpportunity.corridors).toHaveLength(2);

    const framed = await frameSurfaceDetour(page);
    await page.keyboard.press('p');
    const firstWitness =
      blank.world.starterOpportunity.corridors[1].feasibilityWitness.segments[0];
    const start = await toScreen(page, firstWitness.geometry.p0, framed);
    const end = await toScreen(page, firstWitness.geometry.p3, framed);
    await dragRoute(
      page,
      start,
      end,
    );
    await expect(page.locator('[data-testid="construction-inspector"]')).toBeVisible();
    await expect(page.locator('[data-testid="construction-primary"]')).toContainText('Build');
    await expect(page.locator('[data-testid="construction-detail"]')).toContainText('Maximum grade');
    const reviewed = await snapshot(page);
    expect(reviewed.phase).toBe('review');
    expect(reviewed.preview?.proposal.valid).toBe(true);
    expect(reviewed.preview?.canConfirm).toBe(true);
    expect(reviewed.preview?.totalCost).toBeGreaterThan(0);
    expect(reviewed.preview?.proposal.maximumGradePercent).toBeGreaterThanOrEqual(0);
    expect(reviewed.preview?.proposal.structures.every(
      ({ type }) => type !== 'bridge' && type !== 'tunnel',
    )).toBe(true);

    await page.locator('[data-testid="construction-back"]').focus();
    await page.keyboard.press('Enter');
    expect((await snapshot(page)).phase).toBe('dragging');
    await page.locator('[data-testid="construction-cancel"]').focus();
    await page.keyboard.press('Space');
    expect((await snapshot(page)).phase).toBe('idle');
    await expect(page.locator('[data-testid="construction-inspector"]')).toBeHidden();

    await dragRoute(page, start, start);
    const invalid = await snapshot(page);
    expect(invalid.phase).toBe('review');
    expect(invalid.preview?.proposal.valid).toBe(false);
    await expect(page.locator('[data-testid="construction-confirm"]')).toBeDisabled();
    expect(invalid.world.tracks).toHaveLength(0);
    expect(invalid.world.company.cash).toBe(blank.world.company.cash);
    await page.keyboard.press('Enter');
    expect((await snapshot(page)).world.tracks).toHaveLength(0);
    await page.locator('[data-testid="construction-cancel"]').click();

    await dragRoute(page, start, end);
    const firstReview = await snapshot(page);
    expect(firstReview.preview?.canConfirm).toBe(true);
    await page.locator('[data-testid="construction-confirm"]').focus();
    await page.keyboard.press('Enter');
    const firstBuilt = await snapshot(page);
    expect(firstBuilt.phase).toBe('chained');
    expect(firstBuilt.world.tracks).toHaveLength(1);
    expect(firstBuilt.world.tracks[0].paidBuildCost).toBe(firstReview.preview?.totalCost);
    expect(firstBuilt.world.company.cash).toBe(firstReview.preview?.cashAfter);
    await expect(page.locator('[data-testid="company-save-state"]')).toHaveText('Unsaved');

    const chainStart = await toScreen(page, firstBuilt.world.tracks[0].p3, firstBuilt);
    let secondReview: ConstructionSnapshot | null = null;
    for (const candidate of chainedCandidates(firstBuilt.world.tracks[0])) {
      await dragRoute(
        page,
        chainStart,
        await toScreen(page, candidate, firstBuilt),
      );
      secondReview = await snapshot(page);
      if (secondReview.preview?.canConfirm) break;
      await page.locator('[data-testid="construction-back"]').click();
    }
    expect(secondReview).not.toBeNull();
    if (!secondReview) throw new Error('No chained preview was produced');
    expect(secondReview.phase).toBe('review');
    expect(secondReview.preview?.proposal.valid).toBe(true);
    expect(secondReview.preview?.canConfirm).toBe(true);
    expect(secondReview.preview?.topologyCost).toBeGreaterThan(0);
    expect(secondReview.preview?.totalCost).toBe(
      (secondReview.preview?.engineeringSubtotal ?? 0)
        + (secondReview.preview?.topologyCost ?? 0),
    );
    await expect(page.locator('[data-testid="construction-detail"]')).toContainText(
      `Topology £${secondReview.preview?.topologyCost.toLocaleString('en-GB')}`,
    );
    await page.locator('[data-testid="construction-confirm"]').click();
    const bothBuilt = await snapshot(page);
    expect(bothBuilt.world.tracks).toHaveLength(2);
    expect(bothBuilt.world.tracks[1].paidBuildCost).toBe(secondReview.preview?.totalCost);
    const firstNode = bothBuilt.topology.find(
      ({ uuid }) => uuid === bothBuilt.world.tracks[0].uuid,
    );
    const secondNode = bothBuilt.topology.find(
      ({ uuid }) => uuid === bothBuilt.world.tracks[1].uuid,
    );
    expect(firstNode?.next?.uuid).toBe(bothBuilt.world.tracks[1].uuid);
    expect(secondNode?.previous?.uuid).toBe(bothBuilt.world.tracks[0].uuid);

    await page.keyboard.press('Control+z');
    const undone = await snapshot(page);
    expect(undone.world.tracks).toHaveLength(1);
    expect(undone.world.company.cash).toBe(firstBuilt.world.company.cash);
    expect(undone.topology[0].next).toBeNull();
    await page.keyboard.press('Control+y');
    const redone = await snapshot(page);
    expect(redone.world.tracks).toHaveLength(2);
    expect(redone.world.company.cash).toBe(bothBuilt.world.company.cash);
    expect(redone.topology).toEqual(bothBuilt.topology);

    await page.keyboard.press('Control+s');
    await expect(page.locator('[data-testid="company-save-state"]')).toHaveText('Saved');
    const savedConstruction = persistedConstruction(await snapshot(page));
    await page.reload();
    await openOnlySavedWorld(page);
    const reloaded = await snapshot(page);
    expect(persistedConstruction(reloaded)).toEqual(savedConstruction);
    await expect(page.locator('[data-testid="company-cash"]')).toContainText(
      reloaded.world.company.cash.toLocaleString('en-GB'),
    );
  });

  test('rejects an unaffordable quote from a reloaded low-cash fixture', async ({ page }) => {
    await createFixedSeedWorld(page);
    const generated = await snapshot(page);
    await page.evaluate(() => {
      const key = 'rail-sim-worlds';
      const worlds = JSON.parse(localStorage.getItem(key) ?? '{}');
      const source = Object.values(worlds)[0] as any;
      const fixture = JSON.parse(JSON.stringify(source));
      fixture.id = 'e2e-low-cash-world';
      fixture.name = 'Low Cash Construction Fixture';
      fixture.company.cash = 1;
      fixture.metadata.createdAt = Date.now() + 1;
      fixture.metadata.updatedAt = Date.now() + 1;
      localStorage.setItem(key, JSON.stringify({ [fixture.id]: fixture }));
    });

    await page.reload();
    await openOnlySavedWorld(page);
    const lowCash = await snapshot(page);
    expect(lowCash.world.company.cash).toBe(1);
    expect(lowCash.world.tracks).toHaveLength(0);
    await page.keyboard.press('p');
    const witness =
      generated.world.starterOpportunity.corridors[1].feasibilityWitness.segments[0];
    await dragRoute(
      page,
      await toScreen(page, witness.geometry.p0, lowCash),
      await toScreen(page, witness.geometry.p3, lowCash),
    );
    const unaffordable = await snapshot(page);
    expect(unaffordable.phase).toBe('review');
    expect(unaffordable.preview?.proposal.valid).toBe(true);
    expect(unaffordable.preview?.affordable).toBe(false);
    expect(unaffordable.preview?.canConfirm).toBe(false);
    await expect(page.locator('[data-testid="construction-primary"]')).toContainText(
      'Unaffordable',
    );
    await expect(page.locator('[data-testid="construction-confirm"]')).toBeDisabled();
    await page.keyboard.press('Enter');
    const rejected = await snapshot(page);
    expect(rejected.world.tracks).toHaveLength(0);
    expect(rejected.world.company.cash).toBe(1);
  });
});
