import {
  expect,
  test,
  type Page,
  type ViewportSize,
} from '@playwright/test';
import type { FirstRouteBrowserSnapshot } from '../../src/scenes/WorldScene';
import {
  resolvePrefabricationExtensionStart,
} from '../../src/economy/PrefabricationOpportunity';
import { queryRailAccessConnectivity } from '../../src/freight/RailAccessConnectivity';
import type { ConstructionPreviewModel } from '../../src/ui/ConstructionPreviewOverlay';

const DESKTOP = { width: 1920, height: 1400 };
const MOBILE = { width: 375, height: 667 };
const EXPECTED_SCHEMA_VERSION = 9;
const CASH = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const signedCash = (value: number): string => value < 0
  ? `−${CASH.format(Math.abs(value))}`
  : CASH.format(value);

interface Point {
  readonly x: number;
  readonly y: number;
}

interface CementBrowserSnapshot extends FirstRouteBrowserSnapshot {
  readonly construction: FirstRouteBrowserSnapshot['construction'] & {
    readonly preview: ConstructionPreviewModel | null;
  };
}

type Facility =
  CementBrowserSnapshot['world']['economy']['facilities'][number];
type Train = CementBrowserSnapshot['world']['trains'][number];
type Runtime = CementBrowserSnapshot['runtime'][number];

declare global {
  interface Window {
    __railSimFirstRouteHarness?: {
      snapshot(): FirstRouteBrowserSnapshot;
      setMode(mode: 'create' | 'play'): void;
      advanceFixedTicks(count: number): void;
      setTrainRuntime(
        trainId: string,
        runtime: Pick<
          Runtime,
          'x' | 'y' | 'speedWorldUnitsPerSecond' | 'throttle' | 'derailed'
        >,
      ): void;
    };
    __railSimScene?: string;
  }
}

const snapshot = async (page: Page): Promise<CementBrowserSnapshot> =>
  page.evaluate(() => {
    const harness = window.__railSimFirstRouteHarness;
    if (!harness) throw new Error('Cement browser harness is unavailable');
    return harness.snapshot() as CementBrowserSnapshot;
  });

const facility = (
  state: CementBrowserSnapshot,
  definitionId: string,
): Facility => {
  const result = state.world.economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!result) throw new Error(`Missing ${definitionId}`);
  return result;
};

const trainById = (
  state: CementBrowserSnapshot,
  trainId: string,
): Train => {
  const result = state.world.trains.find(({ id }) => id === trainId);
  if (!result) throw new Error(`Missing train ${trainId}`);
  return result;
};

const runtimeById = (
  state: CementBrowserSnapshot,
  trainId: string,
): Runtime => {
  const result = state.runtime.find(({ trainId: id }) => id === trainId);
  if (!result) throw new Error(`Missing runtime ${trainId}`);
  return result;
};

const categoryTotal = (
  state: CementBrowserSnapshot,
  category: string,
): number => state.world.company.ledger
  .filter((entry) => entry.category === category)
  .reduce((total, entry) => total + Math.abs(entry.amount), 0);

const distanceTo = (left: Point, right: Point): number =>
  Math.hypot(left.x - right.x, left.y - right.y);

const worldToCameraPoint = async (
  page: Page,
  point: Point,
): Promise<Point> => page.evaluate((target) => {
  const scene = window.__railSimGame.scene.getScene('WorldScene');
  const camera = scene.cameras.main;
  const origin = camera.getWorldPoint(0, 0);
  const xUnit = camera.getWorldPoint(1, 0);
  const yUnit = camera.getWorldPoint(0, 1);
  const a = xUnit.x - origin.x;
  const b = yUnit.x - origin.x;
  const c = xUnit.y - origin.y;
  const d = yUnit.y - origin.y;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-12) {
    throw new Error('Camera transform is not invertible');
  }
  const worldX = target.x - origin.x;
  const worldY = target.y - origin.y;
  return {
    x: (d * worldX - b * worldY) / determinant,
    y: (-c * worldX + a * worldY) / determinant,
  };
}, point);

async function waitForHarness(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__railSimScene === 'WorldScene'
      && typeof window.__railSimFirstRouteHarness?.snapshot === 'function',
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
}

async function waitForRenderedFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function createFixedSeedWorld(
  page: Page,
  seed: string,
  viewport: ViewportSize,
): Promise<CementBrowserSnapshot> {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await page.waitForFunction(
    () => window.__railSimScene === 'MenuScene',
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.press('Enter');
  const canvas = page.locator('canvas');
  const pickerPanelHeight = Math.min(690, viewport.height - 40);
  const seedY = viewport.height / 2 - pickerPanelHeight / 2 + 126;
  const confirmY = viewport.height / 2 + pickerPanelHeight / 2 - 44;
  await canvas.click({
    position: { x: viewport.width / 2, y: viewport.height - 90 },
  });
  page.once('dialog', (dialog) => dialog.accept(seed));
  await canvas.click({ position: { x: viewport.width / 2, y: seedY } });
  await canvas.click({
    position: { x: viewport.width / 2, y: confirmY },
  });
  await waitForHarness(page);

  const created = await snapshot(page);
  expect(created.world.schemaVersion).toBe(EXPECTED_SCHEMA_VERSION);
  expect(created.world.generationConfig.seed).toBe(seed);
  expect(created.world.economy.facilities).toHaveLength(7);
  expect(created.world.tracks).toHaveLength(0);
  expect(created.world.junctions).toHaveLength(0);
  expect(created.world.stations).toHaveLength(0);
  expect(created.world.trains).toHaveLength(0);
  for (const definitionId of [
    'managed-forest',
    'sawmill',
    'quarry',
    'cement-works',
    'prefabrication-plant',
  ]) {
    expect(facility(created, definitionId).railAccess.radius)
      .toBeGreaterThan(0);
  }
  expect(facility(created, 'managed-forest').inventories.logs.capacity)
    .toBe(240);
  expect(facility(created, 'quarry').inventories[
    'limestone-aggregate'
  ].capacity).toBe(300);
  return created;
}

async function toPagePoint(
  page: Page,
  point: Point,
  state: CementBrowserSnapshot,
): Promise<Point> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  const internal = await worldToCameraPoint(page, point);
  return {
    x: canvas.x + internal.x * canvas.width / state.camera.width,
    y: canvas.y + internal.y * canvas.height / state.camera.height,
  };
}

