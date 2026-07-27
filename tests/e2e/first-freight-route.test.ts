import { expect, test, type Page } from '@playwright/test';
import { worldToCameraPoint } from './helpers/CameraCoordinates';

const DESKTOP = { width: 1920, height: 1400 };
const MOBILE = { width: 375, height: 667 };
const REAL_TIME_SEED = 'real-terrain-alpha';
const CONTROLLED_SEED = 'first-route-browser-beta';
const MOBILE_SEED = 'first-route-browser-gamma';
const DEVELOPMENT_GRANT = 250_000;
const DEVELOPMENT_GRANT_REFERENCE =
  'regional-development-grant:v1';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface LedgerEntry {
  readonly id: number;
  readonly tick: number;
  readonly category: string;
  readonly amount: number;
  readonly referenceId: string;
}

interface Track {
  readonly uuid: string;
  readonly p0: Point;
  readonly p1: Point;
  readonly p2: Point;
  readonly p3: Point;
  readonly paidBuildCost: number;
}

interface Train {
  readonly id: string;
  readonly trackUUID: string;
  readonly trackT: number;
  readonly facing: 1 | -1;
  readonly cargo: null | {
    readonly productId: string;
    readonly units: number;
    readonly originFacilityId: string;
  };
  readonly operations: {
    readonly currentTripRevenue: number;
    readonly currentTripRunningCost: number;
    readonly lastTripRevenue: number;
    readonly lastTripRunningCost: number;
    readonly lifetimeDeliveredUnits: number;
    readonly lifetimeRevenue: number;
    readonly lifetimeRunningCost: number;
  };
}

interface Facility {
  readonly id: string;
  readonly definitionId: string;
  readonly railAccess: Point & { readonly radius: number };
  readonly recipeProgressTicks: number;
  readonly inventories: Record<string, {
    readonly productId: string;
    readonly quantity: number;
    readonly reservedQuantity: number;
    readonly capacity: number;
    readonly targetStock: number;
    readonly recentInflow: number;
    readonly recentOutflow: number;
  }>;
}

interface FirstRouteWorld {
  readonly id: string;
  readonly revision: number;
  readonly generationConfig: { readonly seed: string };
  readonly company: {
    readonly cash: number;
    readonly ledger: readonly LedgerEntry[];
  };
  readonly economy: {
    readonly tick: number;
    readonly facilities: readonly Facility[];
    readonly market: {
      readonly constructionIndexBps: number;
      readonly regionalDemandBpsByProduct: Record<string, number>;
    };
  };
  readonly freightProgress: {
    readonly progressVersion: 1;
    readonly profitableLogDeliveryCompleted: boolean;
    readonly developmentGrantAwarded: boolean;
    readonly profitableStructuralTimberDeliveryCompleted: boolean;
  };
  readonly starterOpportunity: {
    readonly corridors: readonly {
      readonly id: string;
      readonly estimatedCost: number;
      readonly feasibilityWitness: {
        readonly segments: readonly {
          readonly geometry: { readonly p0: Point; readonly p3: Point };
        }[];
      };
    }[];
  };
  readonly tracks: readonly Track[];
  readonly junctions: readonly unknown[];
  readonly stations: readonly unknown[];
  readonly trains: readonly Train[];
}

interface Runtime {
  readonly trainId: string;
  readonly trackUUID: string | null;
  readonly trackT: number | null;
  readonly facing: 1 | -1;
  readonly x: number;
  readonly y: number;
  readonly speedWorldUnitsPerSecond: number;
  readonly throttle: -1 | 0 | 1;
  readonly derailed: boolean;
}

interface FirstRouteBrowserSnapshot {
  readonly world: FirstRouteWorld;
  readonly runtime: readonly Runtime[];
  readonly saveState: 'saved' | 'unsaved' | 'saving';
  readonly objective: {
    readonly objectiveVersion: 1;
    readonly achieved: boolean;
    readonly steps: readonly {
      readonly id: string;
      readonly state: 'complete' | 'current' | 'pending';
    }[];
  };
  readonly camera: {
    readonly scrollX: number;
    readonly scrollY: number;
    readonly zoom: number;
    readonly width: number;
    readonly height: number;
  };
}

interface FirstRouteBrowserHarness {
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
  retrySave(): boolean;
}

declare global {
  interface Window {
    __railSimFirstRouteHarness?: FirstRouteBrowserHarness;
  }
}

const facility = (
  state: FirstRouteBrowserSnapshot,
  definitionId: 'managed-forest' | 'sawmill',
): Facility => {
  const result = state.world.economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!result) throw new Error(`Missing ${definitionId}`);
  return result;
};

const train = (state: FirstRouteBrowserSnapshot): Train => {
  if (state.world.trains.length !== 1) {
    throw new Error(`Expected one train, got ${state.world.trains.length}`);
  }
  return state.world.trains[0];
};

const runtime = (state: FirstRouteBrowserSnapshot): Runtime => {
  if (state.runtime.length !== 1) {
    throw new Error(`Expected one runtime, got ${state.runtime.length}`);
  }
  return state.runtime[0];
};

const categoryTotal = (
  state: FirstRouteBrowserSnapshot,
  category: string,
): number => state.world.company.ledger
  .filter((entry) => entry.category === category)
  .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