async function panWorldPointToCentre(
  page: Page,
  target: Point,
): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('h');
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await snapshot(page);
    const internal = await worldToCameraPoint(page, target);
    const dx = state.camera.width / 2 - internal.x;
    const dy = state.camera.height * 0.54 - internal.y;
    if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) return;
    const moveX = Math.max(-240, Math.min(
      240,
      dx * canvas.width / state.camera.width,
    ));
    const moveY = Math.max(-240, Math.min(
      240,
      dy * canvas.height / state.camera.height,
    ));
    const origin = {
      x: canvas.x + canvas.width * 0.48,
      y: canvas.y + canvas.height * 0.68,
    };
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + moveX, origin.y + moveY, { steps: 8 });
    await page.mouse.up();
  }
  throw new Error(`Could not centre ${JSON.stringify(target)}`);
}

async function clickFacilityThroughPointer(
  page: Page,
  definitionId: string,
): Promise<void> {
  let state = await snapshot(page);
  await panWorldPointToCentre(
    page,
    facility(state, definitionId).railAccess,
  );
  state = await snapshot(page);
  const point = await toPagePoint(
    page,
    facility(state, definitionId).railAccess,
    state,
  );
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('[data-testid="facility-inspector"]'))
    .toBeVisible();
}

async function selectTrainThroughPointer(
  page: Page,
  trainId: string,
): Promise<void> {
  let state = await snapshot(page);
  await panWorldPointToCentre(page, runtimeById(state, trainId));
  state = await snapshot(page);
  const point = await toPagePoint(page, runtimeById(state, trainId), state);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('[data-testid="train-inspector"]')).toBeVisible();
}

async function fitLink(
  page: Page,
  start: Point,
  end: Point,
): Promise<CementBrowserSnapshot> {
  await panWorldPointToCentre(page, {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  });
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await snapshot(page);
    const endpoints = await Promise.all([
      worldToCameraPoint(page, start),
      worldToCameraPoint(page, end),
    ]);
    if (endpoints.every((point) => (
      point.x >= 380
      && point.x <= state.camera.width - 360
      && point.y >= 100
      && point.y <= state.camera.height - 130
    ))) return state;
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    await page.mouse.wheel(0, 600);
  }
  throw new Error(`Could not fit link ${JSON.stringify({ start, end })}`);
}

async function dragTrack(
  page: Page,
  startWorld: Point,
  endWorld: Point,
): Promise<void> {
  const moveToWorld = async (target: Point): Promise<void> => {
    let pagePoint = await toPagePoint(page, target, await snapshot(page));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.mouse.move(pagePoint.x, pagePoint.y, { steps: 4 });
      const observed = await page.evaluate(() => {
        const scene = window.__railSimGame.scene.getScene('WorldScene');
        const pointer = scene.input.activePointer;
        const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return {
          pointer: { x: pointer.x, y: pointer.y },
          world: { x: world.x, y: world.y },
        };
      });
      if (distanceTo(observed.world, target) <= 2) return;
      const state = await snapshot(page);
      const desired = await worldToCameraPoint(page, target);
      const canvas = await page.locator('canvas').boundingBox();
      if (!canvas) throw new Error('Canvas is not visible');
      pagePoint = {
        x: pagePoint.x + (
          desired.x - observed.pointer.x
        ) * canvas.width / state.camera.width,
        y: pagePoint.y + (
          desired.y - observed.pointer.y
        ) * canvas.height / state.camera.height,
      };
    }
    throw new Error(`Could not move pointer to ${JSON.stringify(target)}`);
  };
  const startPage = await toPagePoint(
    page,
    startWorld,
    await snapshot(page),
  );
  await page.mouse.move(startPage.x + 24, startPage.y + 24);
  await moveToWorld(startWorld);
  await waitForRenderedFrame(page);
  await page.mouse.down();
  await moveToWorld(endWorld);
  await page.mouse.up();
}

async function buildWitnessLink(
  page: Page,
  start: Point,
  end: Point,
  expectedConnections?: number,
  expectedGeometry?: ConstructionPreviewModel['proposal']['geometry'],
): Promise<string> {
  const before = await snapshot(page);
  await fitLink(page, start, end);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await waitForRenderedFrame(page);
  const framed = await snapshot(page);
  expect(framed.construction.phase).toBe('idle');
  await dragTrack(
    page,
    start,
    end,
  );
  const confirm = page.locator('[data-testid="construction-confirm"]');
  if (!await confirm.isEnabled()) {
    const failed = await snapshot(page);
    throw new Error(JSON.stringify({
      message: 'Generated pointer link is not buildable',
      start,
      end,
      construction: failed.construction,
    }));
  }
  const reviewed = await snapshot(page);
  expect(reviewed.construction.phase).toBe('review');
  expect(reviewed.construction.preview).toMatchObject({
    affordable: true,
    canConfirm: true,
  });
  if (expectedGeometry) {
    expect(reviewed.construction.preview?.proposal.geometry)
      .toEqual(expectedGeometry);
  }
  if (expectedConnections !== undefined) {
    const connections =
      reviewed.construction.preview?.predictedConnections ?? [];
    if (connections.length !== expectedConnections) {
      const startScreen = await toPagePoint(page, start, reviewed);
      const endScreen = await toPagePoint(page, end, reviewed);
      throw new Error(JSON.stringify({
        message: 'Generated link did not snap to expected live endpoints',
        expectedConnections,
        actualConnections: connections,
        start,
        end,
        preview: reviewed.construction.preview,
        startScreen,
        endScreen,
      }));
    }
  }
  await confirm.click();
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  const committed = await snapshot(page);
  expect(committed.world.tracks).toHaveLength(before.world.tracks.length + 1);
  return committed.world.tracks.find(
    ({ uuid }) => !before.world.tracks.some((track) => track.uuid === uuid),
  )!.uuid;
}