async function snapshot(page: Page): Promise<FirstRouteBrowserSnapshot> {
  return page.evaluate(() => {
    if (!window.__railSimFirstRouteHarness) {
      throw new Error('First-route browser harness is not available');
    }
    return window.__railSimFirstRouteHarness.snapshot();
  });
}

async function waitForFirstRouteHarness(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'WorldScene'
      && typeof window.__railSimFirstRouteHarness?.snapshot === 'function',
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
  const frozen = await page.evaluate(() => {
    const value = window.__railSimFirstRouteHarness?.snapshot();
    const recursivelyFrozen = (candidate: unknown): boolean => {
      if (candidate === null || typeof candidate !== 'object') return true;
      if (!Object.isFrozen(candidate)) return false;
      return Object.values(candidate as Record<string, unknown>).every(
        recursivelyFrozen,
      );
    };
    return {
      all: recursivelyFrozen(value),
      camera: value ? Object.isFrozen(value.camera) : false,
      runtime: value ? Object.isFrozen(value.runtime) : false,
      world: value ? Object.isFrozen(value.world) : false,
    };
  });
  expect(frozen).toEqual({
    all: true,
    camera: true,
    runtime: true,
    world: true,
  });
}

async function createFixedSeedWorld(
  page: Page,
  seed: string,
  viewport = DESKTOP,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('rail-sim-first-route-cleared') !== 'yes') {
      localStorage.clear();
      sessionStorage.setItem('rail-sim-first-route-cleared', 'yes');
    }
  });
  await page.goto('/');
  // Generated menu preview initialization is outside timed gameplay.
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
    undefined,
    { timeout: 40_000 },
  );
  await page.keyboard.press('Enter');
  await page.locator('canvas').click({
    position: { x: viewport.width / 2, y: viewport.height - 90 },
  });
  page.once('dialog', (dialog) => dialog.accept(seed));
  await page.locator('canvas').click({
    position: { x: viewport.width / 2, y: viewport.height / 2 - 219 },
  });
  await page.locator('canvas').click({
    position: { x: viewport.width / 2, y: viewport.height / 2 + 301 },
  });
  await waitForFirstRouteHarness(page);
  expect((await snapshot(page)).world.generationConfig.seed).toBe(seed);
}

async function openOnlySavedWorld(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__railSimScene === 'MenuScene',
    undefined,
    { timeout: 25_000 },
  );
  await page.keyboard.press('Enter');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await canvas.click({
    position: { x: box.width / 2, y: Math.min(200, box.height / 3) },
  });
  await waitForFirstRouteHarness(page);
}

async function reloadOnlySavedWorld(page: Page): Promise<void> {
  await page.reload();
  await openOnlySavedWorld(page);
  await setMode(page, 'play');
  await expect(page.locator('[data-testid="train-inspector"]')).toBeVisible();
}

async function toScreen(
  page: Page,
  worldPoint: Point,
  state: FirstRouteBrowserSnapshot,
): Promise<Point> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  const internal = worldToCameraPoint(worldPoint, state.camera);
  return {
    x: canvas.x + internal.x * canvas.width / state.camera.width,
    y: canvas.y + internal.y * canvas.height / state.camera.height,
  };
}

async function dragRoute(
  page: Page,
  startScreen: Point,
  endScreen: Point,
): Promise<void> {
  await page.mouse.move(startScreen.x, startScreen.y);
  await page.mouse.down();
  await page.mouse.move(endScreen.x, endScreen.y, { steps: 12 });
  await page.mouse.up();
}