async function buildStarter(
  page: Page,
): Promise<void> {
  const opening = await snapshot(page);
  const corridor = [...opening.world.starterOpportunity.corridors].sort(
    (left, right) => left.estimatedCost - right.estimatedCost
      || left.id.localeCompare(right.id),
  )[0];
  if (!corridor) throw new Error('No generated starter witness');
  expect(corridor.estimatedCost).toBeLessThanOrEqual(400_000);
  for (const segment of corridor.feasibilityWitness.segments) {
    await buildWitnessLink(
      page,
      segment.geometry.p0,
      segment.geometry.p3,
      undefined,
      segment.geometry,
    );
  }
  const built = await snapshot(page);
  expect(categoryTotal(built, 'construction-capex'))
    .toBe(corridor.estimatedCost);
  expect(queryRailAccessConnectivity(
    built.world.tracks,
    built.construction.topology,
    facility(built, 'managed-forest').railAccess,
    facility(built, 'sawmill').railAccess,
  ).connected).toBe(true);
}

const nearestEndpoint = (
  state: CementBrowserSnapshot,
  target: Point,
): Point => {
  const endpoint = state.world.tracks.flatMap((track) => [
    track.p0,
    track.p3,
  ]).sort((left, right) => (
    distanceTo(left, target) - distanceTo(right, target)
  ))[0];
  if (!endpoint) throw new Error('No player track endpoint exists');
  return endpoint;
};

async function buildGeneratedExtensions(
  page: Page,
): Promise<void> {
  const opening = await snapshot(page);
  const extensionStart = resolvePrefabricationExtensionStart(
    opening.world.starterOpportunity,
  );
  if (!extensionStart) throw new Error('No generated Prefab extension start');
  const liveExtensionStart = nearestEndpoint(opening, extensionStart.point);
  expect(distanceTo(liveExtensionStart, extensionStart.point))
    .toBeLessThanOrEqual(1);
  const prefab = facility(opening, 'prefabrication-plant').railAccess;
  const quarry = facility(opening, 'quarry').railAccess;
  const cementWorks = facility(opening, 'cement-works').railAccess;
  await buildWitnessLink(
    page,
    liveExtensionStart,
    prefab,
    1,
  );
  const mineralCapexBefore = categoryTotal(
    await snapshot(page),
    'construction-capex',
  );
  await buildWitnessLink(
    page,
    quarry,
    cementWorks,
    0,
  );
  await buildWitnessLink(
    page,
    cementWorks,
    prefab,
    2,
  );
  const built = await snapshot(page);
  expect(
    categoryTotal(built, 'construction-capex') - mineralCapexBefore,
  ).toBeLessThanOrEqual(180_000);
  for (const [source, destination] of [
    ['sawmill', 'prefabrication-plant'],
    ['quarry', 'cement-works'],
    ['cement-works', 'prefabrication-plant'],
  ] as const) {
    expect(queryRailAccessConnectivity(
      built.world.tracks,
      built.construction.topology,
      facility(built, source).railAccess,
      facility(built, destination).railAccess,
    ).connected).toBe(true);
  }
}

const bezierPoint = (
  track: CementBrowserSnapshot['world']['tracks'][number],
  t: number,
): Point => {
  const inverse = 1 - t;
  return {
    x: track.p0.x * inverse ** 3
      + 3 * track.p1.x * inverse ** 2 * t
      + 3 * track.p2.x * inverse * t ** 2
      + track.p3.x * t ** 3,
    y: track.p0.y * inverse ** 3
      + 3 * track.p1.y * inverse ** 2 * t
      + 3 * track.p2.y * inverse * t ** 2
      + track.p3.y * t ** 3,
  };
};

const tangentAt = (
  track: CementBrowserSnapshot['world']['tracks'][number],
  t: number,
): Point => {
  const inverse = 1 - t;
  return {
    x: 3 * inverse * inverse * (track.p1.x - track.p0.x)
      + 6 * inverse * t * (track.p2.x - track.p1.x)
      + 3 * t * t * (track.p3.x - track.p2.x),
    y: 3 * inverse * inverse * (track.p1.y - track.p0.y)
      + 6 * inverse * t * (track.p2.y - track.p1.y)
      + 3 * t * t * (track.p3.y - track.p2.y),
  };
};

const placementInsideAccess = (
  state: CementBrowserSnapshot,
  access: Point & { readonly radius: number },
): {
  readonly point: Point;
  readonly trackT: number;
  readonly trackUUID: string;
} => {
  const candidates = state.world.tracks.flatMap((track) => {
    const points: Array<{
      point: Point;
      trackT: number;
      trackUUID: string;
      distance: number;
    }> = [];
    for (let step = 0; step <= 100; step += 1) {
      const trackT = step / 100;
      const point = bezierPoint(track, trackT);
      const distance = distanceTo(point, access);
      if (distance >= access.radius * 0.5
        && distance <= access.radius * 0.78) {
        points.push({ point, trackT, trackUUID: track.uuid, distance });
      }
    }
    return points;
  }).sort((left, right) => right.distance - left.distance
    || left.trackUUID.localeCompare(right.trackUUID)
    || left.trackT - right.trackT);
  const result = candidates[0];
  if (!result) throw new Error('No placement point inside facility access');
  return result;
};

async function purchaseFreightSetAtSource(
  page: Page,
  freightSetId:
    | 'flatbed-freight-set'
    | 'aggregate-hopper-set'
    | 'covered-cement-set',
  sourceDefinitionId: 'managed-forest' | 'quarry' | 'cement-works',
): Promise<string> {
  const before = await snapshot(page);
  const existingIds = new Set(before.world.trains.map(({ id }) => id));
  const source = facility(before, sourceDefinitionId);
  const placement = placementInsideAccess(before, source.railAccess);
  await panWorldPointToCentre(page, placement.point);
  const panel = page.locator('[data-testid="vehicle-purchase-panel"]');
  await expect(panel).toBeVisible();
  for (const selector of [
    'flatbed-freight-set-buy',
    'aggregate-hopper-set-buy',
    'covered-cement-set-buy',
  ]) {
    await expect(page.locator(`[data-testid="${selector}"]`)).toBeVisible();
  }
  await page.locator(`[data-testid="${freightSetId}-buy"]`).click();
  const framed = await snapshot(page);
  const point = await toPagePoint(page, placement.point, framed);
  await page.mouse.click(point.x, point.y);
  const confirm = page.locator('[data-testid="freight-purchase-confirm"]');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect.poll(async () => (
    (await snapshot(page)).world.trains.length
  )).toBe(before.world.trains.length + 1);
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  const purchased = await snapshot(page);
  const added = purchased.world.trains.find(({ id }) => !existingIds.has(id));
  const destinationDefinitionId = {
    'managed-forest': 'sawmill',
    quarry: 'cement-works',
    'cement-works': 'prefabrication-plant',
  } as const;
  expect(added).toMatchObject({
    freightSetId,
    trackUUID: placement.trackUUID,
  });
  expect(added!.trackT).toBeCloseTo(placement.trackT, 2);
  const persistedTrack = purchased.world.tracks.find(
    ({ uuid }) => uuid === added!.trackUUID,
  );
  if (!persistedTrack) throw new Error('Purchased train track disappeared');
  const persistedPoint = bezierPoint(persistedTrack, added!.trackT);
  const runtimePoint = runtimeById(purchased, added!.id);
  expect(distanceTo(persistedPoint, source.railAccess))
    .toBeLessThanOrEqual(source.railAccess.radius);
  expect(distanceTo(runtimePoint, source.railAccess))
    .toBeLessThanOrEqual(source.railAccess.radius);
  const tangent = tangentAt(persistedTrack, added!.trackT);
  const destination = facility(
    purchased,
    destinationDefinitionId[sourceDefinitionId],
  ).railAccess;
  expect(added!.facing * (
    tangent.x * (destination.x - persistedPoint.x)
      + tangent.y * (destination.y - persistedPoint.y)
  )).toBeGreaterThan(0);
  return added!.id;
}

async function setMode(
  page: Page,
  mode: 'create' | 'play',
): Promise<void> {
  const purchasePanel = page.locator(
    '[data-testid="vehicle-purchase-panel"]',
  );
  if (mode === 'create') {
    if (await purchasePanel.isVisible()) return;
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="company-hud"]')).toBeHidden();
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas is not visible');
    await canvas.click({
      position: { x: box.width / 2, y: box.height * 0.56 },
    });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.keyboard.press('h');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="facility-inspector"]'))
      .toBeHidden();
    await expect(purchasePanel).toBeVisible();
    await expect(page.locator('[data-testid="train-inspector"]')).toBeHidden();
    return;
  }
  await page.evaluate((nextMode) => {
    window.__railSimFirstRouteHarness?.setMode(nextMode);
  }, mode);
  await expect(purchasePanel).toBeHidden();
}

async function advanceFixedTicks(
  page: Page,
  count: number,
): Promise<void> {
  await page.evaluate((ticks) => {
    window.__railSimFirstRouteHarness?.advanceFixedTicks(ticks);
  }, count);
}

async function setTrainRuntime(
  page: Page,
  trainId: string,
  runtime: Pick<
    Runtime,
    'x' | 'y' | 'speedWorldUnitsPerSecond' | 'throttle' | 'derailed'
  >,
): Promise<void> {
  await page.evaluate(({ id, values }) => {
    window.__railSimFirstRouteHarness?.setTrainRuntime(id, values);
  }, { id: trainId, values: runtime });
}

async function stopTrainAt(
  page: Page,
  trainId: string,
  definitionId: string,
): Promise<void> {
  const state = await snapshot(page);
  const access = facility(state, definitionId).railAccess;
  await setTrainRuntime(page, trainId, {
    x: access.x,
    y: access.y,
    speedWorldUnitsPerSecond: 0,
    throttle: 0,
    derailed: false,
  });
}

const connectedMidpoint = (
  state: CementBrowserSnapshot,
  sourceDefinitionId: string,
  destinationDefinitionId: string,
): Point => {
  const result = queryRailAccessConnectivity(
    state.world.tracks,
    state.construction.topology,
    facility(state, sourceDefinitionId).railAccess,
    facility(state, destinationDefinitionId).railAccess,
  );
  if (!result.connected || result.connectedTrackUUIDs.length === 0) {
    throw new Error(
      `No connected route ${sourceDefinitionId} -> ${destinationDefinitionId}`,
    );
  }
  const track = state.world.tracks.find(
    ({ uuid }) => uuid === result.connectedTrackUUIDs[
      Math.floor(result.connectedTrackUUIDs.length / 2)
    ],
  );
  if (!track) throw new Error('Connected route track disappeared');
  return bezierPoint(track, 0.5);
};

async function chargeActiveTick(
  page: Page,
  trainId: string,
  sourceDefinitionId: string,
  destinationDefinitionId: string,
  count = 1,
): Promise<void> {
  const state = await snapshot(page);
  const point = connectedMidpoint(
    state,
    sourceDefinitionId,
    destinationDefinitionId,
  );
  await setTrainRuntime(page, trainId, {
    x: point.x,
    y: point.y,
    speedWorldUnitsPerSecond: 12,
    throttle: 1,
    derailed: false,
  });
  await advanceFixedTicks(page, count);
}

const keyToward = (
  state: CementBrowserSnapshot,
  runtime: Runtime,
  target: Point,
): 'w' | 's' => {
  const track = state.world.tracks.find(
    ({ uuid }) => uuid === runtime.trackUUID,
  );
  if (!track || runtime.trackT === null) return 'w';
  const tangent = tangentAt(track, runtime.trackT);
  const dot = runtime.facing * (
    tangent.x * (target.x - runtime.x)
    + tangent.y * (target.y - runtime.y)
  );
  return dot >= 0 ? 'w' : 's';
};

const oppositeKey = (key: 'w' | 's'): 'w' | 's' =>
  key === 'w' ? 's' : 'w';