async function buildWitnessCorridor(
  page: Page,
  corridorIndex?: number,
): Promise<FirstRouteBrowserSnapshot> {
  const opening = await snapshot(page);
  expect(opening.world.tracks).toHaveLength(0);
  expect(opening.world.junctions).toHaveLength(0);
  expect(opening.world.stations).toHaveLength(0);
  expect(opening.world.trains).toHaveLength(0);

  const ordered = opening.world.starterOpportunity.corridors
    .map((corridor, index) => ({ corridor, index }))
    .sort((left, right) => left.corridor.estimatedCost
      - right.corridor.estimatedCost
      || left.corridor.id.localeCompare(right.corridor.id));
  const selected = corridorIndex === undefined
    ? ordered[0]
    : ordered.find(({ index }) => index === corridorIndex);
  if (!selected) throw new Error('Missing selected starter corridor');
  expect(selected.index).toBe(ordered[0].index);
  expect(
    selected.corridor.estimatedCost + 90_000 + 20_000,
  ).toBeLessThanOrEqual(opening.world.company.cash);

  await page.keyboard.press('p');
  for (const segment of selected.corridor.feasibilityWitness.segments) {
    const current = await snapshot(page);
    await dragRoute(
      page,
      await toScreen(page, segment.geometry.p0, current),
      await toScreen(page, segment.geometry.p3, current),
    );
    await expect(
      page.locator('[data-testid="construction-confirm"]'),
    ).toBeEnabled();
    await page.locator('[data-testid="construction-confirm"]').click();
    await expect(
      page.locator('[data-testid="company-save-state"]'),
    ).toHaveText('Saved');
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('h');
  await expect(page.locator('canvas')).toHaveCSS('cursor', 'grab');
  await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
    .toBeVisible();

  const built = await snapshot(page);
  expect(
    built.objective.steps.find(({ id }) => id === 'connect-route')?.state,
  ).toBe('complete');
  expect(categoryTotal(built, 'construction-capex')).toBeLessThanOrEqual(
    890_000,
  );
  expect(categoryTotal(built, 'construction-capex')).toBe(
    selected.corridor.estimatedCost,
  );
  expect(
    built.world.tracks.reduce(
      (sum, candidate) => sum + candidate.paidBuildCost,
      0,
    ),
  ).toBe(categoryTotal(built, 'construction-capex'));
  return built;
}

const endpointNearest = (
  state: FirstRouteBrowserSnapshot,
  target: Point,
): { track: Track; point: Point } => {
  const result = state.world.tracks.flatMap((candidate) => [
    { track: candidate, point: candidate.p0 },
    { track: candidate, point: candidate.p3 },
  ]).sort((left, right) => (
    Math.hypot(left.point.x - target.x, left.point.y - target.y)
    - Math.hypot(right.point.x - target.x, right.point.y - target.y)
    || left.track.uuid.localeCompare(right.track.uuid)
  ))[0];
  if (!result) throw new Error('No route endpoint');
  return result;
};

const bezierPoint = (track: Track, t: number): Point => {
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

const tangentAt = (track: Track, t: number): Point => {
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

const keyToward = (
  state: FirstRouteBrowserSnapshot,
  live: Runtime,
  target: Point,
): 'w' | 's' => {
  const track = state.world.tracks.find(
    ({ uuid }) => uuid === live.trackUUID,
  );
  if (!track || live.trackT === null) return 'w';
  const tangent = tangentAt(track, live.trackT);
  const forwardDot = live.facing * (
    tangent.x * (target.x - live.x)
    + tangent.y * (target.y - live.y)
  );
  return forwardDot >= 0 ? 'w' : 's';
};

const oppositeKey = (key: 'w' | 's'): 'w' | 's' =>
  key === 'w' ? 's' : 'w';

const placementInsideAccess = (
  state: FirstRouteBrowserSnapshot,
  access: Point & { readonly radius: number },
): { track: Track; point: Point; trackT: number } => {
  const candidates = state.world.tracks.flatMap((candidate) => {
    const points: Array<{ track: Track; point: Point; trackT: number }> = [];
    for (let step = 0; step <= 50; step += 1) {
      const trackT = step / 50;
      const point = bezierPoint(candidate, trackT);
      const distance = Math.hypot(
        point.x - access.x,
        point.y - access.y,
      );
      if (distance >= access.radius * 0.45
        && distance <= access.radius * 0.85) {
        points.push({ track: candidate, point, trackT });
      }
    }
    return points;
  }).sort((left, right) => {
    const leftDistance = Math.hypot(
      left.point.x - access.x,
      left.point.y - access.y,
    );
    const rightDistance = Math.hypot(
      right.point.x - access.x,
      right.point.y - access.y,
    );
    return rightDistance - leftDistance
      || left.track.uuid.localeCompare(right.track.uuid)
      || left.trackT - right.trackT;
  });
  const result = candidates[0];
  if (!result) throw new Error('No track placement inside rail access');
  return result;
};

async function purchaseTimberSetAtForest(
  page: Page,
): Promise<FirstRouteBrowserSnapshot> {
  const before = await snapshot(page);
  const cashBefore = before.world.company.cash;
  const forest = facility(before, 'managed-forest');
  const sawmill = facility(before, 'sawmill');
  const placement = placementInsideAccess(before, forest.railAccess);
  expect(
    Math.hypot(
      placement.point.x - forest.railAccess.x,
      placement.point.y - forest.railAccess.y,
    ),
  ).toBeLessThanOrEqual(forest.railAccess.radius);

  await page.locator('[data-testid="flatbed-freight-set-buy"]').click();
  const state = await snapshot(page);
  const screen = await toScreen(page, placement.point, state);
  await page.mouse.click(screen.x, screen.y);
  const confirm = page.locator('[data-testid="freight-purchase-confirm"]');
  await expect(
    page.locator('[data-testid="vehicle-purchase-panel"]'),
  ).toContainText('£90,000');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await page.waitForFunction(
    () => window.__railSimFirstRouteHarness?.snapshot().world.trains.length === 1
      && window.__railSimFirstRouteHarness.snapshot().runtime.length === 1,
  );

  const purchased = await snapshot(page);
  expect(purchased.world.company.cash).toBe(cashBefore - 90_000);
  expect(categoryTotal(purchased, 'vehicle-capex')).toBe(90_000);
  expect(train(purchased).trackUUID).toBe(placement.track.uuid);
  expect(train(purchased).trackT).toBeCloseTo(placement.trackT, 2);
  const track = purchased.world.tracks.find(
    ({ uuid }) => uuid === train(purchased).trackUUID,
  );
  if (!track) throw new Error('Purchased train track is absent');
  const tangent = train(purchased).trackT <= 0.5
    ? {
      x: track.p1.x - track.p0.x,
      y: track.p1.y - track.p0.y,
    }
    : {
      x: track.p3.x - track.p2.x,
      y: track.p3.y - track.p2.y,
    };
  const trainPoint = bezierPoint(track, train(purchased).trackT);
  const towardSawmill = {
    x: sawmill.railAccess.x - trainPoint.x,
    y: sawmill.railAccess.y - trainPoint.y,
  };
  expect(
    train(purchased).facing
      * (tangent.x * towardSawmill.x + tangent.y * towardSawmill.y),
  ).toBeGreaterThan(0);
  return purchased;
}

async function setMode(page: Page, mode: 'create' | 'play'): Promise<void> {
  await page.evaluate((nextMode) => {
    window.__railSimFirstRouteHarness?.setMode(nextMode);
  }, mode);
}

async function setTrainRuntime(
  page: Page,
  trainId: string,
  values: Pick<
    Runtime,
    'x' | 'y' | 'speedWorldUnitsPerSecond' | 'throttle' | 'derailed'
  >,
): Promise<void> {
  await page.evaluate(({ id, runtimeValues }) => {
    window.__railSimFirstRouteHarness?.setTrainRuntime(id, runtimeValues);
  }, { id: trainId, runtimeValues: values });
}

async function advanceFixedTicks(page: Page, count: number): Promise<void> {
  await page.evaluate((ticks) => {
    window.__railSimFirstRouteHarness?.advanceFixedTicks(ticks);
  }, count);
}

const stoppedAt = (
  state: FirstRouteBrowserSnapshot,
  definitionId: 'managed-forest' | 'sawmill',
) => {
  const access = facility(state, definitionId).railAccess;
  const endpoint = endpointNearest(state, access);
  return {
    x: endpoint.point.x,
    y: endpoint.point.y,
    speedWorldUnitsPerSecond: 0,
    throttle: 0 as const,
    derailed: false,
  };
};

const movingMidRoute = (state: FirstRouteBrowserSnapshot) => {
  const middleTrack = state.world.tracks[
    Math.floor(state.world.tracks.length / 2)
  ];
  if (!middleTrack) throw new Error('No middle route track');
  return {
    ...bezierPoint(middleTrack, 0.5),
    speedWorldUnitsPerSecond: 12,
    throttle: 1 as const,
    derailed: false,
  };
};

const stoppedOutsideFacilityAccess = (
  state: FirstRouteBrowserSnapshot,
) => {
  const forestAccess = facility(state, 'managed-forest').railAccess;
  const sawmillAccess = facility(state, 'sawmill').railAccess;
  const candidates = state.world.tracks.flatMap((track) =>
    Array.from({ length: 21 }, (_, index) => {
      const trackT = index / 20;
      const point = bezierPoint(track, trackT);
      const forestDistance = Math.hypot(
        point.x - forestAccess.x,
        point.y - forestAccess.y,
      );
      const sawmillDistance = Math.hypot(
        point.x - sawmillAccess.x,
        point.y - sawmillAccess.y,
      );
      const clearance = Math.min(
        ...state.world.economy.facilities.map(({ railAccess }) =>
          Math.hypot(
            point.x - railAccess.x,
            point.y - railAccess.y,
          ) - railAccess.radius),
      );
      return {
        point,
        clearance,
        forestDistance,
        sawmillDistance,
        trackUUID: track.uuid,
        trackT,
      };
    }),
  ).filter(({ clearance, forestDistance, sawmillDistance }) =>
    clearance > 0 && sawmillDistance < forestDistance)
    .sort((left, right) => right.clearance - left.clearance
      || left.trackUUID.localeCompare(right.trackUUID)
      || left.trackT - right.trackT);
  const selected = candidates[0];
  if (!selected) {
    throw new Error('No route point exists outside every facility access');
  }
  return {
    ...selected.point,
    speedWorldUnitsPerSecond: 0,
    throttle: 0 as const,
    derailed: false,
  };
};

const persistedPhase = (state: FirstRouteBrowserSnapshot) => ({
  cash: state.world.company.cash,
  ledger: state.world.company.ledger,
  economy: state.world.economy,
  progress: state.world.freightProgress,
  trains: state.world.trains,
});

const multiplyBps = (value: number, basisPoints: number): number =>
  Math.round(value * basisPoints / 10_000);

const expectedLogBatchRevenue = (
  state: FirstRouteBrowserSnapshot,
): number => {
  const slot = facility(state, 'sawmill').inventories.logs;
  const pressure = Math.max(
    7_500,
    Math.min(
      13_000,
      10_000 + Math.round(
        ((slot.targetStock - slot.quantity) * 3_000) / slot.targetStock,
      ),
    ),
  );
  const construction = state.world.economy.market.constructionIndexBps;
  const regional =
    state.world.economy.market.regionalDemandBpsByProduct.logs;
  const unitPrice = multiplyBps(
    multiplyBps(multiplyBps(90, construction), regional),
    pressure,
  );
  return unitPrice * 10;
};

test.describe('collective three-seed first freight route acceptance', () => {
  test('desktop seed completes one actual-keyboard profitable trip in 2–4 minutes', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await createFixedSeedWorld(page, REAL_TIME_SEED);
    await buildWitnessCorridor(page);
    const purchaseStarted = await page.evaluate(() => performance.now());
    await purchaseTimberSetAtForest(page);
    await setMode(page, 'play');
    await expect(page.locator('[data-testid="train-inspector"]')).toBeVisible();

    await expect(page.locator('[data-testid="train-cargo-progress"]')).toHaveAttribute(
      'value',
      '60',
      { timeout: 20_000 },
    );
    const loaded = await snapshot(page);
    expect(train(loaded).cargo).toEqual(expect.objectContaining({
      productId: 'logs',
      units: 60,
    }));
    const sawmill = facility(loaded, 'sawmill');
    const selectedTrainScreen = await toScreen(
      page,
      { x: runtime(loaded).x, y: runtime(loaded).y },
      loaded,
    );
    await page.mouse.click(selectedTrainScreen.x, selectedTrainScreen.y);
    await expect(page.locator('[data-testid="train-inspector"]')).toBeVisible();

    let heldKey: 'w' | 's' | null = null;
    const setHeldKey = async (next: 'w' | 's' | null): Promise<void> => {
      if (next === heldKey) return;
      if (heldKey) await page.keyboard.up(heldKey);
      heldKey = next;
      if (heldKey) await page.keyboard.down(heldKey);
    };
    const pulse = async (
      key: 'w' | 's',
      duration = 20,
    ): Promise<void> => {
      await setHeldKey(null);
      await page.keyboard.down(key);
      await page.waitForTimeout(duration);
      await page.keyboard.up(key);
    };
    let previousDistance = Math.hypot(
      runtime(loaded).x - sawmill.railAccess.x,
      runtime(loaded).y - sawmill.railAccess.y,
    );
    let motion: 'approaching' | 'receding' | 'stationary' = 'stationary';
    let unloadingStarted = false;
    let firstInsideTick: number | null = null;
    let firstUnloadTick: number | null = null;
    const recentRuntime: Array<{
      elapsedSeconds: number;
      economyTick: number;
      cargoUnits: number;
      distance: number;
      speed: number;
      motion: typeof motion;
      throttle: -1 | 0 | 1;
      trackUUID: string | null;
      trackT: number | null;
      x: number;
      y: number;
    }> = [];
    try {
      try {
        await expect.poll(async () => {
          const current = await snapshot(page);
          const live = runtime(current);
          const cargoUnits = train(current).cargo?.units ?? 0;
          const distance = Math.hypot(
            live.x - sawmill.railAccess.x,
            live.y - sawmill.railAccess.y,
          );
          const distanceDelta = distance - previousDistance;
          if (Math.abs(distanceDelta) >= 0.5) {
            motion = distanceDelta < 0 ? 'approaching' : 'receding';
          } else if (live.speedWorldUnitsPerSecond <= 2) {
            motion = 'stationary';
          }
          previousDistance = distance;
          if (distance <= sawmill.railAccess.radius
            && firstInsideTick === null) {
            firstInsideTick = current.world.economy.tick;
          }
          if (cargoUnits < 60 && firstUnloadTick === null) {
            firstUnloadTick = current.world.economy.tick;
          }
          unloadingStarted ||= cargoUnits < 60;
          const elapsedSeconds = (
            await page.evaluate(() => performance.now()) - purchaseStarted
          ) / 1_000;
          recentRuntime.push({
            elapsedSeconds,
            economyTick: current.world.economy.tick,
            cargoUnits,
            distance,
            speed: live.speedWorldUnitsPerSecond,
            motion,
            throttle: live.throttle,
            trackUUID: live.trackUUID,
            trackT: live.trackT,
            x: live.x,
            y: live.y,
          });
          if (recentRuntime.length > 8) recentRuntime.shift();
          if (live.derailed) {
            const endpoints = loaded.world.tracks.map((track) => ({
              uuid: track.uuid,
              p0: track.p0,
              p3: track.p3,
            }));
            throw new Error(JSON.stringify({
              recentRuntime,
              endpoints,
              sawmill: sawmill.railAccess,
            }));
          }
          const propulsionKey = keyToward(
            current,
            live,
            sawmill.railAccess,
          );
          if (unloadingStarted) {
            await setHeldKey(null);
          } else if (distance <= sawmill.railAccess.radius) {
            await setHeldKey(null);
            if (live.speedWorldUnitsPerSecond > 2) {
              const brakingKey = motion === 'receding'
                ? propulsionKey
                : oppositeKey(propulsionKey);
              await pulse(
                brakingKey,
                live.speedWorldUnitsPerSecond > 20 ? 60 : 20,
              );
            }
          } else if (distance <= sawmill.railAccess.radius * 2) {
            await setHeldKey(null);
            if (motion === 'receding') {
              await pulse(propulsionKey, 20);
            } else if (live.speedWorldUnitsPerSecond > 28) {
              await pulse(oppositeKey(propulsionKey), 20);
            } else if (live.speedWorldUnitsPerSecond < 24) {
              await pulse(propulsionKey, 20);
            }
          } else if (motion === 'receding') {
            await setHeldKey(propulsionKey);
          } else {
            await setHeldKey(null);
            if (live.speedWorldUnitsPerSecond < 34) {
              await pulse(propulsionKey, 60);
            } else if (live.speedWorldUnitsPerSecond > 42) {
              await pulse(oppositeKey(propulsionKey), 60);
            }
          }
          return {
            inside: distance <= sawmill.railAccess.radius,
            stopped: live.speedWorldUnitsPerSecond <= 2,
            empty: train(current).cargo === null,
          };
        }, {
          timeout: 235_000,
          intervals: [50, 75, 100, 150],
        }).toEqual({ inside: true, stopped: true, empty: true });
      } catch (error) {
        const finalState = await snapshot(page);
        const finalRuntime = runtime(finalState);
        const transferStatus = await page
          .locator('[data-testid="train-transfer-status"]')
          .textContent()
          .catch(() => null);
        throw new Error(JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          trainId: train(finalState).id,
          firstInsideTick,
          firstUnloadTick,
          transferStatus,
          final: {
            economyTick: finalState.world.economy.tick,
            cargoUnits: train(finalState).cargo?.units ?? 0,
            distance: Math.hypot(
              finalRuntime.x - sawmill.railAccess.x,
              finalRuntime.y - sawmill.railAccess.y,
            ),
            speed: finalRuntime.speedWorldUnitsPerSecond,
            throttle: finalRuntime.throttle,
            trackUUID: finalRuntime.trackUUID,
            trackT: finalRuntime.trackT,
          },
          recentRuntime,
        }));
      }
    } finally {
      await page.keyboard.up('w');
      await page.keyboard.up('s');
    }

    const completedAt = await page.evaluate(() => performance.now());
    const elapsedSeconds = (completedAt - purchaseStarted) / 1_000;
    const completed = await snapshot(page);
    console.info(
      `[first-route] purchase-to-unload=${elapsedSeconds.toFixed(3)}s`
      + ` revenue=${train(completed).operations.lastTripRevenue}`
      + ` running=${train(completed).operations.lastTripRunningCost}`,
    );
    expect(elapsedSeconds).toBeGreaterThanOrEqual(120);
    expect(elapsedSeconds).toBeLessThanOrEqual(240);
    expect(runtime(completed)).toEqual(expect.objectContaining({
      throttle: 0,
      derailed: false,
    }));
    expect(train(completed).operations.lastTripRevenue).toBeGreaterThan(
      train(completed).operations.lastTripRunningCost,
    );
    expect(completed.objective).toEqual(expect.objectContaining({
      id: 'structural-timber-link',
      achieved: false,
    }));
    const objective = page.locator('[data-testid="freight-objective"]');
    await expect(objective).toHaveAttribute(
      'data-objective',
      'structural-timber-link',
    );
    await expect(objective).toContainText('Extend the timber chain');
    await expect(
      page.locator('[data-testid="company-delivery-revenue"]'),
    ).toContainText(/Deliveries £[1-9]/);
    await expect(
      page.locator('[data-testid="company-contract-bonuses"]'),
    ).toContainText('Development £250,000');
    await expect(
      page.locator('[data-testid="company-operating-profit"]'),
    ).toContainText(/Rail profit £[1-9]/);
  });

  test('controlled seed proves exact transfers, four reload phases, and three cycles', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await createFixedSeedWorld(page, CONTROLLED_SEED);
    await buildWitnessCorridor(page);
    await purchaseTimberSetAtForest(page);
    await setMode(page, 'play');
    await expect(page.locator('[data-testid="train-inspector"]')).toBeVisible();
    let current = await snapshot(page);
    const trainId = train(current).id;

    await setTrainRuntime(page, trainId, stoppedAt(current, 'managed-forest'));
    await advanceFixedTicks(page, 3);
    current = await snapshot(page);
    expect(train(current).cargo?.units).toBe(30);
    let expected = persistedPhase(current);
    await reloadOnlySavedWorld(page);
    expect(persistedPhase(await snapshot(page))).toEqual(expected);

    current = await snapshot(page);
    await test.step('moving inside Managed Forest access does not load', async () => {
      await setTrainRuntime(page, trainId, {
        ...stoppedAt(current, 'managed-forest'),
        speedWorldUnitsPerSecond: 12,
        throttle: 1,
      });
      const beforeMovingTick = await snapshot(page);
      const forestAccess = facility(beforeMovingTick, 'managed-forest').railAccess;
      expect(Math.hypot(
        runtime(beforeMovingTick).x - forestAccess.x,
        runtime(beforeMovingTick).y - forestAccess.y,
      )).toBeLessThanOrEqual(forestAccess.radius);
      expect(runtime(beforeMovingTick).speedWorldUnitsPerSecond).toBeGreaterThan(2);
      expect(runtime(beforeMovingTick)).toEqual(expect.objectContaining({
        throttle: 1,
        derailed: false,
      }));
      expect(train(beforeMovingTick).cargo?.units).toBe(30);
      expect(facility(beforeMovingTick, 'managed-forest').inventories.logs.quantity)
        .toBeGreaterThanOrEqual(10);

      await advanceFixedTicks(page, 1);
      await expect(page.locator('[data-testid="train-transfer-status"]'))
        .toHaveText('Stop the train to transfer cargo');
      current = await snapshot(page);
      expect(train(current).cargo).toEqual(train(beforeMovingTick).cargo);
      expect(categoryTotal(current, 'delivery-revenue'))
        .toBe(categoryTotal(beforeMovingTick, 'delivery-revenue'));
      expect(
        train(current).operations.currentTripRunningCost
        - train(beforeMovingTick).operations.currentTripRunningCost,
      ).toBe(20);
    });

    await test.step('stopped outside Sawmill access does not transfer', async () => {
      await setTrainRuntime(
        page,
        trainId,
        stoppedOutsideFacilityAccess(current),
      );
      const beforeOutsideTick = await snapshot(page);
      const sawmillAccess = facility(beforeOutsideTick, 'sawmill').railAccess;
      expect(Math.hypot(
        runtime(beforeOutsideTick).x - sawmillAccess.x,
        runtime(beforeOutsideTick).y - sawmillAccess.y,
      )).toBeGreaterThan(sawmillAccess.radius);
      expect(runtime(beforeOutsideTick)).toEqual(expect.objectContaining({
        speedWorldUnitsPerSecond: 0,
        throttle: 0,
        derailed: false,
      }));
      expect(train(beforeOutsideTick).cargo?.units).toBe(30);
      const forestAccess =
        facility(beforeOutsideTick, 'managed-forest').railAccess;
      expect(Math.hypot(
        runtime(beforeOutsideTick).x - sawmillAccess.x,
        runtime(beforeOutsideTick).y - sawmillAccess.y,
      )).toBeLessThan(Math.hypot(
        runtime(beforeOutsideTick).x - forestAccess.x,
        runtime(beforeOutsideTick).y - forestAccess.y,
      ));
      for (const candidate of beforeOutsideTick.world.economy.facilities) {
        expect(Math.hypot(
          runtime(beforeOutsideTick).x - candidate.railAccess.x,
          runtime(beforeOutsideTick).y - candidate.railAccess.y,
        )).toBeGreaterThan(candidate.railAccess.radius);
      }
      expect(
        facility(beforeOutsideTick, 'sawmill').inventories.logs.capacity
        - facility(beforeOutsideTick, 'sawmill').inventories.logs.quantity,
      ).toBeGreaterThanOrEqual(10);

      await advanceFixedTicks(page, 1);
      await expect(page.locator('[data-testid="train-transfer-status"]'))
        .toHaveText('Move inside Sawmill rail access');
      current = await snapshot(page);
      expect(train(current).cargo).toEqual(train(beforeOutsideTick).cargo);
      expect(categoryTotal(current, 'delivery-revenue'))
        .toBe(categoryTotal(beforeOutsideTick, 'delivery-revenue'));
      expect(train(current).operations.currentTripRevenue)
        .toBe(train(beforeOutsideTick).operations.currentTripRevenue);
    });

    await setTrainRuntime(page, trainId, stoppedAt(current, 'managed-forest'));
    await advanceFixedTicks(page, 3);
    current = await snapshot(page);
    expect(train(current).cargo?.units).toBe(60);
    expected = persistedPhase(current);
    await reloadOnlySavedWorld(page);
    expect(persistedPhase(await snapshot(page))).toEqual(expected);

    current = await snapshot(page);
    await setTrainRuntime(page, trainId, stoppedAt(current, 'sawmill'));
    const firstUnloadBefore = await snapshot(page);
    const sawmillAccess = facility(firstUnloadBefore, 'sawmill').railAccess;
    expect(Math.hypot(
      runtime(firstUnloadBefore).x - sawmillAccess.x,
      runtime(firstUnloadBefore).y - sawmillAccess.y,
    )).toBeLessThanOrEqual(sawmillAccess.radius);
    expect(runtime(firstUnloadBefore)).toEqual(expect.objectContaining({
      trackUUID: expect.any(String),
      speedWorldUnitsPerSecond: 0,
      throttle: 0,
      derailed: false,
    }));
    expect(facility(firstUnloadBefore, 'sawmill').recipeProgressTicks).toBe(0);
    const expectedFirstRevenue = expectedLogBatchRevenue(firstUnloadBefore);
    await advanceFixedTicks(page, 1);
    current = await snapshot(page);
    expect(train(current).cargo?.units).toBe(50);
    expect(facility(current, 'sawmill').recipeProgressTicks).toBe(1);
    expect(
      categoryTotal(current, 'delivery-revenue')
      - categoryTotal(firstUnloadBefore, 'delivery-revenue'),
    ).toBe(expectedFirstRevenue);
    expect(
      current.world.company.cash - firstUnloadBefore.world.company.cash,
    ).toBe(expectedFirstRevenue);

    await advanceFixedTicks(page, 2);
    current = await snapshot(page);
    expect(train(current).cargo?.units).toBe(30);
    expect(facility(current, 'sawmill').recipeProgressTicks).toBe(0);
    expect(facility(current, 'sawmill').inventories.logs.recentOutflow)
      .toBeGreaterThan(0);
    expected = persistedPhase(current);
    await reloadOnlySavedWorld(page);
    expect(persistedPhase(await snapshot(page))).toEqual(expected);

    current = await snapshot(page);
    await setTrainRuntime(page, trainId, stoppedAt(current, 'sawmill'));
    await advanceFixedTicks(page, 2);
    const finalUnloadBefore = await snapshot(page);
    expect(train(finalUnloadBefore).cargo?.units).toBe(10);
    const expectedFinalRevenue = expectedLogBatchRevenue(finalUnloadBefore);
    const bonusesBefore = categoryTotal(
      finalUnloadBefore,
      'contract-bonus',
    );
    await advanceFixedTicks(page, 1);
    current = await snapshot(page);
    expect(train(current).cargo).toBeNull();
    expect(
      categoryTotal(current, 'delivery-revenue')
      - categoryTotal(finalUnloadBefore, 'delivery-revenue'),
    ).toBe(expectedFinalRevenue);
    expect(
      current.world.company.cash - finalUnloadBefore.world.company.cash,
    ).toBe(expectedFinalRevenue + DEVELOPMENT_GRANT);
    expect(
      categoryTotal(current, 'contract-bonus') - bonusesBefore,
    ).toBe(DEVELOPMENT_GRANT);
    expect(current.world.company.ledger.filter(
      ({ referenceId }) =>
        referenceId === DEVELOPMENT_GRANT_REFERENCE,
    )).toHaveLength(1);
    expect(train(current).operations.lastTripRevenue).toBeGreaterThan(
      train(current).operations.lastTripRunningCost,
    );
    expect(facility(current, 'sawmill').inventories.logs.recentOutflow)
      .toBeGreaterThan(0);
    expect(facility(current, 'sawmill').recipeProgressTicks).toBe(0);
    expected = persistedPhase(current);
    await reloadOnlySavedWorld(page);
    expect(persistedPhase(await snapshot(page))).toEqual(expected);

    for (let cycle = 2; cycle <= 3; cycle += 1) {
      current = await snapshot(page);
      while (facility(current, 'managed-forest').inventories.logs.quantity < 60) {
        await setTrainRuntime(
          page,
          trainId,
          stoppedOutsideFacilityAccess(current),
        );
        await advanceFixedTicks(page, 1);
        current = await snapshot(page);
      }
      expect(train(current).cargo).toBeNull();
      await setTrainRuntime(page, trainId, stoppedAt(current, 'managed-forest'));
      await advanceFixedTicks(page, 6);
      current = await snapshot(page);
      expect(train(current).cargo?.units).toBe(60);
      await setTrainRuntime(page, trainId, movingMidRoute(current));
      await advanceFixedTicks(page, 1);
      current = await snapshot(page);
      await setTrainRuntime(page, trainId, stoppedAt(current, 'sawmill'));
      await advanceFixedTicks(page, 6);
      current = await snapshot(page);
      expect(train(current).cargo).toBeNull();
      expect(train(current).operations.lifetimeDeliveredUnits).toBe(cycle * 60);
      expect(train(current).operations.lifetimeRunningCost).toBe(cycle * 20);
      await reloadOnlySavedWorld(page);
    }
  });

  test('mobile seed retains cargo through derail/re-rail and keeps controls input-safe', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await createFixedSeedWorld(page, MOBILE_SEED);
    await buildWitnessCorridor(page);
    await purchaseTimberSetAtForest(page);
    await setMode(page, 'play');
    await expect(page.locator('[data-testid="train-inspector"]')).toBeVisible();
    let current = await snapshot(page);
    const trainId = train(current).id;
    await setTrainRuntime(page, trainId, stoppedAt(current, 'managed-forest'));
    await advanceFixedTicks(page, 1);
    current = await snapshot(page);
    expect(train(current).cargo?.units).toBe(10);

    const cargoBeforeDerail = train(current).cargo;
    const nearTrack = runtime(current);
    await setTrainRuntime(page, trainId, {
      x: nearTrack.x + 60,
      y: nearTrack.y + 60,
      speedWorldUnitsPerSecond: 0,
      throttle: 0,
      derailed: true,
    });
    await advanceFixedTicks(page, 1);
    current = await snapshot(page);
    expect(runtime(current).derailed).toBe(true);
    expect(train(current).cargo).toEqual(cargoBeforeDerail);

    const forestStop = stoppedAt(current, 'managed-forest');
    await setTrainRuntime(page, trainId, forestStop);
    await advanceFixedTicks(page, 1);
    current = await snapshot(page);
    expect(runtime(current).derailed).toBe(false);
    expect(train(current).cargo?.units).toBe(20);

    await page.setViewportSize(MOBILE);
    const inspector = page.locator('[data-testid="train-inspector"]');
    const objective = page.locator('[data-testid="freight-objective"]');
    const company = page.locator('[data-testid="company-hud"]');
    await expect(inspector).toHaveAttribute('data-layout', 'mobile');
    await expect(objective).toHaveAttribute('data-layout', 'mobile');
    await expect(company).toHaveAttribute('data-layout', 'mobile');
    for (const panel of [inspector, objective, company]) {
      await expect(panel).toBeVisible();
      const bounds = await panel.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect(bounds?.y).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0))
        .toBeLessThanOrEqual(MOBILE.width);
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0))
        .toBeLessThanOrEqual(MOBILE.height);
    }
    const inspectorBounds = await inspector.boundingBox();
    if (!inspectorBounds) throw new Error('Train inspector has no mobile bounds');
    for (const selector of [
      '[data-throttle="-1"]',
      '[data-throttle="0"]',
      '[data-throttle="1"]',
    ]) {
      const control = inspector.locator(selector);
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect(bounds?.y).toBeGreaterThanOrEqual(inspectorBounds.y);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
        MOBILE.width,
      );
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
        Math.min(MOBILE.height, inspectorBounds.y + inspectorBounds.height),
      );
      await control.click();
    }
    await inspector.locator('[data-throttle="0"]').click();
    expect(train(await snapshot(page)).cargo?.units).toBe(20);
  });
});