async function driveLoadedTrainWithKeyboard(
  page: Page,
  trainId: string,
  destinationDefinitionId: string,
  expectedProductId: string,
  expectedUnits: number,
  transferTicks = 0,
): Promise<void> {
  const opening = await snapshot(page);
  const destination = facility(
    opening,
    destinationDefinitionId,
  ).railAccess;
  expect(trainById(opening, trainId).cargo).toMatchObject({
    productId: expectedProductId,
    units: expectedUnits,
    loadedUnits: expectedUnits,
  });
  let held: 'w' | 's' | null = null;
  const openingDistance = distanceTo(
    runtimeById(opening, trainId),
    destination,
  );
  let previousDistance = openingDistance;
  let bestDistance = openingDistance;
  let movingToward = true;
  let observedMotion = false;
  const hold = async (next: 'w' | 's' | null): Promise<void> => {
    if (held === next) return;
    if (held) await page.keyboard.up(held);
    held = next;
    if (held) await page.keyboard.down(held);
  };
  const pulse = async (key: 'w' | 's', duration: number): Promise<void> => {
    await hold(null);
    await page.keyboard.down(key);
    await page.waitForTimeout(duration);
    await page.keyboard.up(key);
  };

  try {
    await expect.poll(async () => {
      const state = await snapshot(page);
      const runtime = runtimeById(state, trainId);
      const cargoUnits = trainById(state, trainId).cargo?.units ?? 0;
      const distance = distanceTo(runtime, destination);
      bestDistance = Math.min(bestDistance, distance);
      if (Math.abs(distance - previousDistance) > 0.5) {
        movingToward = distance < previousDistance;
        observedMotion = true;
      }
      previousDistance = distance;
      if (runtime.derailed) throw new Error('Keyboard-driven train derailed');
      const propulsion = keyToward(state, runtime, destination);
      if (cargoUnits < expectedUnits) {
        await hold(null);
      } else if (distance <= destination.radius * 0.72) {
        await hold(null);
        if (runtime.speedWorldUnitsPerSecond > 2) {
          await pulse(
            movingToward ? oppositeKey(propulsion) : propulsion,
            runtime.speedWorldUnitsPerSecond > 20 ? 60 : 25,
          );
        }
      } else if (distance <= destination.radius * 2) {
        await hold(null);
        if (!movingToward) {
          await pulse(propulsion, 30);
        } else if (runtime.speedWorldUnitsPerSecond > 28) {
          await pulse(oppositeKey(propulsion), 35);
        } else if (runtime.speedWorldUnitsPerSecond < 20) {
          await pulse(propulsion, 35);
        }
      } else if (!movingToward) {
        await hold(null);
        await pulse(propulsion, 35);
      } else if (runtime.speedWorldUnitsPerSecond < 45) {
        await hold(propulsion);
      } else {
        await hold(null);
      }
      return transferTicks > 0
        ? {
          inside: distance <= destination.radius,
          full: cargoUnits === expectedUnits,
        }
        : {
          inside: distance <= destination.radius,
          stopped: runtime.speedWorldUnitsPerSecond <= 2,
          transferred: trainById(state, trainId).cargo === null,
        };
    }, {
      timeout: 240_000,
      intervals: [50, 75, 100, 150],
    }).toEqual(transferTicks > 0
      ? { inside: true, full: true }
      : { inside: true, stopped: true, transferred: true });
  } finally {
    await page.keyboard.up('w');
    await page.keyboard.up('s');
  }
  expect(observedMotion).toBe(true);
  if (transferTicks > 0) {
    const arrived = await snapshot(page);
    expect(bestDistance).toBeLessThan(openingDistance);
    expect(distanceTo(runtimeById(arrived, trainId), destination))
      .toBeLessThanOrEqual(destination.radius);
    expect(trainById(arrived, trainId).cargo).toMatchObject({
      productId: expectedProductId,
      units: expectedUnits,
      loadedUnits: expectedUnits,
    });
    const runtime = runtimeById(arrived, trainId);
    await setTrainRuntime(page, trainId, {
      x: runtime.x,
      y: runtime.y,
      speedWorldUnitsPerSecond: 0,
      throttle: 0,
      derailed: false,
    });
    const stopped = await snapshot(page);
    expect(runtimeById(stopped, trainId).x).toBeCloseTo(runtime.x, 6);
    expect(runtimeById(stopped, trainId).y).toBeCloseTo(runtime.y, 6);
    expect(distanceTo(runtimeById(stopped, trainId), destination))
      .toBeLessThanOrEqual(destination.radius);
    expect(runtimeById(stopped, trainId).speedWorldUnitsPerSecond).toBe(0);
    expect(trainById(stopped, trainId).cargo).toMatchObject({
      productId: expectedProductId,
      units: expectedUnits,
      loadedUnits: expectedUnits,
    });
    await advanceFixedTicks(page, transferTicks);
    expect(trainById(await snapshot(page), trainId).cargo).toBeNull();
  }
}

async function runFixedLogTrip(
  page: Page,
  trainId: string,
): Promise<void> {
  await stopTrainAt(page, trainId, 'managed-forest');
  await advanceFixedTicks(page, 6);
  expect(trainById(await snapshot(page), trainId).cargo).toMatchObject({
    productId: 'logs',
    units: 60,
  });
  await chargeActiveTick(
    page,
    trainId,
    'managed-forest',
    'sawmill',
  );
  await stopTrainAt(page, trainId, 'sawmill');
  await advanceFixedTicks(page, 6);
  expect(trainById(await snapshot(page), trainId).cargo).toBeNull();
}

async function establishCementObjective(
  page: Page,
  keyboardTrip: boolean,
): Promise<{ flatbedId: string }> {
  await buildStarter(page);
  const flatbedId = await purchaseFreightSetAtSource(
    page,
    'flatbed-freight-set',
    'managed-forest',
  );
  await setMode(page, 'play');
  if (keyboardTrip) {
    await expect.poll(async () => (
      trainById(await snapshot(page), flatbedId).cargo?.units ?? 0
    ), {
      timeout: 30_000,
      intervals: [250, 500],
    }).toBe(60);
    await driveLoadedTrainWithKeyboard(
      page,
      flatbedId,
      'sawmill',
      'logs',
      60,
    );
  } else {
    await runFixedLogTrip(page, flatbedId);
  }
  let state = await snapshot(page);
  expect(state.world.freightProgress.profitableLogDeliveryCompleted)
    .toBe(true);
  expect(state.objective).toMatchObject({
    id: 'structural-timber-link',
    achieved: false,
  });

  await setMode(page, 'create');
  await buildGeneratedExtensions(page);
  await setMode(page, 'play');
  await runFixedLogTrip(page, flatbedId);
  await runFixedLogTrip(page, flatbedId);

  await stopTrainAt(page, flatbedId, 'sawmill');
  for (let attempt = 0; attempt < 80; attempt += 1) {
    state = await snapshot(page);
    if (trainById(state, flatbedId).cargo?.productId === 'structural-timber'
      && trainById(state, flatbedId).cargo?.units === 60) break;
    await advanceFixedTicks(page, 1);
  }
  state = await snapshot(page);
  expect(trainById(state, flatbedId).cargo).toMatchObject({
    productId: 'structural-timber',
    units: 60,
  });
  await chargeActiveTick(
    page,
    flatbedId,
    'sawmill',
    'prefabrication-plant',
  );
  await stopTrainAt(page, flatbedId, 'prefabrication-plant');
  await advanceFixedTicks(page, 6);
  state = await snapshot(page);
  expect(state.world.freightProgress
    .profitableStructuralTimberDeliveryCompleted).toBe(true);
  expect(state.objective).toMatchObject({
    id: 'cement-supply-chain',
    achieved: false,
  });
  await expect(page.locator('[data-testid="freight-objective"]'))
    .toHaveAttribute('data-objective', 'cement-supply-chain');
  return { flatbedId };
}

async function purchaseAggregate(
  page: Page,
): Promise<string> {
  await setMode(page, 'create');
  return purchaseFreightSetAtSource(
    page,
    'aggregate-hopper-set',
    'quarry',
  );
}

async function loadFullAggregate(
  page: Page,
  trainId: string,
): Promise<void> {
  await setMode(page, 'play');
  await stopTrainAt(page, trainId, 'quarry');
  await advanceFixedTicks(page, 12);
  expect(trainById(await snapshot(page), trainId).cargo).toMatchObject({
    productId: 'limestone-aggregate',
    units: 120,
    loadedUnits: 120,
  });
}

async function reloadOnlySavedWorld(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  await setMode(page, 'play');
  await page.keyboard.press('Escape');
  const canvas = page.locator('canvas');
  const before = await canvas.boundingBox();
  if (!before) throw new Error('Canvas is not visible');
  await canvas.click({
    position: { x: before.width / 2, y: before.height * 0.67 },
  });
  await page.waitForFunction(
    () => window.__railSimScene === 'MenuScene',
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__railSimScene === 'WorldSelectScene',
    undefined,
    { timeout: 30_000 },
  );
  await waitForRenderedFrame(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await canvas.click({
    position: { x: box.width / 2, y: Math.min(200, box.height / 3) },
  });
  await waitForHarness(page);
}

async function expectSelectedTrainFigures(
  page: Page,
  state: CementBrowserSnapshot,
  trainId: string,
): Promise<void> {
  const operations = trainById(state, trainId).operations;
  await expect(page.locator('[data-testid="train-current-trip-profit"]'))
    .toHaveText(CASH.format(
      operations.currentTripRevenue - operations.currentTripRunningCost,
    ));
  await expect(page.locator('[data-testid="train-last-delivery-profit"]'))
    .toHaveText(CASH.format(
      operations.lastTripRevenue - operations.lastTripRunningCost,
    ));
  await expect(page.locator('[data-testid="train-lifetime-profit"]'))
    .toHaveText(CASH.format(
      operations.lifetimeRevenue - operations.lifetimeRunningCost,
    ));
}

async function expectOperatingSummary(
  page: Page,
  state: CementBrowserSnapshot,
): Promise<void> {
  const throughTick = state.world.economy.tick;
  const fromTick = Math.max(0, throughTick - 23);
  const summary = state.world.company.ledger
    .filter(({ tick }) => tick >= fromTick && tick <= throughTick)
    .reduce((result, entry) => {
      if (entry.category === 'delivery-revenue') {
        result.deliveryRevenue += entry.amount;
      } else if (entry.category === 'contract-bonus') {
        result.contractBonuses += entry.amount;
      }
      if (entry.ledgerClass === 'operating-expense') {
        result.runningExpenses -= entry.amount;
      } else if (entry.ledgerClass === 'capital-expenditure') {
        result.capitalExpenditure -= entry.amount;
      }
      result.cashFlow += entry.amount;
      return result;
    }, {
      deliveryRevenue: 0,
      contractBonuses: 0,
      runningExpenses: 0,
      capitalExpenditure: 0,
      cashFlow: 0,
    });
  const railProfit = summary.deliveryRevenue
    + summary.contractBonuses
    - summary.runningExpenses;
  expect(state.world.company.cash).toBe(
    state.world.company.ledger.reduce(
      (cash, { amount }) => cash + amount,
      0,
    ),
  );
  await expect(page.locator('[data-testid="company-delivery-revenue"]'))
    .toHaveText(`Deliveries ${CASH.format(summary.deliveryRevenue)}`);
  await expect(page.locator('[data-testid="company-contract-bonuses"]'))
    .toHaveText(`Development ${CASH.format(summary.contractBonuses)}`);
  await expect(page.locator('[data-testid="company-running-expenses"]'))
    .toHaveText(`Running ${CASH.format(summary.runningExpenses)}`);
  const operatingProfit = page.locator(
    '[data-testid="company-operating-profit"]',
  );
  await expect(operatingProfit)
    .toHaveText(`Rail profit ${signedCash(railProfit)}`);
  await expect(operatingProfit).toHaveAttribute(
    'data-tone',
    railProfit > 0
      ? 'profit'
      : railProfit < 0
        ? 'loss'
        : 'neutral',
  );
  await expect(page.locator('[data-testid="company-capital-expenditure"]'))
    .toHaveText(`Capex ${CASH.format(summary.capitalExpenditure)}`);
  await expect(page.locator('[data-testid="company-cash-flow"]'))
    .toHaveText(`Cash flow ${signedCash(summary.cashFlow)}`);
}

function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function provePrimaryCementJourney(
  page: Page,
  seed: string,
  viewport: ViewportSize,
): Promise<void> {
  const errors = captureErrors(page);
  await createFixedSeedWorld(page, seed, viewport);
  await establishCementObjective(page, true);
  const aggregateId = await purchaseAggregate(page);
  await loadFullAggregate(page, aggregateId);
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  await reloadOnlySavedWorld(page);
  await setMode(page, 'play');
  await selectTrainThroughPointer(page, aggregateId);
  await expect(page.locator('[data-testid="train-cargo-progress"]'))
    .toHaveAttribute(
      'aria-label',
      'Cargo Limestone Aggregate 120 of 120 tonnes',
    );
  await expect(page.locator('[data-testid="train-cargo-progress"]'))
    .toHaveAttribute('value', '120');
  const beforeLimestone = await snapshot(page);
  await driveLoadedTrainWithKeyboard(
    page,
    aggregateId,
    'cement-works',
    'limestone-aggregate',
    120,
    12,
  );
  let state = await snapshot(page);
  expect(trainById(state, aggregateId).cargo).toBeNull();
  const limestoneOperations = trainById(state, aggregateId).operations;
  expect(limestoneOperations.lifetimeDeliveredUnits).toBe(120);
  expect(
    state.world.company.cash - beforeLimestone.world.company.cash,
  ).toBe(
    limestoneOperations.lastTripRevenue
      - limestoneOperations.lastTripRunningCost,
  );
  expect(state.world.freightProgress.profitableLimestoneDeliveryCompleted)
    .toBe(true);
  expect(facility(state, 'cement-works')).toMatchObject({
    recipeProgressTicks: 3,
    inventories: {
      'limestone-aggregate': { quantity: 96 },
      cement: { quantity: 16 },
    },
  });
  expect(
    facility(state, 'cement-works').inventories[
      'limestone-aggregate'
    ].quantity
      + facility(state, 'cement-works').inventories.cement.quantity / 8 * 12,
  ).toBe(120);
  await expect(page.locator('[data-testid="company-last-delivery"]'))
    .toHaveAttribute('data-tone', 'profit');
  await expect(page.locator('[data-testid="company-last-delivery"]'))
    .toContainText('Limestone Aggregate delivered to Cement Works');

  await chargeActiveTick(
    page,
    aggregateId,
    'quarry',
    'cement-works',
    16,
  );
  state = await snapshot(page);
  expect(facility(state, 'cement-works')).toMatchObject({
    recipeProgressTicks: 3,
    inventories: {
      'limestone-aggregate': { quantity: 48 },
      cement: { quantity: 48 },
    },
  });
  expect(
    facility(state, 'cement-works').inventories[
      'limestone-aggregate'
    ].quantity
      + facility(state, 'cement-works').inventories.cement.quantity / 8 * 12,
  ).toBe(120);
  await clickFacilityThroughPointer(page, 'cement-works');
  const facilityInspector = page.locator(
    '[data-testid="facility-inspector"]',
  );
  await expect(page.locator('[data-testid="facility-name"]'))
    .toHaveText('Cement Works');
  await expect(page.locator('[data-testid="facility-status"]'))
    .toHaveText('Working 3 / 4 ticks');
  await expect(page.locator('[data-testid="facility-recipe"]'))
    .toContainText('Cement kiln · 12 t Limestone Aggregate → 8 t Cement');
  await expect(page.locator('[data-testid="facility-recipe"]'))
    .toContainText('4 ticks');
  await expect(facilityInspector)
    .toContainText('Limestone Aggregate 48 / 240 tonnes');
  await expect(facilityInspector).toContainText('Cement 48 / 160 tonnes');
  await setTrainRuntime(page, aggregateId, {
    ...connectedMidpoint(state, 'quarry', 'cement-works'),
    speedWorldUnitsPerSecond: 0,
    throttle: 0,
    derailed: false,
  });
  await advanceFixedTicks(page, 24);
  state = await snapshot(page);
  expect(facility(state, 'cement-works')).toMatchObject({
    recipeProgressTicks: 0,
    inventories: {
      'limestone-aggregate': { quantity: 0 },
      cement: { quantity: 80 },
    },
  });
  expect(
    facility(state, 'cement-works').inventories[
      'limestone-aggregate'
    ].quantity
      + facility(state, 'cement-works').inventories.cement.quantity / 8 * 12,
  ).toBe(120);
  await clickFacilityThroughPointer(page, 'cement-works');
  await expect(page.locator('[data-testid="facility-name"]'))
    .toHaveText('Cement Works');
  await expect(page.locator('[data-testid="facility-status"]'))
    .toHaveText('Needs limestone aggregate');
  await expect(page.locator('[data-testid="facility-recipe"]'))
    .toContainText('Cement kiln · 12 t Limestone Aggregate → 8 t Cement');
  await expect(facilityInspector)
    .toContainText('Limestone Aggregate 0 / 240 tonnes');
  await expect(facilityInspector).toContainText('Cement 80 / 160 tonnes');

  await setMode(page, 'create');
  const cementId = await purchaseFreightSetAtSource(
    page,
    'covered-cement-set',
    'cement-works',
  );
  await setMode(page, 'play');
  await stopTrainAt(page, cementId, 'cement-works');
  await advanceFixedTicks(page, 8);
  state = await snapshot(page);
  expect(trainById(state, cementId).cargo).toMatchObject({
    productId: 'cement',
    units: 80,
    loadedUnits: 80,
  });
  expect(facility(state, 'cement-works').inventories.cement.quantity).toBe(0);
  expect(
    facility(state, 'prefabrication-plant').inventories.cement.quantity,
  ).toBe(0);
  await selectTrainThroughPointer(page, cementId);
  await expect(page.locator('[data-testid="train-cargo-progress"]'))
    .toHaveAttribute('aria-label', 'Cargo Cement 80 of 80 tonnes');
  await expect(page.locator('[data-testid="train-cargo-progress"]'))
    .toHaveAttribute('value', '80');
  await expectSelectedTrainFigures(page, state, cementId);
  const beforeCementDelivery = state;
  await chargeActiveTick(
    page,
    cementId,
    'cement-works',
    'prefabrication-plant',
  );
  await stopTrainAt(page, cementId, 'prefabrication-plant');
  await advanceFixedTicks(page, 8);
  state = await snapshot(page);
  expect(trainById(state, cementId).cargo).toBeNull();
  const cementOperations = trainById(state, cementId).operations;
  expect(cementOperations.lifetimeDeliveredUnits).toBe(80);
  expect(
    state.world.company.cash - beforeCementDelivery.world.company.cash,
  ).toBe(
    cementOperations.lastTripRevenue
      - cementOperations.lastTripRunningCost,
  );
  expect(facility(state, 'cement-works').inventories.cement.quantity).toBe(0);
  expect(
    facility(state, 'prefabrication-plant').inventories.cement.quantity,
  ).toBe(80);
  expect(state.world.freightProgress.profitableCementDeliveryCompleted)
    .toBe(true);
  expect(state.objective).toMatchObject({
    id: 'cement-supply-chain',
    achieved: true,
  });
  await expect(page.locator('[data-testid="company-last-delivery"]'))
    .toHaveAttribute('data-tone', 'profit');
  await expect(page.locator('[data-testid="company-last-delivery"]'))
    .toContainText('Cement delivered to Prefabrication Plant');
  await selectTrainThroughPointer(page, cementId);
  await expect(page.locator('[data-testid="train-cargo-progress"]'))
    .toHaveAttribute('aria-label', 'Cargo Empty 0 of 80 tonnes');
  await expect(page.locator('[data-testid="train-cargo-progress"]'))
    .toHaveAttribute('value', '0');
  await expectSelectedTrainFigures(page, state, cementId);
  await expectOperatingSummary(page, state);

  const persisted = {
    tracks: state.world.tracks,
    trains: state.world.trains,
    facilities: state.world.economy.facilities,
    company: state.world.company,
    progress: state.world.freightProgress,
    objective: state.objective,
  };
  await reloadOnlySavedWorld(page);
  const reloaded = await snapshot(page);
  expect({
    tracks: reloaded.world.tracks,
    trains: reloaded.world.trains,
    facilities: reloaded.world.economy.facilities,
    company: reloaded.world.company,
    progress: reloaded.world.freightProgress,
    objective: reloaded.objective,
  }).toEqual(persisted);
  expect(errors).toEqual([]);
}

async function proveLossAndRecovery(
  page: Page,
  seed: string,
  viewport: ViewportSize,
): Promise<void> {
  const errors = captureErrors(page);
  await createFixedSeedWorld(page, seed, viewport);
  await buildStarter(page);
  const trainId = await purchaseFreightSetAtSource(
    page,
    'flatbed-freight-set',
    'managed-forest',
  );
  await setMode(page, 'play');
  await stopTrainAt(page, trainId, 'managed-forest');
  await advanceFixedTicks(page, 1);
  expect(trainById(await snapshot(page), trainId).cargo).toMatchObject({
    productId: 'logs',
    units: 10,
    loadedUnits: 10,
  });
  await chargeActiveTick(
    page,
    trainId,
    'managed-forest',
    'sawmill',
    400,
  );
  await stopTrainAt(page, trainId, 'sawmill');
  await advanceFixedTicks(page, 1);
  let state = await snapshot(page);
  expect(trainById(state, trainId).operations.lastTripRevenue)
    .toBeLessThan(
      trainById(state, trainId).operations.lastTripRunningCost,
    );
  await expect(page.locator('[data-testid="company-last-delivery"]'))
    .toHaveAttribute('data-tone', 'loss');
  await expect(page.locator('[data-testid="company-last-delivery"]'))
    .toContainText('Trip loss');
  expect(state.world.freightProgress.profitableLogDeliveryCompleted)
    .toBe(false);

  const lossOperations = trainById(state, trainId).operations;
  await reloadOnlySavedWorld(page);
  state = await snapshot(page);
  expect(trainById(state, trainId).operations).toEqual(lossOperations);

  await setMode(page, 'play');
  await stopTrainAt(page, trainId, 'managed-forest');
  await advanceFixedTicks(page, 6);
  expect(trainById(await snapshot(page), trainId).cargo).toMatchObject({
    productId: 'logs',
    units: 60,
    loadedUnits: 60,
  });
  await chargeActiveTick(
    page,
    trainId,
    'managed-forest',
    'sawmill',
  );
  await stopTrainAt(page, trainId, 'sawmill');
  await advanceFixedTicks(page, 6);
  state = await snapshot(page);
  expect(trainById(state, trainId).operations.lastTripRevenue)
    .toBeGreaterThan(
      trainById(state, trainId).operations.lastTripRunningCost,
    );
  expect(state.world.freightProgress.profitableLogDeliveryCompleted)
    .toBe(true);
  await expect(page.locator('[data-testid="company-last-delivery"]'))
    .toHaveAttribute('data-tone', 'profit');
  await expect(page.locator('[data-testid="company-last-delivery"]'))
    .toContainText('Trip profit');
  expect(errors).toEqual([]);
}

async function assertWithinViewport(
  page: Page,
  selector: string,
): Promise<void> {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`${selector} has no bounds`);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function proveMobilePurchaseSafety(
  page: Page,
  seed: string,
  viewport: ViewportSize,
): Promise<void> {
  const errors = captureErrors(page);
  const opening = await createFixedSeedWorld(page, seed, viewport);
  const panel = page.locator('[data-testid="vehicle-purchase-panel"]');
  await expect(panel).toHaveAttribute('data-layout', 'mobile');
  await expect(panel).toHaveAttribute('aria-label', 'Vehicle purchase');
  await assertWithinViewport(page, '[data-testid="vehicle-purchase-panel"]');
  const choices = [
    ['flatbed-freight-set-buy', '60 t'],
    ['aggregate-hopper-set-buy', '120 t'],
    ['covered-cement-set-buy', '80 t'],
  ] as const;
  for (const [testId, capacity] of choices) {
    const choice = page.locator(`[data-testid="${testId}"]`);
    await assertWithinViewport(page, `[data-testid="${testId}"]`);
    await expect(choice).toContainText(capacity);
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="freight-purchase-confirm"]'))
      .toBeDisabled();
  }
  const closing = await snapshot(page);
  expect(closing.world.company.cash).toBe(opening.world.company.cash);
  expect(closing.world.tracks).toEqual(opening.world.tracks);
  expect(closing.world.trains).toEqual(opening.world.trains);
  expect(closing.construction.phase).toBe('idle');
  expect(closing.runtime).toHaveLength(0);
  const overflow = await page.evaluate(() => ({
    width: document.body.scrollWidth,
    height: document.body.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.height).toBeLessThanOrEqual(overflow.clientHeight);
  expect(errors).toEqual([]);
}

test.describe('generated cement supply chain browser journey', () => {
  test('playtest-753 builds and operates the full profitable chain', async ({
    page,
  }) => {
    test.setTimeout(720_000);
    await provePrimaryCementJourney(page, 'playtest-753', DESKTOP);
  });

  test('real-terrain-alpha explains a loss and preserves profitable recovery', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await proveLossAndRecovery(page, 'real-terrain-alpha', DESKTOP);
  });

  test('first-route-browser-gamma keeps mobile purchase controls input-safe', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await proveMobilePurchaseSafety(
      page,
      'first-route-browser-gamma',
      MOBILE,
    );
  });
});
