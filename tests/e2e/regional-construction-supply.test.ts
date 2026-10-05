import { createLegacyWorld } from './helpers/CreateLegacyWorld';
import { writeFile } from 'node:fs/promises';
import {
  expect,
  test,
  type Page,
  type TestInfo,
  type ViewportSize,
} from '@playwright/test';
import type { FirstRouteBrowserSnapshot } from '../../src/scenes/WorldScene';
import {
  resolvePrefabricationExtensionStart,
} from '../../src/economy/PrefabricationOpportunity';
import { quoteLocalProduct } from '../../src/economy/MarketSystem';
import { queryRailAccessConnectivity } from '../../src/freight/RailAccessConnectivity';
import type { ConstructionPreviewModel } from '../../src/ui/ConstructionPreviewOverlay';

const PRIMARY_SEED = 'playtest-825';
const DESKTOP = { width: 1920, height: 1400 };
const MOBILE = { width: 375, height: 667 };
const CASH = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

interface Point {
  readonly x: number;
  readonly y: number;
}

interface PortParkingTail {
  readonly portTrackUUID: string;
  readonly portCost: number;
  readonly tailTrackUUIDs: readonly [string, string];
  readonly nearParkingPoint: Point;
  readonly farParkingPoint: Point;
}

interface RegionalBrowserSnapshot extends FirstRouteBrowserSnapshot {
  readonly construction: FirstRouteBrowserSnapshot['construction'] & {
    readonly preview: ConstructionPreviewModel | null;
  };
}

type Facility =
  RegionalBrowserSnapshot['world']['economy']['facilities'][number];
type Train = RegionalBrowserSnapshot['world']['trains'][number];
type Runtime = RegionalBrowserSnapshot['runtime'][number];

const snapshot = async (page: Page): Promise<RegionalBrowserSnapshot> =>
  page.evaluate(() => {
    const harness = window.__railSimFirstRouteHarness;
    if (!harness) throw new Error('Regional browser harness is unavailable');
    return harness.snapshot() as RegionalBrowserSnapshot;
  });

const facility = (
  state: RegionalBrowserSnapshot,
  definitionId: string,
): Facility => {
  const result = state.world.economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!result) throw new Error(`Missing ${definitionId}`);
  return result;
};

const trainById = (
  state: RegionalBrowserSnapshot,
  trainId: string,
): Train => {
  const result = state.world.trains.find(({ id }) => id === trainId);
  if (!result) throw new Error(`Missing ${trainId}`);
  return result;
};

const runtimeById = (
  state: RegionalBrowserSnapshot,
  trainId: string,
): Runtime => {
  const result = state.runtime.find(({ trainId: id }) => id === trainId);
  if (!result) throw new Error(`Missing runtime ${trainId}`);
  return result;
};

const distanceTo = (left: Point, right: Point): number =>
  Math.hypot(left.x - right.x, left.y - right.y);

// Phaser floors Playwright's screen pointer to integer pixels.
const pointerWorldTolerance = (zoom: number): number =>
  Math.SQRT2 / zoom + 0.25;

const categoryMagnitude = (
  state: RegionalBrowserSnapshot,
  category: string,
): number => state.world.company.ledger
  .filter((entry) => entry.category === category)
  .reduce((total, entry) => total + Math.abs(entry.amount), 0);

const assertModuleProductionConservation = (
  state: RegionalBrowserSnapshot,
  opening: Facility,
  deliveredSteelUnits: number,
  expectedBatches: number,
): void => {
  const current = facility(state, 'prefabrication-plant');
  const timberConsumed = opening.inventories['structural-timber'].quantity
    - current.inventories['structural-timber'].quantity;
  const completedBatches = timberConsumed / 8;
  expect(Number.isSafeInteger(completedBatches)).toBe(true);
  expect(completedBatches).toBe(expectedBatches);
  expect(opening.inventories.cement.quantity
    - current.inventories.cement.quantity).toBe(completedBatches * 8);
  expect(opening.inventories.steel.quantity + deliveredSteelUnits
    - current.inventories.steel.quantity).toBe(completedBatches * 6);
  const storedModules = state.world.economy.facilities.reduce(
    (total, candidate) => total
      + (candidate.inventories['building-modules']?.quantity ?? 0),
    0,
  );
  const carriedModules = state.world.trains.reduce(
    (total, train) => total
      + (train.cargo?.productId === 'building-modules' ? train.cargo.units : 0),
    0,
  );
  expect(storedModules + carriedModules).toBe(completedBatches * 4);
};

const stableWorld = (
  world: RegionalBrowserSnapshot['world'],
): RegionalBrowserSnapshot['world'] => ({
  ...world,
  metadata: {
    ...world.metadata,
    updatedAt: 0,
  },
});

const REGIONAL_STEP_LABELS = {
  'connect-port': 'Connect Port Interchange',
  'deliver-steel-profitably': 'Deliver Steel profitably',
  'assemble-building-modules': 'Assemble Building Modules',
  'connect-town': 'Connect Town Construction Market',
  'deliver-building-modules-profitably':
    'Deliver Building Modules profitably',
} as const;

type RegionalStepId = keyof typeof REGIONAL_STEP_LABELS;
type ObjectiveStepState = 'complete' | 'current' | 'pending';

async function expectRegionalObjectiveDom(
  page: Page,
  status: 'Supply regional construction'
    | 'Regional construction supplied · Network ready to automate',
  states: Readonly<Record<RegionalStepId, ObjectiveStepState>>,
): Promise<void> {
  const card = page.locator('[data-testid="freight-objective"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute(
    'data-objective',
    'regional-construction-supply',
  );
  await expect(card.locator(':scope > strong')).toHaveText(status);
  await expect(card.locator('[data-step]')).toHaveCount(5);
  let currentCount = 0;
  for (const [id, label] of Object.entries(REGIONAL_STEP_LABELS) as Array<
    [RegionalStepId, string]
  >) {
    const state = states[id];
    const prefix = state === 'complete'
      ? 'Complete'
      : state === 'current'
        ? 'Current'
        : 'Pending';
    const item = card.locator(`[data-step="${id}"]`);
    await expect(item).toHaveText(`${prefix}: ${label}`);
    if (state === 'current') {
      currentCount += 1;
      await expect(item).toHaveAttribute('aria-current', 'step');
    } else {
      await expect(item).not.toHaveAttribute('aria-current', 'step');
    }
  }
  await expect(card.locator('[aria-current="step"]'))
    .toHaveCount(currentCount);
}

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

async function waitForRenderedFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function waitForHarness(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__railSimScene === 'WorldScene'
      && typeof window.__railSimFirstRouteHarness?.snapshot === 'function',
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
}

async function createFixedSeedWorld(
  page: Page,
  seed: string,
  viewport: ViewportSize = DESKTOP,
): Promise<RegionalBrowserSnapshot> {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__railSimE2EStorageInitialised') === 'true') {
      return;
    }
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('__railSimE2EStorageInitialised', 'true');
  });
  await page.goto('/');
  await page.waitForFunction(
    () => window.__railSimScene === 'MenuScene',
    undefined,
    { timeout: 120_000 },
  );
  await page.keyboard.press('Enter');
  await createLegacyWorld(page, seed);
  await waitForHarness(page);

  const created = await snapshot(page);
  expect(created.world.schemaVersion).toBe(11);
  expect(created.world.generationConfig.seed).toBe(seed);
  expect(created.world.economy.facilities).toHaveLength(7);
  expect(created.world.tracks).toHaveLength(0);
  expect(created.world.junctions).toHaveLength(0);
  expect(created.world.stations).toHaveLength(0);
  expect(created.world.trains).toHaveLength(0);
  return created;
}

async function toPagePoint(
  page: Page,
  point: Point,
  _state: RegionalBrowserSnapshot,
): Promise<Point> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  const internal = await worldToCameraPoint(page, point);
  const state = await snapshot(page);
  return {
    x: canvas.x + internal.x * canvas.width / state.camera.width,
    y: canvas.y + internal.y * canvas.height / state.camera.height,
  };
}

async function panWorldPointToCentre(
  page: Page,
  target: Point,
  desiredPoint?: Point,
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
    const desired = desiredPoint ?? {
      x: state.camera.width / 2,
      y: state.camera.height * 0.54,
    };
    const dx = desired.x - internal.x;
    const dy = desired.y - internal.y;
    if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) return;
    if (!desiredPoint
      && internal.x >= 380
      && internal.x <= state.camera.width - 360
      && internal.y >= 100
      && internal.y <= state.camera.height - 130) return;
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

async function fitLink(
  page: Page,
  start: Point,
  end: Point,
): Promise<void> {
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
    ))) return;
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
    const recent: Array<Record<string, unknown>> = [];
    await waitForRenderedFrame(page);
    let pagePoint = await toPagePoint(page, target, await snapshot(page));
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await page.mouse.move(pagePoint.x, pagePoint.y, { steps: 4 });
      await waitForRenderedFrame(page);
      const observed = await page.evaluate(() => {
        const scene = window.__railSimGame.scene.getScene('WorldScene');
        const pointer = scene.input.activePointer;
        const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        return {
          pointer: { x: pointer.x, y: pointer.y },
          world: { x: world.x, y: world.y },
        };
      });
      const state = await snapshot(page);
      const desired = await worldToCameraPoint(page, target);
      const canvas = await page.locator('canvas').boundingBox();
      if (!canvas) throw new Error('Canvas is not visible');
      recent.push({
        attempt,
        target,
        pagePoint,
        desired,
        observed,
        camera: state.camera,
        canvas,
        worldError: distanceTo(observed.world, target),
      });
      if (recent.length > 12) recent.shift();
      if (distanceTo(observed.world, target)
        <= pointerWorldTolerance(state.camera.zoom)) return;
      pagePoint = {
        x: pagePoint.x + (
          desired.x - observed.pointer.x
        ) * canvas.width / state.camera.width,
        y: pagePoint.y + (
          desired.y - observed.pointer.y
        ) * canvas.height / state.camera.height,
      };
    }
    throw new Error(JSON.stringify({
      message: 'Could not calibrate construction pointer',
      target,
      recent,
    }));
  };
  const startPage = await toPagePoint(
    page,
    startWorld,
    await snapshot(page),
  );
  await page.mouse.move(startPage.x + 24, startPage.y + 24);
  let anchored = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await moveToWorld(startWorld);
    await page.mouse.down();
    const startAnchor = await page.evaluate(() => {
      const scene = window.__railSimGame.scene.getScene('WorldScene');
      return ((scene as unknown as {
        activeEditorTool?: {
          startAnchor?: Point;
        };
      }).activeEditorTool?.startAnchor ?? null);
    });
    const state = await snapshot(page);
    if (startAnchor
      && distanceTo(startAnchor, startWorld)
        <= pointerWorldTolerance(state.camera.zoom)) {
      anchored = true;
      break;
    }
    await page.mouse.up();
    await page.keyboard.press('Escape');
  }
  if (!anchored) {
    throw new Error(`Could not anchor construction at ${JSON.stringify(startWorld)}`);
  }
  await moveToWorld(endWorld);
  await page.mouse.up();
}

async function buildLink(
  page: Page,
  start: Point,
  end: Point,
  expectedConnections?: number,
  expectedGeometry?: ConstructionPreviewModel['proposal']['geometry'],
): Promise<number> {
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
  expect((await snapshot(page)).construction.phase).toBe('idle');
  await dragTrack(page, start, end);
  const reviewed = await snapshot(page);
  expect(reviewed.construction.phase).toBe('review');
  if (!reviewed.construction.preview?.canConfirm) {
    throw new Error(JSON.stringify({
      message: 'Construction preview rejected',
      start,
      end,
      preview: reviewed.construction.preview,
    }));
  }
  expect(reviewed.construction.preview).toMatchObject({
    affordable: true,
    canConfirm: true,
  });
  if (expectedConnections !== undefined) {
    expect(
      reviewed.construction.preview?.predictedConnections,
      JSON.stringify({
        start,
        end,
        trackEndpoints: before.world.tracks.map((track) => ({
          uuid: track.uuid,
          p0: track.p0,
          p3: track.p3,
        })),
        topology: before.construction.topology,
        previewGeometry: reviewed.construction.preview?.proposal.geometry,
      }),
    )
      .toHaveLength(expectedConnections);
  }
  if (expectedGeometry) {
    expect(reviewed.construction.preview?.proposal.geometry)
      .toEqual(expectedGeometry);
  }
  await expect(page.locator('[data-testid="construction-detail"]'))
    .toContainText('Maximum grade');
  const cost = reviewed.construction.preview!.totalCost;
  await page.locator('[data-testid="construction-confirm"]').click();
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  expect((await snapshot(page)).world.tracks)
    .toHaveLength(before.world.tracks.length + 1);
  return cost;
}

async function buildStarter(page: Page): Promise<void> {
  const opening = await snapshot(page);
  const corridor = [...opening.world.starterOpportunity.corridors].sort(
    (left, right) => left.estimatedCost - right.estimatedCost
      || left.id.localeCompare(right.id),
  )[0];
  if (!corridor) throw new Error('No generated starter corridor');
  for (const segment of corridor.feasibilityWitness.segments) {
    await buildLink(
      page,
      segment.geometry.p0,
      segment.geometry.p3,
      undefined,
      segment.geometry,
    );
  }
}

const nearestEndpoint = (
  state: RegionalBrowserSnapshot,
  target: Point,
): Point => {
  const result = state.world.tracks.flatMap((track) => [
    track.p0,
    track.p3,
  ]).sort((left, right) =>
    distanceTo(left, target) - distanceTo(right, target))[0];
  if (!result) throw new Error('No track endpoint exists');
  return result;
};

async function buildPrerequisiteExtensions(page: Page): Promise<void> {
  const opening = await snapshot(page);
  const extensionStart = resolvePrefabricationExtensionStart(
    opening.world.starterOpportunity,
  );
  if (!extensionStart) throw new Error('No Prefabrication extension start');
  await buildLink(
    page,
    nearestEndpoint(opening, extensionStart.point),
    facility(opening, 'prefabrication-plant').railAccess,
    1,
  );
  const withPrefab = await snapshot(page);
  await buildLink(
    page,
    facility(withPrefab, 'quarry').railAccess,
    facility(withPrefab, 'cement-works').railAccess,
    0,
  );
  const withQuarry = await snapshot(page);
  await buildLink(
    page,
    facility(withQuarry, 'cement-works').railAccess,
    facility(withQuarry, 'prefabrication-plant').railAccess,
    2,
  );
}

const bezierPoint = (
  track: RegionalBrowserSnapshot['world']['tracks'][number],
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
  track: RegionalBrowserSnapshot['world']['tracks'][number],
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
  state: RegionalBrowserSnapshot,
  access: Point & { readonly radius: number },
) => {
  const candidates = state.world.tracks.flatMap((track) => {
    const points: Array<{
      trackUUID: string;
      trackT: number;
      point: Point;
      distance: number;
    }> = [];
    for (let step = 0; step <= 100; step += 1) {
      const trackT = step / 100;
      const point = bezierPoint(track, trackT);
      const distance = distanceTo(point, access);
      if (distance >= access.radius * 0.5
        && distance <= access.radius * 0.78) {
        points.push({ trackUUID: track.uuid, trackT, point, distance });
      }
    }
    return points;
  }).sort((left, right) => right.distance - left.distance
    || left.trackUUID.localeCompare(right.trackUUID)
    || left.trackT - right.trackT);
  if (!candidates[0]) throw new Error('No placement inside facility access');
  return candidates[0];
};

async function purchaseFreightSet(
  page: Page,
  freightSetId:
    | 'flatbed-freight-set'
    | 'aggregate-hopper-set'
    | 'covered-cement-set',
  sourceDefinitionId: 'managed-forest' | 'quarry' | 'cement-works',
): Promise<string> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('n');
  await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
    .toBeVisible();
  const before = await snapshot(page);
  const existing = new Set(before.world.trains.map(({ id }) => id));
  const placement = placementInsideAccess(
    before,
    facility(before, sourceDefinitionId).railAccess,
  );
  await panWorldPointToCentre(page, placement.point);
  await page.locator(`[data-testid="${freightSetId}-buy"]`).click();
  const framed = await snapshot(page);
  const point = await toPagePoint(page, placement.point, framed);
  await page.mouse.click(point.x, point.y);
  const confirm = page.locator('[data-testid="freight-purchase-confirm"]');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect.poll(async () => (
    (await snapshot(page)).world.trains.length
  )).toBe(existing.size + 1);
  const added = (await snapshot(page)).world.trains.find(
    ({ id }) => !existing.has(id),
  );
  if (!added) throw new Error('Purchased train did not persist');
  return added.id;
}

async function enterPlay(page: Page): Promise<void> {
  await waitForRenderedFrame(page);
  const button = await page.evaluate(() => {
    const hud = window.__railSimGame.scene.getScene('HUDScene') as unknown as {
      modeToggleBtn: { text: string; getBounds(): { centerX: number; centerY: number } };
      scale: { width: number; height: number };
    };
    const bounds = hud.modeToggleBtn.getBounds();
    return {
      text: hud.modeToggleBtn.text,
      x: bounds.centerX,
      y: bounds.centerY,
      width: hud.scale.width,
      height: hud.scale.height,
    };
  });
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  if (button.text === '▶ Play') {
    await canvas.click({
      position: {
        x: button.x * box.width / button.width,
        y: button.y * box.height / button.height,
      },
    });
  } else {
    expect(button.text).toBe('✎ Edit World');
  }
  await expect.poll(() => page.evaluate(() => (
    window.__railSimGame.scene.getScene('HUDScene') as unknown as {
      modeToggleBtn: { text: string };
    }
  ).modeToggleBtn.text)).toBe('✎ Edit World');
  await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
    .toBeHidden();
}

async function returnToCreate(page: Page): Promise<void> {
  const alreadyPaused = await page.evaluate(() =>
    window.__railSimGame.scene.isActive('PauseScene'));
  if (!alreadyPaused) await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="company-hud"]')).toBeHidden();
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await canvas.click({
    position: { x: box.width / 2, y: box.height * 0.56 },
  });
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
  await waitForRenderedFrame(page);
}

async function waitForCargo(
  page: Page,
  trainId: string,
  productId: string,
  units: number,
  timeout = 90_000,
): Promise<void> {
  await expect.poll(async () => {
    const cargo = trainById(await snapshot(page), trainId).cargo;
    return {
      productId: cargo?.productId ?? null,
      units: cargo?.units ?? 0,
    };
  }, {
    timeout,
    intervals: [100, 250, 500],
  }).toEqual({ productId, units });
}

async function arriveAtFacilityWithoutCheckpoint(
  page: Page,
  trainId: string,
  destinationDefinitionId: string,
  expectedCargo:
    | { readonly productId: string; readonly units: number }
    | null,
  allowCargoChangeOnArrival = false,
): Promise<void> {
  await selectTrainThroughPointer(page, trainId);
  await driveWithKeyboardToFacility(
    page,
    trainId,
    destinationDefinitionId,
    expectedCargo,
  );
  await crossFacilityBoundaryWithKeyboard(
    page,
    trainId,
    destinationDefinitionId,
    expectedCargo,
    false,
    allowCargoChangeOnArrival,
  );
}

async function deliverCargoWithoutSyntheticTime(
  page: Page,
  trainId: string,
  destinationDefinitionId: string,
  cargo: { readonly productId: string; readonly units: number },
  timeout = 90_000,
): Promise<RegionalBrowserSnapshot> {
  const before = await snapshot(page);
  const deliveredBefore =
    trainById(before, trainId).operations.lifetimeDeliveredUnits;
  let firstViolation: Record<string, unknown> | null = null;
  await arriveAtFacilityWithoutCheckpoint(
    page,
    trainId,
    destinationDefinitionId,
    cargo,
    true,
  );
  await expect.poll(async () => {
    const current = await snapshot(page);
    const live = runtimeById(current, trainId);
    const destination = facility(
      current,
      destinationDefinitionId,
    ).railAccess;
    const track = current.world.tracks.find(
      ({ uuid }) => uuid === live.trackUUID,
    );
    const actualDistance = distanceTo(live, destination);
    const projectedDistance = track && live.trackT !== null
      ? distanceTo(bezierPoint(track, live.trackT), destination)
      : Number.POSITIVE_INFINITY;
    const invariant = {
      actualInside: actualDistance <= destination.radius,
      serializedInside: projectedDistance <= destination.radius,
      onTrack: track !== undefined && live.trackT !== null,
      derailed: live.derailed,
      speedWorldUnitsPerSecond: live.speedWorldUnitsPerSecond,
      throttle: live.throttle,
    };
    if (firstViolation === null && (
      !invariant.actualInside
      || !invariant.serializedInside
      || !invariant.onTrack
      || invariant.derailed
      || invariant.speedWorldUnitsPerSecond > 2
      || invariant.throttle !== 0
    )) {
      firstViolation = {
        tick: current.world.economy.tick,
        trainId,
        destinationDefinitionId,
        destinationRadius: destination.radius,
        actualDistance,
        projectedDistance,
        ...invariant,
      };
    }
    if (firstViolation !== null) {
      throw new Error(JSON.stringify({
        message: 'Delivery invariants were violated',
        firstViolation,
      }));
    }
    return trainById(
      current,
      trainId,
    ).operations.lifetimeDeliveredUnits;
  }, {
    timeout,
    intervals: [100, 250, 500],
  }).toBeGreaterThanOrEqual(deliveredBefore + cargo.units);
  return snapshot(page);
}

async function moveSelectedTrainClearOfFacility(
  page: Page,
  trainId: string,
  sourceDefinitionId: string,
  towardDefinitionId: string,
  clearance = 100,
): Promise<void> {
  const opening = await snapshot(page);
  const source = facility(opening, sourceDefinitionId).railAccess;
  const target = facility(opening, towardDefinitionId).railAccess;
  const key = keyToward(opening, runtimeById(opening, trainId), target);
  try {
    await page.keyboard.down(key);
    await expect.poll(async () => {
      const state = await snapshot(page);
      const live = runtimeById(state, trainId);
      if (live.derailed) {
        throw new Error(
          `${trainId} derailed while clearing ${sourceDefinitionId}`,
        );
      }
      return distanceTo(live, source);
    }, {
      timeout: 20_000,
      intervals: [50, 75, 100, 150],
    }).toBeGreaterThan(source.radius + clearance);
  } finally {
    await page.keyboard.up(key);
  }
  expect(await page.evaluate(() => window.__railSimTrainManager?.selectedTrain?.getUUID()))
    .toBe(trainId);
  await page.locator('[data-testid="train-inspector"]')
    .getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(async () => runtimeById(await snapshot(page), trainId)
    .speedWorldUnitsPerSecond).toBeLessThanOrEqual(2);
}

async function driveSelectedTrainToPoint(
  page: Page,
  trainId: string,
  target: Point,
): Promise<void> {
  await selectTrainThroughPointer(page, trainId);
  let previousDistance = distanceTo(
    runtimeById(await snapshot(page), trainId),
    target,
  );
  let motion: 'approaching' | 'receding' | 'stationary' = 'stationary';
  const pulse = async (key: 'w' | 's', duration: number): Promise<void> => {
    await page.keyboard.down(key);
    await page.waitForTimeout(duration);
    await page.keyboard.up(key);
  };
  const parkingTolerance = 60;
  const parkingRecent: Array<Record<string, unknown>> = [];
  try {
    try {
      await expect.poll(async () => {
        const state = await snapshot(page);
        const live = runtimeById(state, trainId);
        const distance = distanceTo(live, target);
        const delta = distance - previousDistance;
        if (Math.abs(delta) >= 0.5) {
          motion = delta < 0 ? 'approaching' : 'receding';
        } else if (live.speedWorldUnitsPerSecond <= 2) {
          motion = 'stationary';
        }
        previousDistance = distance;
        if (live.derailed) {
          throw new Error(`${trainId} derailed while driving to parking`);
        }
        const propulsion = keyToward(state, live, target);
        const parked = distance <= parkingTolerance
          && live.speedWorldUnitsPerSecond <= 2;
        parkingRecent.push({
          tick: state.world.economy.tick,
          distance,
          speed: live.speedWorldUnitsPerSecond,
          throttle: live.throttle,
          trackUUID: live.trackUUID,
          trackT: live.trackT,
          facing: live.facing,
          propulsion,
          motion,
        });
        if (parkingRecent.length > 12) parkingRecent.shift();
        if (!parked) {
          if (distance <= parkingTolerance) {
            await page.keyboard.up('w');
            await page.keyboard.up('s');
            expect(await page.evaluate(() => window.__railSimTrainManager?.selectedTrain?.getUUID()))
              .toBe(trainId);
            await page.locator('[data-testid="train-inspector"]')
              .getByRole('button', { name: 'Stop', exact: true }).click();
          } else if (motion === 'receding') {
            await page.locator('[data-testid="train-inspector"]')
              .getByRole('button', { name: 'Stop', exact: true }).click();
            await pulse(propulsion, 20);
          } else if (distance <= 400) {
            if (live.speedWorldUnitsPerSecond > 12) {
              await page.locator('[data-testid="train-inspector"]')
                .getByRole('button', { name: 'Stop', exact: true }).click();
            } else if (live.speedWorldUnitsPerSecond < 8) {
              await pulse(propulsion, 20);
            }
          } else if (live.speedWorldUnitsPerSecond < 46) {
            await pulse(propulsion, 60);
          } else if (live.speedWorldUnitsPerSecond > 54) {
            await pulse(oppositeKey(propulsion), 40);
          }
        }
        return parked;
      }, {
        timeout: 360_000,
        intervals: [50, 75, 100, 150],
      }).toBe(true);
    } catch (error) {
      throw new Error(JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
        trainId,
        target,
        parkingRecent,
      }));
    }
  } finally {
    await page.keyboard.up('w');
    await page.keyboard.up('s');
  }
  expect(await page.evaluate(() => window.__railSimTrainManager?.selectedTrain?.getUUID()))
    .toBe(trainId);
  await page.locator('[data-testid="train-inspector"]')
    .getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(async () => {
    const live = runtimeById(await snapshot(page), trainId);
    return distanceTo(live, target) <= parkingTolerance
      && live.speedWorldUnitsPerSecond <= 2;
  }).toBe(true);
}

async function buildPortParkingTail(
  page: Page,
  ensureCreate = true,
): Promise<PortParkingTail> {
  if (ensureCreate) await returnToCreate(page);
  const before = await snapshot(page);
  const beforeTrackIds = new Set(before.world.tracks.map(({ uuid }) => uuid));
  const quarry = facility(before, 'quarry').railAccess;
  const port = facility(before, 'port-interchange').railAccess;
  const portCost = await buildLink(page, quarry, port, 1);
  let current = await snapshot(page);
  const portTrack = current.world.tracks.find(
    ({ uuid }) => !beforeTrackIds.has(uuid),
  );
  if (!portTrack) throw new Error('Port outer link was not created');

  // Fixed-seed continuation chosen from the authenticated terrain fan:
  // both 900-ish unit legs remain below the grade limit while preserving
  // the generated Quarry-Port endpoint's outward bearing.
  const joint = { x: 1_300, y: 1_550 };
  const end = { x: 500, y: 1_200 };

  const beforeNearIds = new Set(
    current.world.tracks.map(({ uuid }) => uuid),
  );
  await buildLink(page, port, joint, 1);
  current = await snapshot(page);
  const nearTrack = current.world.tracks.find(
    ({ uuid }) => !beforeNearIds.has(uuid),
  );
  if (!nearTrack) throw new Error('Near Port parking tail was not created');

  const beforeFarIds = new Set(
    current.world.tracks.map(({ uuid }) => uuid),
  );
  await buildLink(page, joint, end, 1);
  current = await snapshot(page);
  const farTrack = current.world.tracks.find(
    ({ uuid }) => !beforeFarIds.has(uuid),
  );
  if (!farTrack) throw new Error('Far Port parking tail was not created');

  return {
    portTrackUUID: portTrack.uuid,
    portCost,
    tailTrackUUIDs: [nearTrack.uuid, farTrack.uuid],
    nearParkingPoint: bezierPoint(nearTrack, 0.72),
    farParkingPoint: bezierPoint(farTrack, 0.72),
  };
}

async function trainBodyFootprint(
  page: Page,
  trainId: string,
): Promise<readonly Point[]> {
  return page.evaluate((id) => {
    const train = window.__railSimTrainManager?.trains.find(
      (candidate) => candidate.getUUID() === id,
    );
    if (!train) throw new Error(`Missing live train body ${id}`);
    const body = train.getMatterBody().body;
    return [
      { x: body.position.x, y: body.position.y },
      ...body.vertices.map(({ x, y }) => ({ x, y })),
    ];
  }, trainId);
}

async function assertInactiveTrainsParked(
  page: Page,
  trainIds: readonly [string, string],
  tailTrackUUIDs: readonly [string, string],
): Promise<void> {
  const state = await snapshot(page);
  const tailIds = new Set(tailTrackUUIDs);
  const activeRouteSamples = state.world.tracks.flatMap((track) =>
    tailIds.has(track.uuid)
      ? []
      : Array.from(
        { length: 101 },
        (_, step) => bezierPoint(track, step / 100),
      ),
  );
  expect(activeRouteSamples.length).toBeGreaterThan(0);
  const footprints = await Promise.all(
    trainIds.map((trainId) => trainBodyFootprint(page, trainId)),
  );
  for (let index = 0; index < trainIds.length; index += 1) {
    const inactive = runtimeById(state, trainIds[index]);
    expect(inactive.derailed).toBe(false);
    expect(inactive.speedWorldUnitsPerSecond).toBeLessThanOrEqual(2);
    expect(inactive.trackUUID).not.toBeNull();
    expect(tailIds.has(inactive.trackUUID!)).toBe(true);
    expect(Math.min(
      ...footprints[index].flatMap((bodyPoint) =>
        activeRouteSamples.map((routePoint) =>
          distanceTo(bodyPoint, routePoint))),
    )).toBeGreaterThan(400);
  }
  expect(Math.min(
    ...footprints[0].flatMap((left) =>
      footprints[1].map((right) => distanceTo(left, right))),
  )).toBeGreaterThan(400);
}

async function completeCementPrerequisite(
  page: Page,
): Promise<{
  readonly flatbedId: string;
  readonly aggregateId: string;
  readonly cementId: string;
  readonly parkingTail: PortParkingTail;
}> {
  await buildStarter(page);
  const flatbedId = await purchaseFreightSet(
    page,
    'flatbed-freight-set',
    'managed-forest',
  );
  await enterPlay(page);
  await waitForCargo(page, flatbedId, 'logs', 60);
  await deliverCargoWithoutSyntheticTime(
    page,
    flatbedId,
    'sawmill',
    { productId: 'logs', units: 60 },
  );
  expect((await snapshot(page)).world.freightProgress
    .profitableLogDeliveryCompleted).toBe(true);
  await moveSelectedTrainClearOfFacility(
    page,
    flatbedId,
    'sawmill',
    'managed-forest',
  );
  expect(trainById(await snapshot(page), flatbedId).cargo).toBeNull();
  await returnToCreate(page);
  await buildPrerequisiteExtensions(page);
  await enterPlay(page);
  await arriveAtFacilityWithoutCheckpoint(
    page,
    flatbedId,
    'managed-forest',
    null,
    true,
  );
  await waitForCargo(page, flatbedId, 'logs', 60);
  await deliverCargoWithoutSyntheticTime(
    page,
    flatbedId,
    'sawmill',
    { productId: 'logs', units: 60 },
  );
  await waitForCargo(
    page,
    flatbedId,
    'structural-timber',
    60,
    120_000,
  );
  await deliverCargoWithoutSyntheticTime(
    page,
    flatbedId,
    'prefabrication-plant',
    { productId: 'structural-timber', units: 60 },
  );
  expect((await snapshot(page)).world.freightProgress
    .profitableStructuralTimberDeliveryCompleted).toBe(true);
  await moveSelectedTrainClearOfFacility(
    page,
    flatbedId,
    'prefabrication-plant',
    'sawmill',
  );
  const timberClearance = await snapshot(page);
  expect(distanceTo(
    runtimeById(timberClearance, flatbedId),
    facility(timberClearance, 'prefabrication-plant').railAccess,
  )).toBeGreaterThan(400);

  const parkingTail = await buildPortParkingTail(page);
  const aggregateId = await purchaseFreightSet(
    page,
    'aggregate-hopper-set',
    'quarry',
  );
  await enterPlay(page);
  await waitForCargo(
    page,
    aggregateId,
    'limestone-aggregate',
    120,
    120_000,
  );
  await deliverCargoWithoutSyntheticTime(
    page,
    aggregateId,
    'cement-works',
    { productId: 'limestone-aggregate', units: 120 },
  );
  await driveSelectedTrainToPoint(
    page,
    aggregateId,
    parkingTail.farParkingPoint,
  );

  await returnToCreate(page);
  const cementId = await purchaseFreightSet(
    page,
    'covered-cement-set',
    'cement-works',
  );
  await enterPlay(page);
  await waitForCargo(page, cementId, 'cement', 80, 180_000);
  await deliverCargoWithoutSyntheticTime(
    page,
    cementId,
    'prefabrication-plant',
    { productId: 'cement', units: 80 },
  );
  await driveSelectedTrainToPoint(
    page,
    cementId,
    parkingTail.nearParkingPoint,
  );
  await assertInactiveTrainsParked(
    page,
    [aggregateId, cementId],
    parkingTail.tailTrackUUIDs,
  );
  const completed = await snapshot(page);
  expect(completed.world.freightProgress).toMatchObject({
    profitableLogDeliveryCompleted: true,
    profitableStructuralTimberDeliveryCompleted: true,
    profitableLimestoneDeliveryCompleted: true,
    profitableCementDeliveryCompleted: true,
    profitableSteelDeliveryCompleted: false,
    profitableBuildingModuleDeliveryCompleted: false,
  });
  return {
    flatbedId,
    aggregateId,
    cementId,
    parkingTail,
  };
}

async function buildRegionalExtensions(
  page: Page,
  portTrackUUID: string,
  portCost: number,
): Promise<{
  readonly portTrackUUID: string;
  readonly townTrackUUID: string;
}> {
  await returnToCreate(page);
  const before = await snapshot(page);
  const capexBefore = categoryMagnitude(before, 'construction-capex');
  const beforeTownTrackIds = new Set(
    before.world.tracks.map(({ uuid }) => uuid),
  );
  expect(before.objective).toMatchObject({
    id: 'regional-construction-supply',
    achieved: false,
  });
  expect(before.objective.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'connect-port', state: 'complete' }),
      expect.objectContaining({
        id: 'deliver-steel-profitably',
        state: 'current',
      }),
  ]));
  const townCost = await buildLink(
    page,
    facility(before, 'managed-forest').railAccess,
    facility(before, 'town-construction-market').railAccess,
    1,
  );
  const current = await snapshot(page);
  const townTrack = current.world.tracks.find(
    ({ uuid }) => !beforeTownTrackIds.has(uuid),
  );
  if (!townTrack) throw new Error('Town outer link was not created');
  expect(portCost + townCost).toBeLessThanOrEqual(60_000);
  expect(
    categoryMagnitude(current, 'construction-capex') - capexBefore,
  ).toBe(townCost);
  await expectRegionalObjectiveDom(page, 'Supply regional construction', {
    'connect-port': 'complete',
    'deliver-steel-profitably': 'current',
    'assemble-building-modules': 'pending',
    'connect-town': 'pending',
    'deliver-building-modules-profitably': 'pending',
  });
  return {
    portTrackUUID,
    townTrackUUID: townTrack.uuid,
  };
}

async function loadOnlySavedWorldFromMenu(page: Page): Promise<void> {
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
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await canvas.click({
    position: { x: box.width / 2, y: Math.min(200, box.height / 3) },
  });
  await waitForHarness(page);
}

async function reloadOnlySavedWorld(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  await page.keyboard.press('Escape');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await canvas.click({
    position: { x: box.width / 2, y: box.height * 0.67 },
  });
  await loadOnlySavedWorldFromMenu(page);
}

async function reloadSavedWorldFromCreate(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  await page.reload();
  await loadOnlySavedWorldFromMenu(page);
}

const keyToward = (
  state: RegionalBrowserSnapshot,
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

async function selectTrainThroughPointer(
  page: Page,
  trainId: string,
): Promise<void> {
  const inspector = page.locator('[data-testid="train-inspector"]');
  const selectedId = await page.evaluate(() =>
    window.__railSimTrainManager?.selectedTrain?.getUUID() ?? null);
  if (await inspector.isVisible()) {
    if (selectedId === trainId) return;
    const clear = await findClearCanvasPoint(page);
    await page.mouse.click(clear.x, clear.y);
    await expect(inspector).toBeHidden();
  }
  let state = await snapshot(page);
  const requested = trainById(state, trainId);
  const expectedDisplayName = {
    'flatbed-freight-set': 'General Flatbed Set',
    'aggregate-hopper-set': 'Aggregate Hopper Set',
    'covered-cement-set': 'Covered Cement Set',
  }[requested.freightSetId ?? ''];
  if (!expectedDisplayName) {
    throw new Error(`Unknown freight set ${String(requested.freightSetId)}`);
  }
  await panWorldPointToCentre(page, runtimeById(state, trainId));
  state = await snapshot(page);
  const runtime = runtimeById(state, trainId);
  const point = await toPagePoint(page, runtime, state);
  await page.mouse.click(point.x, point.y);
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(expectedDisplayName);
  await expect.poll(async () => page.evaluate(() =>
    window.__railSimTrainManager?.selectedTrain?.getUUID() ?? null))
    .toBe(trainId);
}

async function driveWithKeyboardToFacility(
  page: Page,
  trainId: string,
  destinationDefinitionId: string,
  expectedCargo:
    | { readonly productId: string; readonly units: number }
    | null,
): Promise<{
  readonly openingDistance: number;
  readonly bestDistance: number;
  readonly travelledDistance: number;
  readonly maxObservedSpeed: number;
  readonly visitedTrackUUIDs: readonly string[];
}> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.up('w');
  await page.keyboard.up('s');
  await waitForRenderedFrame(page);
  const settlementOpening = await snapshot(page);
  const destination = facility(
    settlementOpening,
    destinationDefinitionId,
  ).railAccess;
  const settlementStart = runtimeById(settlementOpening, trainId);
  const settlementTrackUUID = settlementStart.trackUUID;
  const settlementTrackT = settlementStart.trackT;
  const settlementTargetDistance = distanceTo(settlementStart, destination);
  let settlementStableSamples = 0;
  let settlementPeakSpeed = settlementStart.speedWorldUnitsPerSecond;
  let settlementMaxDisplacement = 0;
  let settlementMaxTargetDistanceDelta = 0;
  let settlementMaxTrackTDelta = 0;
  const settlementRecent: Array<Record<string, unknown>> = [];
  try {
    await expect.poll(async () => {
      const state = await snapshot(page);
      const live = runtimeById(state, trainId);
      const targetDistance = distanceTo(live, destination);
      const displacement = distanceTo(live, settlementStart);
      const trackTDelta = live.trackT === null || settlementTrackT === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(live.trackT - settlementTrackT);
      settlementPeakSpeed = Math.max(
        settlementPeakSpeed,
        live.speedWorldUnitsPerSecond,
      );
      settlementMaxDisplacement = Math.max(
        settlementMaxDisplacement,
        displacement,
      );
      settlementMaxTargetDistanceDelta = Math.max(
        settlementMaxTargetDistanceDelta,
        Math.abs(targetDistance - settlementTargetDistance),
      );
      settlementMaxTrackTDelta = Math.max(
        settlementMaxTrackTDelta,
        trackTDelta,
      );
      settlementRecent.push({
        speed: live.speedWorldUnitsPerSecond,
        throttle: live.throttle,
        trackUUID: live.trackUUID,
        trackT: live.trackT,
        targetDistance,
        displacement,
      });
      if (settlementRecent.length > 12) settlementRecent.shift();
      if (live.derailed) {
        throw new Error(`${trainId} derailed during neutral settlement`);
      }
      if (live.trackUUID !== settlementTrackUUID) {
        throw new Error(`${trainId} changed track during neutral settlement`);
      }
      if (expectedCargo) {
        expect(trainById(state, trainId).cargo).toMatchObject(expectedCargo);
      } else {
        expect(trainById(state, trainId).cargo).toBeNull();
      }
      expect(live.throttle).toBe(0);
      settlementStableSamples = live.speedWorldUnitsPerSecond <= 2
        ? settlementStableSamples + 1
        : 0;
      return settlementStableSamples >= 3;
    }, {
      timeout: 10_000,
      intervals: [16, 20, 25],
    }).toBe(true);
    expect(settlementPeakSpeed).toBeLessThanOrEqual(180);
    expect(settlementMaxDisplacement).toBeLessThanOrEqual(20);
    expect(settlementMaxTargetDistanceDelta).toBeLessThanOrEqual(5);
    expect(settlementMaxTrackTDelta).toBeLessThanOrEqual(0.01);
  } catch (error) {
    throw new Error(JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      trainId,
      destinationDefinitionId,
      settlementPeakSpeed,
      settlementMaxDisplacement,
      settlementMaxTargetDistanceDelta,
      settlementMaxTrackTDelta,
      settlementRecent,
    }));
  }

  const opening = await snapshot(page);
  if (expectedCargo) {
    expect(trainById(opening, trainId).cargo).toMatchObject(expectedCargo);
  } else {
    expect(trainById(opening, trainId).cargo).toBeNull();
  }
  let held: 'w' | 's' | null = null;
  const openingDistance = distanceTo(runtimeById(opening, trainId), destination);
  let previousDistance = openingDistance;
  let previousPosition = runtimeById(opening, trainId);
  let bestDistance = openingDistance;
  let travelledDistance = 0;
  let maxObservedSpeed = 0;
  let lastProgressAt = Date.now();
  let motion: 'approaching' | 'receding' | 'stationary' = 'stationary';
  const visitedTrackUUIDs = new Set<string>();
  const recent: Array<Record<string, unknown>> = [];
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
  const stopSelectedTrain = async (): Promise<void> => {
    await hold(null);
    await page.keyboard.up('w');
    await page.keyboard.up('s');
    expect(await page.evaluate(() => window.__railSimTrainManager?.selectedTrain?.getUUID()))
      .toBe(trainId);
    await page.locator('[data-testid="train-inspector"]')
      .getByRole('button', { name: 'Stop', exact: true }).click();
    // A new throttle command must follow the rendered Stop; otherwise the
    // keyboard can cancel its pending brake before the game consumes it.
    await waitForRenderedFrame(page);
    await expect.poll(async () => runtimeById(await snapshot(page), trainId)
      .speedWorldUnitsPerSecond).toBeLessThanOrEqual(0.1);
  };
  try {
    try {
      await expect.poll(async () => {
        const state = await snapshot(page);
        const live = runtimeById(state, trainId);
        const distance = distanceTo(live, destination);
        const delta = distance - previousDistance;
        if (Math.abs(delta) >= 0.002) {
          motion = delta < 0 ? 'approaching' : 'receding';
        } else if (live.speedWorldUnitsPerSecond <= 2) {
          motion = 'stationary';
        }
        previousDistance = distance;
        bestDistance = Math.min(bestDistance, distance);
        travelledDistance += distanceTo(previousPosition, live);
        previousPosition = live;
        maxObservedSpeed = Math.max(
          maxObservedSpeed,
          live.speedWorldUnitsPerSecond,
        );
        if (live.trackUUID) visitedTrackUUIDs.add(live.trackUUID);
        const propulsion = keyToward(state, live, destination);
        if (Date.now() - lastProgressAt >= 60_000) {
          lastProgressAt = Date.now();
          console.info(JSON.stringify({
            regionalJourney: destinationDefinitionId,
            distance: Math.round(distance),
            speed: live.speedWorldUnitsPerSecond,
            cargo: trainById(state, trainId).cargo,
          }));
        }
        recent.push({
          tick: state.world.economy.tick,
          distance,
          speed: live.speedWorldUnitsPerSecond,
          throttle: live.throttle,
          trackUUID: live.trackUUID,
          trackT: live.trackT,
          facing: live.facing,
          motion,
          propulsion,
        });
        if (recent.length > 12) recent.shift();
        if (live.speedWorldUnitsPerSecond > 72) {
          throw new Error(JSON.stringify({
            message: 'Keyboard route exceeded bounded speed',
            maxObservedSpeed,
            recent,
          }));
        }
        if (live.derailed) {
          throw new Error(JSON.stringify({
            message: `${trainId} derailed en route to ${destinationDefinitionId}`,
            recent,
          }));
        }
        if (expectedCargo) {
          expect(trainById(state, trainId).cargo).toMatchObject(expectedCargo);
        } else {
          expect(trainById(state, trainId).cargo).toBeNull();
        }
        const holdingDistance = destination.radius * 1.06;
        if (distance <= destination.radius) {
          throw new Error(JSON.stringify({
            message: 'Keyboard route crossed transfer boundary before staging',
            distance,
            recent,
          }));
        } else if (distance <= holdingDistance) {
          await stopSelectedTrain();
        } else if (distance <= destination.radius * 1.2) {
          if (motion === 'receding') {
            await stopSelectedTrain();
            await hold(propulsion);
          } else if (live.speedWorldUnitsPerSecond > 8) {
            await stopSelectedTrain();
          } else if (live.speedWorldUnitsPerSecond < 4) {
            await hold(propulsion);
          } else {
            await hold(null);
          }
        } else if (distance <= destination.radius * 2) {
          if (motion === 'receding') {
            await stopSelectedTrain();
            await hold(propulsion);
          } else if (live.speedWorldUnitsPerSecond > 28) {
            await stopSelectedTrain();
          } else if (live.speedWorldUnitsPerSecond < 24) {
            await hold(propulsion);
          } else {
            await hold(null);
          }
        } else if (motion === 'receding') {
          await stopSelectedTrain();
          await hold(propulsion);
        } else {
          await hold(null);
          if (live.speedWorldUnitsPerSecond < 46) {
            await pulse(propulsion, 60);
          } else if (live.speedWorldUnitsPerSecond > 54) {
            await pulse(oppositeKey(propulsion), 60);
          }
        }
        return {
          staged: distance > destination.radius
            && distance <= holdingDistance,
          stopped: live.speedWorldUnitsPerSecond <= 2,
        };
      }, {
        timeout: 300_000,
        intervals: [50, 75, 100, 150],
      }).toEqual({ staged: true, stopped: true });
    } catch (error) {
      const finalState = await snapshot(page);
      const finalRuntime = runtimeById(finalState, trainId);
      throw new Error(JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
        trainId,
        destinationDefinitionId,
        openingDistance,
        bestDistance,
        travelledDistance,
        maxObservedSpeed,
        final: {
          distance: distanceTo(finalRuntime, destination),
          speed: finalRuntime.speedWorldUnitsPerSecond,
          throttle: finalRuntime.throttle,
          trackUUID: finalRuntime.trackUUID,
          trackT: finalRuntime.trackT,
        },
        recent,
      }));
    }
  } finally {
    await page.keyboard.up('w');
    await page.keyboard.up('s');
  }
  expect(travelledDistance).toBeGreaterThan(
    Math.max(100, openingDistance * 0.25),
  );
  expect(bestDistance).toBeLessThan(openingDistance);
  expect(maxObservedSpeed).toBeLessThanOrEqual(72);
  return {
    openingDistance,
    bestDistance,
    travelledDistance,
    maxObservedSpeed,
    visitedTrackUUIDs: [...visitedTrackUUIDs],
  };
}

async function liveTrainCoordinateSources(
  page: Page,
  trainId: string,
): Promise<{
  readonly gameObject: Point;
  readonly matterBody: Point;
}> {
  return page.evaluate((id) => {
    const scene = window.__railSimGame.scene.getScene('WorldScene') as unknown as {
      trainManager: {
        trains: Array<{
          getUUID(): string;
          getMatterBody(): {
            x: number;
            y: number;
            body: {
              position: Point;
              velocity: Point;
            };
          };
        }>;
      };
    };
    const train = scene.trainManager.trains.find(
      (candidate) => candidate.getUUID() === id,
    );
    if (!train) throw new Error(`Missing live train ${id}`);
    const body = train.getMatterBody();
    return {
      gameObject: { x: body.x, y: body.y },
      matterBody: {
        x: body.body.position.x,
        y: body.body.position.y,
      },
    };
  }, trainId);
}

async function liveTrainPersistedGeometry(
  page: Page,
  trainId: string,
  trackT: number,
): Promise<{
  readonly trackUUID: string | null;
  readonly gameObject: Point;
  readonly matterBody: Point;
  readonly curvePoint: Point | null;
  readonly speedWorldUnitsPerSecond: number;
}> {
  return page.evaluate(({ id, t }) => {
    const scene = window.__railSimGame.scene.getScene('WorldScene') as unknown as {
      trainManager: {
        trains: Array<{
          currentTrack: {
            getUUID(): string;
            getCurvePath(): {
              getPoint(position: number): Point;
            };
          } | null;
          getUUID(): string;
          getMatterBody(): {
            x: number;
            y: number;
            body: {
              position: Point;
              velocity: Point;
            };
          };
        }>;
      };
    };
    const train = scene.trainManager.trains.find(
      (candidate) => candidate.getUUID() === id,
    );
    if (!train) throw new Error(`Missing live train ${id}`);
    const body = train.getMatterBody();
    const point = train.currentTrack?.getCurvePath().getPoint(t) ?? null;
    const velocity = body.body.velocity;
    return {
      trackUUID: train.currentTrack?.getUUID() ?? null,
      gameObject: { x: body.x, y: body.y },
      matterBody: {
        x: body.body.position.x,
        y: body.body.position.y,
      },
      curvePoint: point ? { x: point.x, y: point.y } : null,
      speedWorldUnitsPerSecond: Math.hypot(
        velocity.x,
        velocity.y,
      ) * 60,
    };
  }, { id: trainId, t: trackT });
}

interface LiveBogieGeometry {
  readonly dynamics: Extract<Train['dynamics'], { mode: 'on-rail' }>;
  readonly arcAnchor: Point;
  readonly bogieCentre: Point;
  readonly adapterCentre: Point;
  readonly gameObject: Point;
  readonly matterBody: Point;
  readonly derailed: boolean;
}

/** Read the two-bogie pose separately from its saved arc cursor; never change it. */
async function liveTrainBogieGeometry(page: Page, trainId: string): Promise<LiveBogieGeometry> {
  return page.evaluate((id) => {
    const scene = window.__railSimGame.scene.getScene('WorldScene') as unknown as {
      trainManager: {
        trains: Array<{
          getUUID(): string;
          derailed: boolean;
          persistedDynamics: LiveBogieGeometry['dynamics'] | null;
          currentTrack: {
            getArcLengthIndex(): { poseAtDistance(distance: number): { point: Point } };
          } | null;
          getMatterBody(): { x: number; y: number; body: { position: Point } };
        }>;
        getDynamicsAdapter(consistId: string): {
          getCurrentRailPoses(): ReadonlyMap<string, {
            centre: Point;
            frontBogie: Point;
            rearBogie: Point;
          }>;
        } | undefined;
      };
    };
    const train = scene.trainManager.trains.find((candidate) => candidate.getUUID() === id);
    const dynamics = train?.persistedDynamics;
    if (!train || !dynamics || dynamics.mode !== 'on-rail' || !train.currentTrack) {
      throw new Error(`Missing on-rail bogie state for ${id}`);
    }
    const pose = scene.trainManager.getDynamicsAdapter(dynamics.consistId)
      ?.getCurrentRailPoses().get(id);
    if (!pose) throw new Error(`Missing deterministic bogie pose for ${id}`);
    const body = train.getMatterBody();
    return {
      dynamics: { ...dynamics },
      arcAnchor: train.currentTrack.getArcLengthIndex().poseAtDistance(dynamics.distance).point,
      bogieCentre: {
        x: (pose.frontBogie.x + pose.rearBogie.x) / 2,
        y: (pose.frontBogie.y + pose.rearBogie.y) / 2,
      },
      adapterCentre: { ...pose.centre },
      gameObject: { x: body.x, y: body.y },
      matterBody: { ...body.body.position },
      derailed: train.derailed,
    };
  }, trainId);
}

async function stoppedTrainBogieGeometry(page: Page, trainId: string): Promise<LiveBogieGeometry> {
  let observed: LiveBogieGeometry | null = null;
  await expect.poll(async () => {
    await waitForRenderedFrame(page);
    observed = await liveTrainBogieGeometry(page, trainId);
    return {
      stopped: Math.abs(observed.dynamics.speedMps) <= 1e-9,
      derailed: observed.derailed,
      adapterAtBogieCentre: distanceTo(observed.adapterCentre, observed.bogieCentre) <= 0.01,
      spriteAtBogieCentre: distanceTo(observed.gameObject, observed.bogieCentre) <= 0.01,
      matterAtBogieCentre: distanceTo(observed.matterBody, observed.bogieCentre) <= 0.01,
    };
  }, { timeout: 500, intervals: [16, 20, 25] }).toEqual({
    stopped: true,
    derailed: false,
    adapterAtBogieCentre: true,
    spriteAtBogieCentre: true,
    matterAtBogieCentre: true,
  });
  return observed!;
}

async function crossFacilityBoundaryWithKeyboard(
  page: Page,
  trainId: string,
  destinationDefinitionId: string,
  expectedCargo:
    | { readonly productId: string; readonly units: number }
    | null,
  saveReload = true,
  allowCargoChangeOnArrival = false,
  afterArrivalBeforeCheckpoint?: () => Promise<void | 'create'>,
  pauseOnCargo?: { readonly productId: string; readonly units: number },
): Promise<void> {
  const opening = await snapshot(page);
  const destination = facility(
    opening,
    destinationDefinitionId,
  ).railAccess;
  expect(distanceTo(runtimeById(opening, trainId), destination))
    .toBeGreaterThan(destination.radius);
  await expect.poll(
    async () => (await snapshot(page)).world.economy.tick,
    { timeout: 3_000, intervals: [50, 75, 100] },
  ).toBeGreaterThan(opening.world.economy.tick);

  const assertCargo = (
    state: RegionalBrowserSnapshot,
    crossedDestinationBoundary = false,
  ): void => {
    if (crossedDestinationBoundary && allowCargoChangeOnArrival) return;
    if (expectedCargo) {
      expect(trainById(state, trainId).cargo).toMatchObject(expectedCargo);
    } else {
      expect(trainById(state, trainId).cargo).toBeNull();
    }
  };
  const pulse = async (key: 'w' | 's', duration: number): Promise<void> => {
    await page.keyboard.down(key);
    await page.waitForTimeout(Math.max(duration, 20));
    await page.keyboard.up(key);
  };
  // Crossing has a narrow engineering boundary. Keep the authoritative cargo,
  // tracks and runtime evidence, without transporting unrelated terrain for
  // every control sample while the train is moving.
  const crossingSnapshot = async (): Promise<RegionalBrowserSnapshot> =>
    page.evaluate(() => {
      const harness = window.__railSimFirstRouteHarness;
      if (!harness) throw new Error('Regional browser harness is unavailable');
      const state = harness.snapshot();
      return {
        world: {
          trains: state.world.trains,
          tracks: state.world.tracks,
          economy: { tick: state.world.economy.tick },
        },
        runtime: state.runtime,
      } as RegionalBrowserSnapshot;
    });
  let previousDistance = distanceTo(
    runtimeById(opening, trainId),
    destination,
  );
  let motion: 'approaching' | 'receding' | 'stationary' = 'stationary';
  let pausedOnArrival = false;
  try {
    await expect.poll(async () => {
      const state = await crossingSnapshot();
      const live = runtimeById(state, trainId);
      const distance = distanceTo(live, destination);
      const delta = distance - previousDistance;
      if (Math.abs(delta) >= 0.25) {
        motion = delta < 0 ? 'approaching' : 'receding';
      } else if (live.speedWorldUnitsPerSecond <= 2) {
        motion = 'stationary';
      }
      previousDistance = distance;
      assertCargo(state);
      if (distance <= destination.radius) {
        throw new Error(JSON.stringify({
          message: `${trainId} crossed ${destinationDefinitionId} before near staging`,
          openingDistance: distanceTo(runtimeById(opening, trainId), destination),
          distance, motion, speed: live.speedWorldUnitsPerSecond,
          throttle: live.throttle, facing: live.facing, trackUUID: live.trackUUID,
        }));
      }
      if (live.derailed) {
        throw new Error(`${trainId} derailed staging ${destinationDefinitionId}`);
      }
      const propulsion = keyToward(state, live, destination);
      const nearBoundary = distance <= destination.radius * 1.02;
      const ready = nearBoundary
        && motion !== 'receding'
        && live.speedWorldUnitsPerSecond >= 2
        && live.speedWorldUnitsPerSecond <= 8;
      if (!ready) {
        if (motion === 'receding') {
          await pulse(propulsion, 5);
        } else if (live.speedWorldUnitsPerSecond > 4) {
          expect(await page.evaluate(() => window.__railSimTrainManager?.selectedTrain?.getUUID()))
            .toBe(trainId);
          await page.locator('[data-testid="train-inspector"]')
            .getByRole('button', { name: 'Stop', exact: true }).click();
        } else if (live.speedWorldUnitsPerSecond < 2) {
          await pulse(propulsion, nearBoundary ? 5 : 12);
        }
      }
      return {
        nearBoundary,
        ready,
      };
    }, {
      timeout: 20_000,
      intervals: [10, 15, 20],
    }).toEqual({ nearBoundary: true, ready: true });

    const crossingRecent: Array<Record<string, unknown>> = [];
    let crossedDestinationBoundary = false;
    let coordinateEvidence: Awaited<
      ReturnType<typeof liveTrainCoordinateSources>
    > | null = null;
    try {
      await expect.poll(async () => {
        const state = await crossingSnapshot();
        const live = runtimeById(state, trainId);
        const distance = distanceTo(live, destination);
        const delta = distance - previousDistance;
        if (Math.abs(delta) >= 0.25) {
          motion = delta < 0 ? 'approaching' : 'receding';
        } else if (live.speedWorldUnitsPerSecond <= 2) {
          motion = 'stationary';
        }
        previousDistance = distance;
        const propulsion = keyToward(state, live, destination);
        const track = state.world.tracks.find(
          ({ uuid }) => uuid === live.trackUUID,
        );
        const projectedDistance = track && live.trackT !== null
          ? distanceTo(bezierPoint(track, live.trackT), destination)
          : Number.POSITIVE_INFINITY;
        crossedDestinationBoundary ||= distance <= destination.radius;
        assertCargo(state, crossedDestinationBoundary);
        if (crossedDestinationBoundary && coordinateEvidence === null) {
          coordinateEvidence = await liveTrainCoordinateSources(page, trainId);
          expect(distanceTo(
            coordinateEvidence.gameObject,
            coordinateEvidence.matterBody,
          )).toBeLessThanOrEqual(0.01);
        }
        crossingRecent.push({
          tick: state.world.economy.tick,
          distance,
          projectedDistance,
          speed: live.speedWorldUnitsPerSecond,
          throttle: live.throttle,
          trackUUID: live.trackUUID,
          trackT: live.trackT,
          propulsion,
          motion,
        });
        if (crossingRecent.length > 12) crossingRecent.shift();
        if (live.derailed) {
          throw new Error(`${trainId} derailed crossing ${destinationDefinitionId}`);
        }
        const inside = distance <= destination.radius
          && projectedDistance <= destination.radius;
        const persistableInside =
          inside && live.speedWorldUnitsPerSecond <= 2;
        if (inside) {
          await page.keyboard.up('w');
          await page.keyboard.up('s');
          expect(await page.evaluate(() => window.__railSimTrainManager?.selectedTrain?.getUUID()))
            .toBe(trainId);
          await page.locator('[data-testid="train-inspector"]')
            .getByRole('button', { name: 'Stop', exact: true }).click();
          if (pauseOnCargo) {
            // Freeze the actual first loading batch before expensive full-world
            // inspection can consume its one-tick window. Stop, loading and
            // pause all use the same public controls as ordinary play.
            await expect.poll(async () => {
              const stopped = await crossingSnapshot();
              const stoppedRuntime = runtimeById(stopped, trainId);
              const stoppedTrack = stopped.world.tracks.find(
                ({ uuid }) => uuid === stoppedRuntime.trackUUID,
              );
              const cargo = trainById(stopped, trainId).cargo;
              return {
                actualInside: distanceTo(stoppedRuntime, destination) <= destination.radius,
                serializedInside: stoppedTrack !== undefined && stoppedRuntime.trackT !== null
                  && distanceTo(bezierPoint(stoppedTrack, stoppedRuntime.trackT), destination)
                    <= destination.radius,
                derailed: stoppedRuntime.derailed,
                stopped: stoppedRuntime.speedWorldUnitsPerSecond <= 0.1,
                throttle: stoppedRuntime.throttle,
                cargo: cargo && {
                  productId: cargo.productId,
                  units: cargo.units,
                  loadedUnits: cargo.loadedUnits,
                },
              };
            }, { timeout: 10_000, intervals: [10, 15, 20] }).toEqual({
              actualInside: true,
              serializedInside: true,
              derailed: false,
              stopped: true,
              throttle: 0,
              cargo: {
                productId: pauseOnCargo.productId,
                units: pauseOnCargo.units,
                loadedUnits: pauseOnCargo.units,
              },
            });
            await page.keyboard.press('Escape');
            await expect.poll(() => page.evaluate(() =>
              window.__railSimGame.scene.isActive('PauseScene'))).toBe(true);
            await expect(page.locator('[data-testid="company-hud"]')).toBeHidden();
            const paused = await crossingSnapshot();
            const pausedRuntime = runtimeById(paused, trainId);
            const pausedTrack = paused.world.tracks.find(
              ({ uuid }) => uuid === pausedRuntime.trackUUID,
            );
            expect(pausedTrack).toBeDefined();
            expect(pausedRuntime.trackT).not.toBeNull();
            expect(distanceTo(pausedRuntime, destination)).toBeLessThanOrEqual(destination.radius);
            expect(distanceTo(bezierPoint(pausedTrack!, pausedRuntime.trackT!), destination))
              .toBeLessThanOrEqual(destination.radius);
            expect(pausedRuntime.speedWorldUnitsPerSecond).toBeLessThanOrEqual(0.1);
            expect(pausedRuntime.throttle).toBe(0);
            expect(pausedRuntime.derailed).toBe(false);
            expect(trainById(paused, trainId).cargo).toMatchObject({
              productId: pauseOnCargo.productId,
              units: pauseOnCargo.units,
              loadedUnits: pauseOnCargo.units,
            });
            pausedOnArrival = true;
            return { persistableInside: true };
          }
        } else if (motion === 'receding') {
          await pulse(propulsion, 5);
        } else {
          if (!persistableInside) await pulse(propulsion, 5);
        }
        return {
          persistableInside,
        };
      }, {
        timeout: 20_000,
        intervals: [10, 15, 20],
      }).toEqual({ persistableInside: true });
    } catch (error) {
      throw new Error(JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
        trainId,
        destinationDefinitionId,
        coordinateEvidence,
        crossingRecent,
      }));
    }
  } finally {
    await page.keyboard.up('w');
    await page.keyboard.up('s');
  }
  const inspectorStop = page.locator(
    '[data-testid="train-inspector"] [data-throttle="0"]',
  );
  if (!pausedOnArrival) {
    await expect(inspectorStop).toBeVisible();
    await inspectorStop.click();
  }
  await expect.poll(async () => {
    const state = await snapshot(page);
    const live = runtimeById(state, trainId);
    const track = state.world.tracks.find(
      ({ uuid }) => uuid === live.trackUUID,
    );
    const projectedDistance = track && live.trackT !== null
      ? distanceTo(bezierPoint(track, live.trackT), destination)
      : Number.POSITIVE_INFINITY;
    return {
      actualInside: distanceTo(live, destination) <= destination.radius,
      serializedInside: projectedDistance <= destination.radius,
      derailed: live.derailed,
      onTrack: track !== undefined,
      stopped: live.speedWorldUnitsPerSecond <= 0.1,
    };
  }, {
    timeout: 5_000,
    intervals: [20, 30, 50],
  }).toEqual({
    actualInside: true,
    serializedInside: true,
    derailed: false,
    onTrack: true,
    stopped: true,
  });
  const arrived = await snapshot(page);
  const arrivedRuntime = runtimeById(arrived, trainId);
  const arrivedTrack = arrived.world.tracks.find(
    ({ uuid }) => uuid === arrivedRuntime.trackUUID,
  );
  if (!arrivedTrack || arrivedRuntime.trackT === null) {
    throw new Error(`Missing persisted arrival track for ${trainId}`);
  }
  expect(distanceTo(arrivedRuntime, destination))
    .toBeLessThanOrEqual(destination.radius);
  expect(distanceTo(
    bezierPoint(arrivedTrack, arrivedRuntime.trackT),
    destination,
  )).toBeLessThanOrEqual(destination.radius);
  assertCargo(arrived, true);
  // Delivery notifications and transfer batches describe this live arrival;
  // the saved world preserves its result, but does not replay those UI events.
  const arrivalMode = await afterArrivalBeforeCheckpoint?.();
  if (!saveReload) return;

  if (arrivalMode !== 'create') await returnToCreate(page);
  await waitForRenderedFrame(page);
  await page.keyboard.press('Control+S');
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  const arrivalCheckpoint = (await snapshot(page)).world;
  const arrivalTrackUUID = arrivedRuntime.trackUUID;

  await reloadSavedWorldFromCreate(page);
  let restored = await snapshot(page);
  const restoredAuthority = trainById(restored, trainId);
  const restoredTrack = restored.world.tracks.find(
    ({ uuid }) => uuid === restoredAuthority.trackUUID,
  );
  if (!restoredTrack) {
    throw new Error(`Missing restored track for ${trainId}`);
  }
  const serializedPoint = bezierPoint(
    restoredTrack,
    restoredAuthority.trackT,
  );
  expect(distanceTo(serializedPoint, destination))
    .toBeLessThanOrEqual(destination.radius);
  let restoredGeometry = await liveTrainPersistedGeometry(
    page,
    trainId,
    restoredAuthority.trackT,
  );
  expect(restoredGeometry.trackUUID).toBe(restoredAuthority.trackUUID);
  expect(restoredGeometry.curvePoint).not.toBeNull();
  expect(distanceTo(restoredGeometry.curvePoint!, serializedPoint))
    .toBeLessThanOrEqual(0.01);
  const synchronizationRecent: Array<Record<string, unknown>> = [];
  try {
    await expect.poll(async () => {
      await waitForRenderedFrame(page);
      restoredGeometry = await liveTrainPersistedGeometry(
        page,
        trainId,
        restoredAuthority.trackT,
      );
      const matterToCurve = distanceTo(
        restoredGeometry.matterBody,
        serializedPoint,
      );
      const gameObjectToMatter = distanceTo(
        restoredGeometry.gameObject,
        restoredGeometry.matterBody,
      );
      synchronizationRecent.push({
        mode: 'create',
        serializedPoint,
        liveCurvePoint: restoredGeometry.curvePoint,
        matterBody: restoredGeometry.matterBody,
        gameObject: restoredGeometry.gameObject,
        matterToCurve,
        gameObjectToMatter,
        matterToDestination: distanceTo(
          restoredGeometry.matterBody,
          destination,
        ),
        gameObjectToDestination: distanceTo(
          restoredGeometry.gameObject,
          destination,
        ),
        speedWorldUnitsPerSecond:
          restoredGeometry.speedWorldUnitsPerSecond,
      });
      if (synchronizationRecent.length > 12) {
        synchronizationRecent.shift();
      }
      const matterSynchronized = matterToCurve <= 0.01;
      return {
        matterSynchronized,
        gameObjectSynchronized: matterSynchronized
          && gameObjectToMatter <= 0.01,
      };
    }, {
      timeout: 500,
      intervals: [16, 20, 25],
    }).toEqual({
      matterSynchronized: true,
      gameObjectSynchronized: true,
    });
  } catch (error) {
    throw new Error(JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      trainId,
      destinationDefinitionId,
      synchronizationRecent,
    }));
  }
  expect(distanceTo(restoredGeometry.matterBody, serializedPoint))
    .toBeLessThanOrEqual(0.01);
  expect(distanceTo(restoredGeometry.matterBody, destination))
    .toBeLessThanOrEqual(destination.radius);

  restored = await snapshot(page);
  const restoredRuntime = runtimeById(restored, trainId);
  expect(stableWorld(restored.world)).toEqual(stableWorld(arrivalCheckpoint));
  expect(restoredRuntime.trackUUID).toBe(arrivalTrackUUID);
  expect(distanceTo(restoredRuntime, destination))
    .toBeLessThanOrEqual(destination.radius);
  expect(restoredRuntime.speedWorldUnitsPerSecond).toBeLessThanOrEqual(0.01);
  assertCargo(restored, true);
}

async function clickFacilityThroughPointer(
  page: Page,
  definitionId: string,
): Promise<void> {
  let state = await snapshot(page);
  const target = facility(state, definitionId).railAccess;
  await panWorldPointToCentre(
    page,
    target,
  );
  const recent: Array<Record<string, unknown>> = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    state = await snapshot(page);
    const point = await toPagePoint(page, target, state);
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await waitForRenderedFrame(page);
    const observed = await page.evaluate(() => {
      const scene = window.__railSimGame.scene.getScene('WorldScene');
      const pointer = scene.input.activePointer;
      const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      return {
        pointer: { x: pointer.x, y: pointer.y },
        world: { x: world.x, y: world.y },
      };
    });
    state = await snapshot(page);
    recent.push({
      attempt,
      point,
      observed,
      camera: state.camera,
      error: distanceTo(observed.world, target),
    });
    if (distanceTo(observed.world, target)
      > pointerWorldTolerance(state.camera.zoom)) continue;
    await page.mouse.down();
    await page.mouse.up();
    if (await page.locator('[data-testid="facility-inspector"]').isVisible()) {
      return;
    }
  }
  throw new Error(JSON.stringify({
    message: 'Could not click facility through calibrated pointer',
    definitionId,
    target,
    recent,
  }));
}

async function clickFacilityThroughMobilePointer(
  page: Page,
  definitionId: string,
): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await enterPlay(page);
  await waitForRenderedFrame(page);
  const opening = await snapshot(page);
  const desiredMobile = { x: 80, y: 420 };
  const desiredDesktop = {
    x: desiredMobile.x
      + (opening.camera.width - MOBILE.width)
        * (1 - opening.camera.zoom) / 2,
    y: desiredMobile.y
      + (opening.camera.height - MOBILE.height)
        * (1 - opening.camera.zoom) / 2,
  };
  await panWorldPointToCentre(
    page,
    facility(opening, definitionId).railAccess,
    desiredDesktop,
  );
  await page.setViewportSize(MOBILE);
  await waitForRenderedFrame(page);
  const state = await snapshot(page);
  const point = await toPagePoint(
    page,
    facility(state, definitionId).railAccess,
    state,
  );
  expect(await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y) instanceof HTMLCanvasElement
  ), point)).toBe(true);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('[data-testid="facility-inspector"]'))
    .toBeVisible();
}

async function assertReachableWithinScrollableViewport(
  page: Page,
  containerSelector: string,
  targetSelector: string,
): Promise<void> {
  const container = page.locator(containerSelector);
  const target = page.locator(targetSelector);
  await container.hover();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const position = await target.evaluate((element, selector) => {
      const inspector = element.closest(
        '[data-testid="facility-inspector"]',
      );
      if (!(inspector instanceof HTMLElement)) {
        throw new Error(`${selector} is outside the facility inspector`);
      }
      const inspectorBox = inspector.getBoundingClientRect();
      const targetBox = element.getBoundingClientRect();
      return {
        visible: targetBox.top >= inspectorBox.top - 1
          && targetBox.bottom <= inspectorBox.bottom + 1,
        direction: targetBox.top < inspectorBox.top ? -1 : 1,
      };
    }, targetSelector);
    if (position.visible) return;
    await page.mouse.wheel(0, position.direction * 180);
    await page.waitForTimeout(16);
  }
  throw new Error(`${targetSelector} was not reachable by user scrolling`);
}

async function assertUserScrollableInspector(
  page: Page,
  shouldOverflow: boolean,
): Promise<void> {
  const inspector = page.locator('[data-testid="facility-inspector"]');
  const before = await inspector.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(before.overflowY).toMatch(/auto|scroll/);
  if (!shouldOverflow) {
    expect(before.scrollHeight).toBe(before.clientHeight);
    return;
  }
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  await inspector.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(
    () => inspector.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(before.scrollTop);
}

async function assertBoundaryInspectorOnMobile(
  page: Page,
  definitionId: 'port-interchange' | 'town-construction-market',
): Promise<void> {
  await clickFacilityThroughMobilePointer(page, definitionId);
  const inspector = '[data-testid="facility-inspector"]';
  await expect(page.locator(inspector)).toHaveAttribute(
    'data-layout',
    'mobile',
  );
  await assertUserScrollableInspector(
    page,
    definitionId === 'town-construction-market',
  );
  for (const selector of [
    '[data-testid="facility-name"]',
    '[data-testid="facility-status"]',
    '[data-testid="facility-inventories"]',
    '[data-testid="facility-quotes"]',
    '[data-testid="facility-rail"]',
  ]) {
    await assertReachableWithinScrollableViewport(
      page,
      inspector,
      selector,
    );
  }
}

async function findClearCanvasPoint(page: Page): Promise<Point> {
  const result = await page.evaluate(() => {
    const editorUI = window.__railSimGame.scene.getScene(
      'EditorUIScene',
    ) as unknown as {
      containsScreenPoint(x: number, y: number): boolean;
    };
    for (let y = window.innerHeight - 24; y >= 24; y -= 16) {
      for (let x = 56; x <= window.innerWidth - 24; x += 16) {
        const element = document.elementFromPoint(x, y);
        if (element instanceof HTMLCanvasElement
          && !editorUI.containsScreenPoint(x, y)) {
          return { x, y };
        }
      }
    }
    return null;
  });
  if (!result) throw new Error('No clear canvas point remains');
  return result;
}

interface TownDeliveryDomTexts {
  readonly deliveryText: string;
  readonly statusText: string;
  readonly batchText: string;
}

interface TownDeliveryDomCapture {
  witness: TownDeliveryDomTexts | null;
  latest: TownDeliveryDomTexts;
  expired: boolean;
  dispose(): void;
}

type TownDeliveryDomWindow = Window & {
  __railSimTownDeliveryDomCapture?: TownDeliveryDomCapture;
};

/** Retain the genuine one-tick unloading display while geometry is inspected. */
async function armTownDeliveryDomWitness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const targetWindow = window as TownDeliveryDomWindow;
    targetWindow.__railSimTownDeliveryDomCapture?.dispose();
    const delivery = document.querySelector('[data-testid="company-last-delivery"]');
    const status = document.querySelector('[data-testid="train-transfer-status"]');
    const batch = document.querySelector('[data-testid="train-transfer-progress"]')
      ?.previousElementSibling;
    if (!delivery || !status || !batch) {
      throw new Error('Town delivery DOM witness targets are unavailable');
    }
    const read = (): TownDeliveryDomTexts => ({
      deliveryText: delivery.textContent?.trim() ?? '',
      statusText: status.textContent?.trim() ?? '',
      batchText: batch.textContent?.trim() ?? '',
    });
    let expiry: number;
    const capture: TownDeliveryDomCapture = {
      witness: null,
      latest: read(),
      expired: false,
      dispose: () => {
        observer.disconnect();
        window.clearTimeout(expiry);
      },
    };
    const observe = (): void => {
      capture.latest = read();
      if (capture.latest.deliveryText.includes(
        'Building Modules delivered to Town Construction Market',
      ) && capture.latest.statusText === 'Unloading'
        && capture.latest.batchText === 'Batch 4 / 4 modules') {
        capture.witness = capture.latest;
        capture.dispose();
      }
    };
    const observer = new MutationObserver(observe);
    for (const target of [delivery, status, batch]) {
      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    expiry = window.setTimeout(() => {
      capture.latest = read();
      capture.expired = true;
      capture.dispose();
    }, 90_000);
    targetWindow.__railSimTownDeliveryDomCapture = capture;
    observe();
  });
}

async function disposeTownDeliveryDomWitness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const targetWindow = window as TownDeliveryDomWindow;
    targetWindow.__railSimTownDeliveryDomCapture?.dispose();
    delete targetWindow.__railSimTownDeliveryDomCapture;
  });
}

async function writeRegionalCheckpoint(
  testInfo: TestInfo,
  stage: string,
  world: RegionalBrowserSnapshot['world'],
): Promise<void> {
  const checkpointPath = testInfo.outputPath(`regional-${PRIMARY_SEED}-${stage}.json`);
  await writeFile(checkpointPath, JSON.stringify(world, null, 2));
  console.info(JSON.stringify({
    regionalCheckpoint: stage,
    seed: world.generationConfig.seed,
    capturedAt: new Date().toISOString(),
    path: checkpointPath,
    tick: world.economy.tick,
  }));
}

function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test.describe('regional construction supply browser journey', () => {
  test.use({ hasTouch: true });

  test('playtest-825 builds the authenticated mineral and Port links through real pointers', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await createFixedSeedWorld(page, PRIMARY_SEED);
    await buildStarter(page);
    await buildPrerequisiteExtensions(page);
    const parkingTail = await buildPortParkingTail(page, false);
    const flatbedId = await purchaseFreightSet(
      page,
      'flatbed-freight-set',
      'managed-forest',
    );
    const state = await snapshot(page);
    const footprint = await trainBodyFootprint(page, flatbedId);
    const bodyCentre = runtimeById(state, flatbedId);
    const bodyRadius = Math.max(
      ...footprint.map((point) => distanceTo(point, bodyCentre)),
    );
    const tailIds = new Set(parkingTail.tailTrackUUIDs);
    const activeRouteSamples = state.world.tracks.flatMap((track) =>
      tailIds.has(track.uuid)
        ? []
        : Array.from(
          { length: 101 },
          (_, step) => bezierPoint(track, step / 100),
        ),
    );
    for (const parkingPoint of [
      parkingTail.nearParkingPoint,
      parkingTail.farParkingPoint,
    ]) {
      expect(Math.min(
        ...activeRouteSamples.map((routePoint) =>
          distanceTo(parkingPoint, routePoint)),
      )).toBeGreaterThan(460 + bodyRadius);
    }
    expect(distanceTo(
      parkingTail.nearParkingPoint,
      parkingTail.farParkingPoint,
    )).toBeGreaterThan(520 + bodyRadius * 2);
  });

  test('pointer selection switches between identical freight sets', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createFixedSeedWorld(page, PRIMARY_SEED);
    await buildStarter(page);
    const firstId = await purchaseFreightSet(
      page,
      'flatbed-freight-set',
      'managed-forest',
    );
    await enterPlay(page);
    await moveSelectedTrainClearOfFacility(
      page,
      firstId,
      'managed-forest',
      'sawmill',
      700,
    );
    expect(await page.evaluate(() => window.__railSimTrainManager?.selectedTrain?.getUUID()))
      .toBe(firstId);
    await page.locator('[data-testid="train-inspector"]')
      .getByRole('button', { name: 'Stop', exact: true }).click();
    await returnToCreate(page);
    const secondId = await purchaseFreightSet(
      page,
      'flatbed-freight-set',
      'managed-forest',
    );
    await enterPlay(page);
    await selectTrainThroughPointer(page, secondId);
    const selectedId = await page.evaluate(() =>
      window.__railSimTrainManager?.selectedTrain?.getUUID() ?? null);
    expect(selectedId).toBe(secondId);
    await expect.poll(async () => {
      const firstRuntime = runtimeById(await snapshot(page), firstId);
      return {
        derailed: firstRuntime.derailed,
        stopped: firstRuntime.speedWorldUnitsPerSecond <= 2,
        onTrack: firstRuntime.trackUUID !== null,
      };
    }, {
      timeout: 5_000,
      intervals: [20, 30, 50],
    }).toEqual({
      derailed: false,
      stopped: true,
      onTrack: true,
      });
  });

  test('playtest-825 completes the regional chain through real controls @legacy', async ({
    page,
  }, testInfo) => {
    test.setTimeout(4_200_000);
    const errors = captureErrors(page);
    const opening = await createFixedSeedWorld(page, PRIMARY_SEED);
    const openingCash = opening.world.company.cash;
    const {
      flatbedId,
      aggregateId,
      cementId,
      parkingTail,
    } = await completeCementPrerequisite(page);
    const regionalRoutes = await buildRegionalExtensions(
      page,
      parkingTail.portTrackUUID,
      parkingTail.portCost,
    );
    await assertInactiveTrainsParked(
      page,
      [aggregateId, cementId],
      parkingTail.tailTrackUUIDs,
    );

    const productionOpening = facility(await snapshot(page), 'prefabrication-plant');
    expect(productionOpening.inventories['structural-timber'].quantity).toBe(60);
    expect(productionOpening.inventories.cement.quantity).toBe(80);
    expect(productionOpening.inventories.steel.quantity).toBe(0);
    expect(productionOpening.inventories['building-modules'].quantity).toBe(0);

    await assertBoundaryInspectorOnMobile(page, 'port-interchange');
    await expect(page.locator('[data-testid="facility-name"]'))
      .toHaveText('Port Interchange');
    await expect(page.locator('[data-testid="facility-status"]'))
      .toHaveText('Imported steel available');
    await expect(page.locator('[data-testid="facility-inspector"]'))
      .toContainText('Offers Steel');
    await assertBoundaryInspectorOnMobile(
      page,
      'town-construction-market',
    );
    await expect(page.locator('[data-testid="facility-name"]'))
      .toHaveText('Town Construction Market');
    await expect(page.locator('[data-testid="facility-status"]'))
      .toHaveText('Buying Building Modules');
    await expect(page.locator('[data-testid="facility-inspector"]'))
      .toContainText('Buys Building Modules');
    await expect(page.locator('[data-testid="facility-quotes"]'))
      .toContainText('/ module');
    await expect(page.locator('[data-testid="facility-quotes"]'))
      .toContainText('4 modules');
    for (const factor of [
      'Global construction',
      'Regional demand',
      'Inventory pressure',
    ]) {
      await expect(page.locator('[data-testid="facility-quotes"]'))
        .toContainText(factor);
    }

    await page.setViewportSize(DESKTOP);
    await waitForRenderedFrame(page);
    const inspectorDismissPoint = await findClearCanvasPoint(page);
    await page.mouse.click(inspectorDismissPoint.x, inspectorDismissPoint.y);
    await expect(page.locator('[data-testid="facility-inspector"]')).toBeHidden();
    await selectTrainThroughPointer(page, flatbedId);
    const emptyPortRoute = await driveWithKeyboardToFacility(
      page,
      flatbedId,
      'port-interchange',
      null,
    );
    expect(emptyPortRoute.visitedTrackUUIDs).toContain(
      regionalRoutes.portTrackUUID,
    );
    await crossFacilityBoundaryWithKeyboard(
      page,
      flatbedId,
      'port-interchange',
      null,
      true,
      true,
      async () => {
        await waitForCargo(page, flatbedId, 'steel', 10, 15_000);
        await returnToCreate(page);
        expect(trainById(await snapshot(page), flatbedId).cargo).toMatchObject({
          productId: 'steel',
          units: 10,
          loadedUnits: 10,
        });
        return 'create';
      },
      { productId: 'steel', units: 10 },
    );
    // Keep both durable checkpoints in Create: resuming merely to select the
    // stopped train would let the Port load another batch before departure.
    expect(trainById(await snapshot(page), flatbedId).cargo).toMatchObject({
      productId: 'steel',
      units: 10,
      loadedUnits: 10,
    });
    await page.keyboard.press('Control+S');
    await expect(page.locator('[data-testid="company-save-state"]'))
      .toHaveText('Saved');
    const lossCheckpoint = (await snapshot(page)).world;
    const lossCheckpointTrackUUID = runtimeById(
      await snapshot(page),
      flatbedId,
    ).trackUUID;
    await reloadSavedWorldFromCreate(page);
    const restoredLossCheckpoint = await snapshot(page);
    expect(stableWorld(restoredLossCheckpoint.world))
      .toEqual(stableWorld(lossCheckpoint));
    expect(runtimeById(restoredLossCheckpoint, flatbedId).trackUUID)
      .toBe(lossCheckpointTrackUUID);
    expect(trainById(restoredLossCheckpoint, flatbedId).cargo).toMatchObject({
      productId: 'steel',
      units: 10,
      loadedUnits: 10,
    });
    await panWorldPointToCentre(
      page,
      runtimeById(restoredLossCheckpoint, flatbedId),
    );
    await enterPlay(page);
    await selectTrainThroughPointer(page, flatbedId);

    await test.step('physical inefficient steel trip records a real loss', async () => {
      const lossOpening = await snapshot(page);
      const lossOpeningTick = lossOpening.world.economy.tick;
      const lossStartedAt = Date.now();
      await moveSelectedTrainClearOfFacility(
        page,
        flatbedId,
        'port-interchange',
        'cement-works',
      );
      await arriveAtFacilityWithoutCheckpoint(
        page,
        flatbedId,
        'cement-works',
        { productId: 'steel', units: 10 },
      );
      // Three return detours require a fourth approach to finish at Prefab.
      // Each drive verifies the real train is stopped outside its access area.
      for (let approach = 1; approach <= 4; approach += 1) {
        await selectTrainThroughPointer(page, flatbedId);
        await driveWithKeyboardToFacility(
          page,
          flatbedId,
          'prefabrication-plant',
          { productId: 'steel', units: 10 },
        );
        const detourState = await snapshot(page);
        const quote = quoteLocalProduct(
          'steel',
          detourState.world.economy.market,
          facility(
            detourState,
            'prefabrication-plant',
          ).inventories.steel,
        );
        if (!quote.ok) {
          throw new Error(`Steel quote unavailable: ${quote.code}`);
        }
        const cost = trainById(
          detourState,
          flatbedId,
        ).operations.currentTripRunningCost;
        const requiredRunningCost = quote.unitPrice * 10 + 200;
        if (cost >= requiredRunningCost) break;
        if (approach === 4) break;
        await arriveAtFacilityWithoutCheckpoint(
          page,
          flatbedId,
          'cement-works',
          { productId: 'steel', units: 10 },
        );
      }
      // Faster approaches can leave the final full detour just short of the
      // loss margin. Accrue the remainder through bounded physical shunts,
      // staying outside the genuine transfer boundary with all ten steel.
      for (let shunt = 0; shunt <= 2; shunt += 1) {
        const shuntState = await snapshot(page);
        const shuntQuote = quoteLocalProduct(
          'steel',
          shuntState.world.economy.market,
          facility(shuntState, 'prefabrication-plant').inventories.steel,
        );
        if (!shuntQuote.ok) {
          throw new Error(`Steel quote unavailable: ${shuntQuote.code}`);
        }
        const shuntCost = trainById(shuntState, flatbedId)
          .operations.currentTripRunningCost;
        const requiredShuntCost = shuntQuote.unitPrice * 10 + 200;
        if (shuntCost >= requiredShuntCost) break;
        if (shunt === 2) {
          throw new Error(JSON.stringify({
            message: 'Bounded physical shunts did not establish a loss margin',
            runningCost: shuntCost,
            requiredRunningCost: requiredShuntCost,
            distance: distanceTo(
              runtimeById(shuntState, flatbedId),
              facility(shuntState, 'prefabrication-plant').railAccess,
            ),
          }));
        }
        await moveSelectedTrainClearOfFacility(
          page,
          flatbedId,
          'prefabrication-plant',
          'cement-works',
          300,
        );
        await driveWithKeyboardToFacility(
          page,
          flatbedId,
          'prefabrication-plant',
          { productId: 'steel', units: 10 },
        );
      }
      const stagedLoss = await snapshot(page);
      const stagedQuote = quoteLocalProduct(
        'steel',
        stagedLoss.world.economy.market,
        facility(stagedLoss, 'prefabrication-plant').inventories.steel,
      );
      if (!stagedQuote.ok) {
        throw new Error(`Steel quote unavailable: ${stagedQuote.code}`);
      }
      expect(trainById(stagedLoss, flatbedId)
        .operations.currentTripRunningCost)
        .toBeGreaterThanOrEqual(stagedQuote.unitPrice * 10);
      const deliveredBefore = trainById(
        stagedLoss,
        flatbedId,
      ).operations.lifetimeDeliveredUnits;
      await crossFacilityBoundaryWithKeyboard(
        page,
        flatbedId,
        'prefabrication-plant',
        { productId: 'steel', units: 10 },
        false,
        true,
        async () => {
          await expect(page.locator('[data-testid="company-last-delivery"]'))
            .toHaveAttribute('data-tone', 'loss');
          await expect(page.locator('[data-testid="company-last-delivery"]'))
            .toContainText('Trip loss');
        },
      );
      // This loss shipment still supplies a real recipe. Depart immediately
      // under held propulsion so its eventual output cannot load into the
      // empty flatbed while menus, saving and reload are exercised.
      expect(trainById(await snapshot(page), flatbedId).cargo).toBeNull();
      await moveSelectedTrainClearOfFacility(
        page,
        flatbedId,
        'prefabrication-plant',
        'port-interchange',
      );
      await expect.poll(async () => runtimeById(await snapshot(page), flatbedId)
        .speedWorldUnitsPerSecond).toBeLessThanOrEqual(0.1);
      const clearedLoss = await snapshot(page);
      const clearedLossRuntime = runtimeById(clearedLoss, flatbedId);
      const prefabAccess = facility(clearedLoss, 'prefabrication-plant').railAccess;
      const clearedLossTrack = clearedLoss.world.tracks.find(
        ({ uuid }) => uuid === clearedLossRuntime.trackUUID,
      );
      if (!clearedLossTrack || clearedLossRuntime.trackT === null) {
        throw new Error('Loss departure has no persistable track geometry');
      }
      const clearedLossPoint = bezierPoint(clearedLossTrack, clearedLossRuntime.trackT);
      expect(distanceTo(clearedLossRuntime, prefabAccess))
        .toBeGreaterThan(prefabAccess.radius + 100);
      expect(distanceTo(clearedLossPoint, prefabAccess))
        .toBeGreaterThan(prefabAccess.radius + 100);
      // The body follows the chord midpoint between bogies; its saved cursor
      // follows the arc. These are distinct valid positions on a curved rail.
      const clearedLossBogie = await stoppedTrainBogieGeometry(page, flatbedId);
      const clearedLossDynamics = clearedLossBogie.dynamics;
      expect(clearedLossDynamics.trackUUID).toBe(clearedLossRuntime.trackUUID);
      expect(distanceTo(clearedLossBogie.arcAnchor, clearedLossPoint)).toBeLessThanOrEqual(0.01);
      expect(distanceTo(clearedLossRuntime, clearedLossBogie.bogieCentre)).toBeLessThanOrEqual(0.01);
      expect(distanceTo(clearedLossBogie.matterBody, prefabAccess))
        .toBeGreaterThan(prefabAccess.radius + 100);
      expect(clearedLossRuntime.derailed).toBe(false);
      expect(clearedLossRuntime.throttle).toBe(0);
      expect(trainById(clearedLoss, flatbedId).cargo).toBeNull();

      await returnToCreate(page);
      const editedLossBogie = await liveTrainBogieGeometry(page, flatbedId);
      expect(editedLossBogie.dynamics).toEqual(clearedLossDynamics);
      expect(distanceTo(editedLossBogie.gameObject, clearedLossBogie.bogieCentre))
        .toBeLessThanOrEqual(0.01);
      expect(distanceTo(editedLossBogie.matterBody, clearedLossBogie.bogieCentre))
        .toBeLessThanOrEqual(0.01);
      await page.keyboard.press('Control+S');
      await expect(page.locator('[data-testid="company-save-state"]')).toHaveText('Saved');
      const outsideLossCheckpoint = (await snapshot(page)).world;
      await reloadSavedWorldFromCreate(page);
      const restoredOutsideLoss = await snapshot(page);
      expect(stableWorld(restoredOutsideLoss.world))
        .toEqual(stableWorld(outsideLossCheckpoint));
      const outsideAuthority = trainById(restoredOutsideLoss, flatbedId);
      expect(outsideAuthority.trackUUID).toBe(clearedLossRuntime.trackUUID);
      expect(outsideAuthority.trackT).toBe(clearedLossRuntime.trackT);
      expect(outsideAuthority.dynamics).toEqual(clearedLossDynamics);
      expect(outsideAuthority.cargo).toBeNull();
      // Create reload restores the saved arc anchor. Play reconstructs the
      // same physical bogie midpoint from that unchanged cursor below.
      await expect.poll(async () => {
        await waitForRenderedFrame(page);
        const geometry = await liveTrainPersistedGeometry(
          page,
          flatbedId,
          outsideAuthority.trackT,
        );
        return {
          trackUUID: geometry.trackUUID,
          curveSynchronized: geometry.curvePoint !== null
            && distanceTo(geometry.curvePoint, clearedLossPoint) <= 0.01,
          matterSynchronized: distanceTo(geometry.matterBody, clearedLossPoint) <= 0.01,
          gameObjectSynchronized: distanceTo(geometry.gameObject, geometry.matterBody) <= 0.01,
          stopped: geometry.speedWorldUnitsPerSecond <= 0.01,
        };
      }, { timeout: 500, intervals: [16, 20, 25] }).toEqual({
        trackUUID: outsideAuthority.trackUUID,
        curveSynchronized: true,
        matterSynchronized: true,
        gameObjectSynchronized: true,
        stopped: true,
      });
      const restoredOutsideGeometry = await liveTrainPersistedGeometry(
        page,
        flatbedId,
        outsideAuthority.trackT,
      );
      expect(distanceTo(restoredOutsideGeometry.curvePoint!, clearedLossPoint))
        .toBeLessThanOrEqual(0.01);
      expect(distanceTo(restoredOutsideGeometry.matterBody, clearedLossPoint))
        .toBeLessThanOrEqual(0.01);
      expect(distanceTo(restoredOutsideGeometry.gameObject, restoredOutsideGeometry.matterBody))
        .toBeLessThanOrEqual(0.01);
      expect(distanceTo(restoredOutsideGeometry.matterBody, prefabAccess))
        .toBeGreaterThan(prefabAccess.radius + 100);
      await panWorldPointToCentre(
        page,
        runtimeById(await snapshot(page), flatbedId),
      );
      await enterPlay(page);
      const resumedLossBogie = await stoppedTrainBogieGeometry(page, flatbedId);
      expect(resumedLossBogie.dynamics).toEqual(clearedLossDynamics);
      expect(distanceTo(resumedLossBogie.arcAnchor, clearedLossPoint)).toBeLessThanOrEqual(0.01);
      expect(distanceTo(resumedLossBogie.bogieCentre, clearedLossBogie.bogieCentre))
        .toBeLessThanOrEqual(0.01);
      expect(distanceTo(resumedLossBogie.gameObject, clearedLossBogie.bogieCentre))
        .toBeLessThanOrEqual(0.01);
      expect(distanceTo(resumedLossBogie.matterBody, clearedLossBogie.bogieCentre))
        .toBeLessThanOrEqual(0.01);
      expect(distanceTo(resumedLossBogie.matterBody, prefabAccess))
        .toBeGreaterThan(prefabAccess.radius + 100);
      await expect.poll(async () => trainById(
        await snapshot(page),
        flatbedId,
      ).operations.lifetimeDeliveredUnits, {
        timeout: 30_000,
        intervals: [100, 250, 500],
      }).toBe(deliveredBefore + 10);
      const lossState = await snapshot(page);
      const lossOperations = trainById(lossState, flatbedId).operations;
      expect(lossOperations.lastTripRevenue).toBeGreaterThan(0);
      expect(
        lossOperations.lastTripRevenue
          - lossOperations.lastTripRunningCost,
      ).toBeLessThanOrEqual(0);
      expect(lossState.world.freightProgress
        .profitableSteelDeliveryCompleted).toBe(false);
      await expectRegionalObjectiveDom(page, 'Supply regional construction', {
        'connect-port': 'complete',
        'deliver-steel-profitably': 'current',
        'assemble-building-modules': 'pending',
        'connect-town': 'pending',
        'deliver-building-modules-profitably': 'pending',
      });
      await assertInactiveTrainsParked(
        page,
        [aggregateId, cementId],
        parkingTail.tailTrackUUIDs,
      );
      const lossEnding = await snapshot(page);
      const lossWallElapsedMs = Date.now() - lossStartedAt;
      const lossEconomySeconds =
        lossEnding.world.economy.tick - lossOpeningTick;
      expect(lossWallElapsedMs).toBeLessThanOrEqual(600_000);
      expect(lossEconomySeconds).toBeLessThanOrEqual(600);
      await writeRegionalCheckpoint(testInfo, 'outside-loss', restoredOutsideLoss.world);
      console.info(JSON.stringify({
        regionalMilestone: 'loss-complete',
        tick: lossEnding.world.economy.tick,
        tripProfit: lossOperations.lastTripRevenue - lossOperations.lastTripRunningCost,
        wallElapsedMs: lossWallElapsedMs,
        economySeconds: lossEconomySeconds,
      }));
    }, { timeout: 600_000 });

    await arriveAtFacilityWithoutCheckpoint(
      page,
      flatbedId,
      'port-interchange',
      null,
      true,
    );
    await waitForCargo(page, flatbedId, 'steel', 60);
    await returnToCreate(page);
    const afterLossProduction = await snapshot(page);
    const lossPrefab = facility(afterLossProduction, 'prefabrication-plant');
    expect(lossPrefab.inventories['structural-timber'].quantity).toBe(52);
    expect(lossPrefab.inventories.cement.quantity).toBe(72);
    expect(lossPrefab.inventories.steel.quantity).toBe(4);
    expect(lossPrefab.inventories['building-modules'].quantity).toBe(4);
    assertModuleProductionConservation(afterLossProduction, productionOpening, 10, 1);
    await page.keyboard.press('Control+S');
    await expect(page.locator('[data-testid="company-save-state"]'))
      .toHaveText('Saved');
    const loadedCheckpoint = (await snapshot(page)).world;
    const loadedTrackUUID = runtimeById(
      await snapshot(page),
      flatbedId,
    ).trackUUID;
    await reloadSavedWorldFromCreate(page);
    let current = await snapshot(page);
    expect(stableWorld(current.world)).toEqual(stableWorld(loadedCheckpoint));
    expect(runtimeById(current, flatbedId).trackUUID)
      .toBe(loadedTrackUUID);
    await writeRegionalCheckpoint(testInfo, 'loaded-steel-60', current.world);
    console.info(JSON.stringify({
      regionalMilestone: 'loaded-steel-checkpoint',
      tick: current.world.economy.tick,
      cargo: trainById(current, flatbedId).cargo,
    }));

    await enterPlay(page);
    await selectTrainThroughPointer(page, flatbedId);
    const steelRoute = await driveWithKeyboardToFacility(
      page,
      flatbedId,
      'prefabrication-plant',
      { productId: 'steel', units: 60 },
    );
    expect(steelRoute.visitedTrackUUIDs.length).toBeGreaterThan(0);
    // The live economy may complete the delivery as soon as the train crosses
    // the genuine access boundary. Capture its baseline before that event.
    const steelDeliveredBefore = trainById(
      await snapshot(page),
      flatbedId,
    ).operations.lifetimeDeliveredUnits;
    await crossFacilityBoundaryWithKeyboard(
      page,
      flatbedId,
      'prefabrication-plant',
      { productId: 'steel', units: 60 },
      true,
      true,
      async () => {
        await clickFacilityThroughPointer(page, 'prefabrication-plant');
        for (const factor of [
          'Global construction',
          'Regional demand',
          'Inventory pressure',
        ]) {
          await expect(page.locator('[data-testid="facility-quotes"]'))
            .toContainText(factor);
        }
        await expect.poll(
          () => page.locator('[data-testid="facility-status"]').textContent(),
          { timeout: 15_000, intervals: [50, 100, 250] },
        ).toMatch(/Working [1-5] \/ 6 ticks/);
        await expect(page.locator('[data-testid="company-last-delivery"]'))
          .toContainText('Steel delivered to Prefabrication Plant', {
            timeout: 30_000,
          });
        await expect(page.locator('[data-testid="company-last-delivery"]'))
          .toContainText('Running');
        await expect(page.locator('[data-testid="company-last-delivery"]'))
          .toContainText('Trip profit');
      },
    );
    await enterPlay(page);
    await expect.poll(async () => {
      current = await snapshot(page);
      const prefab = facility(current, 'prefabrication-plant');
      const cargo = trainById(current, flatbedId).cargo;
      return {
        delivered: trainById(
          current,
          flatbedId,
        ).operations.lifetimeDeliveredUnits,
        recipeProgressTicks: prefab.recipeProgressTicks,
        timber: prefab.inventories['structural-timber'].quantity,
        cement: prefab.inventories.cement.quantity,
        steel: prefab.inventories.steel.quantity,
        modules: prefab.inventories['building-modules'].quantity,
        cargo: cargo && {
          productId: cargo.productId,
          units: cargo.units,
          loadedUnits: cargo.loadedUnits,
        },
      };
    }, {
      timeout: 60_000,
      intervals: [100, 250, 500],
    }).toEqual({
      delivered: steelDeliveredBefore + 60,
      recipeProgressTicks: 0,
      timber: 4,
      cement: 24,
      steel: 28,
      modules: 24,
      cargo: { productId: 'building-modules', units: 4, loadedUnits: 4 },
    });
    // Both steel deliveries are useful inputs regardless of profitability.
    // Sixty timber limits seventy steel and eighty cement to seven batches:
    // twenty-four modules remain here and four fill the departing flatbed.
    assertModuleProductionConservation(current, productionOpening, 10 + 60, 7);
    expect(current.world.freightProgress
      .profitableSteelDeliveryCompleted).toBe(true);
    expect(facility(
      current,
      'prefabrication-plant',
    ).inventories['building-modules'].quantity).toBe(24);
    expect(current.objective.steps).toEqual([
      expect.objectContaining({ id: 'connect-port', state: 'complete' }),
      expect.objectContaining({
        id: 'deliver-steel-profitably',
        state: 'complete',
      }),
      expect.objectContaining({
        id: 'assemble-building-modules',
        state: 'complete',
      }),
      expect.objectContaining({ id: 'connect-town', state: 'complete' }),
      expect.objectContaining({
        id: 'deliver-building-modules-profitably',
        state: 'current',
      }),
    ]);
    await expectRegionalObjectiveDom(page, 'Supply regional construction', {
      'connect-port': 'complete',
      'deliver-steel-profitably': 'complete',
      'assemble-building-modules': 'complete',
      'connect-town': 'complete',
      'deliver-building-modules-profitably': 'current',
    });
    await assertInactiveTrainsParked(
      page,
      [aggregateId, cementId],
      parkingTail.tailTrackUUIDs,
    );

    await waitForCargo(page, flatbedId, 'building-modules', 4, 30_000);
    console.info(JSON.stringify({
      regionalMilestone: 'seven-batches-complete',
      tick: current.world.economy.tick,
      timber: facility(current, 'prefabrication-plant').inventories['structural-timber'].quantity,
      cement: facility(current, 'prefabrication-plant').inventories.cement.quantity,
      steel: facility(current, 'prefabrication-plant').inventories.steel.quantity,
      storedModules: facility(current, 'prefabrication-plant').inventories['building-modules'].quantity,
      cargo: trainById(current, flatbedId).cargo,
    }));
    await returnToCreate(page);
    await page.keyboard.press('Control+S');
    await expect(page.locator('[data-testid="company-save-state"]'))
      .toHaveText('Saved');
    const moduleCheckpoint = (await snapshot(page)).world;
    await reloadSavedWorldFromCreate(page);
    const restoredModules = await snapshot(page);
    expect(stableWorld(restoredModules.world))
      .toEqual(stableWorld(moduleCheckpoint));
    expect(trainById(restoredModules, flatbedId).cargo).toMatchObject({
      productId: 'building-modules',
      units: 4,
      loadedUnits: 4,
    });
    await writeRegionalCheckpoint(testInfo, 'loaded-modules-4', restoredModules.world);

    await enterPlay(page);
    await selectTrainThroughPointer(page, flatbedId);
    await page.setViewportSize(MOBILE);
    await waitForRenderedFrame(page);
    const trainInspector = page.locator('[data-testid="train-inspector"]');
    await expect(trainInspector).toHaveAttribute('data-layout', 'mobile');
    await expect(trainInspector)
      .toContainText('Building Modules 4 / 4 modules');
    for (const selector of [
      '[data-throttle="-1"]',
      '[data-throttle="0"]',
      '[data-throttle="1"]',
    ]) {
      await expect(page.locator(selector)).toBeVisible();
    }
    let mobileStableSamples = 0;
    const mobileOpeningTrackUUID = runtimeById(
      await snapshot(page),
      flatbedId,
    ).trackUUID;
    await expect.poll(async () => {
      const runtime = runtimeById(await snapshot(page), flatbedId);
      mobileStableSamples = runtime.speedWorldUnitsPerSecond <= 2
        ? mobileStableSamples + 1
        : 0;
      return {
        derailed: runtime.derailed,
        stable: mobileStableSamples >= 3,
        trackUUID: runtime.trackUUID,
      };
    }, {
      timeout: 10_000,
      intervals: [16, 20, 25],
    }).toEqual({
      derailed: false,
      stable: true,
      trackUUID: mobileOpeningTrackUUID,
    });
    const beforeMobileState = await snapshot(page);
    const beforeMobileCommand = runtimeById(beforeMobileState, flatbedId);
    const townAccess = facility(
      beforeMobileState,
      'town-construction-market',
    ).railAccess;
    const activeThrottle = keyToward(
      beforeMobileState,
      beforeMobileCommand,
      townAccess,
    ) === 'w' ? 1 : -1;
    const activeKey = activeThrottle === 1 ? 'w' : 's';
    await page.keyboard.down(activeKey);
    await expect.poll(async () => runtimeById(
      await snapshot(page),
      flatbedId,
    ).speedWorldUnitsPerSecond, {
      timeout: 10_000,
      intervals: [50, 75, 100],
    }).toBeGreaterThan(8);
    await page.keyboard.up(activeKey);
    const mobileCanvasBox = await page.locator('canvas').boundingBox();
    if (!mobileCanvasBox) throw new Error('Canvas is not visible');
    const touchButtonSize = Math.max(
      44,
      Math.min(120, Math.round(MOBILE.width * 0.15)),
    );
    const touchMargin = Math.round(MOBILE.width * 0.04);
    const touchButtonX = MOBILE.width
      - touchMargin
      - touchButtonSize / 2;
    const touchButtonY = activeThrottle === 1
      ? MOBILE.height - touchMargin - touchButtonSize * 2 - 10
      : MOBILE.height - touchMargin - touchButtonSize / 2;
    const touchPoint = {
      x: mobileCanvasBox.x
        + touchButtonX * mobileCanvasBox.width / MOBILE.width,
      y: mobileCanvasBox.y
        + touchButtonY * mobileCanvasBox.height / MOBILE.height,
    };
    const cdp = await page.context().newCDPSession(page);
    let heldTouchSamples = 0;
    try {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [touchPoint],
      });
      await expect.poll(async () => {
        const runtime = runtimeById(await snapshot(page), flatbedId);
        heldTouchSamples = runtime.throttle === activeThrottle
          ? heldTouchSamples + 1
          : 0;
        return {
          held: heldTouchSamples >= 3,
          derailed: runtime.derailed,
          trackUUID: runtime.trackUUID,
        };
      }, {
        timeout: 5_000,
        intervals: [20, 30, 50],
      }).toEqual({
        held: true,
        derailed: false,
        trackUUID: mobileOpeningTrackUUID,
      });
    } finally {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await cdp.detach();
    }
    await expect.poll(async () => {
      const runtime = runtimeById(await snapshot(page), flatbedId);
      return {
        throttle: runtime.throttle,
        coasting: runtime.speedWorldUnitsPerSecond > 2,
        derailed: runtime.derailed,
        trackUUID: runtime.trackUUID,
      };
    }, {
      timeout: 5_000,
      intervals: [20, 30, 50],
    }).toEqual({
      throttle: 0,
      coasting: true,
      derailed: false,
      trackUUID: mobileOpeningTrackUUID,
    });
    await page.locator('[data-throttle="0"]').tap();
    await expect(page.locator('[data-throttle="0"]'))
      .toHaveAttribute('aria-pressed', 'true');
    await expect.poll(
      async () => {
        const runtime = runtimeById(await snapshot(page), flatbedId);
        return {
          throttle: runtime.throttle,
          stopped: runtime.speedWorldUnitsPerSecond <= 2,
          derailed: runtime.derailed,
          trackUUID: runtime.trackUUID,
        };
      },
    ).toEqual({
      throttle: 0,
      stopped: true,
      derailed: false,
      trackUUID: mobileOpeningTrackUUID,
    });
    const afterMobileCommand = runtimeById(
      await snapshot(page),
      flatbedId,
    );
    expect(distanceTo(beforeMobileCommand, afterMobileCommand))
      .toBeGreaterThan(0);
    expect(trainById(await snapshot(page), flatbedId).cargo).toMatchObject({
      productId: 'building-modules',
      units: 4,
    });
    await page.setViewportSize(DESKTOP);
    await waitForRenderedFrame(page);
    const moduleRoute = await driveWithKeyboardToFacility(
      page,
      flatbedId,
      'town-construction-market',
      { productId: 'building-modules', units: 4 },
    );
    expect(moduleRoute.visitedTrackUUIDs.length).toBeGreaterThan(0);
    const moduleDeliveredBefore = trainById(
      await snapshot(page),
      flatbedId,
    ).operations.lifetimeDeliveredUnits;
    await armTownDeliveryDomWitness(page);
    try {
      await crossFacilityBoundaryWithKeyboard(
        page,
        flatbedId,
        'town-construction-market',
        { productId: 'building-modules', units: 4 },
        true,
        true,
        async () => {
          try {
            await Promise.all([
              expect.poll(() => page.evaluate(() => {
                const capture = (window as TownDeliveryDomWindow)
                  .__railSimTownDeliveryDomCapture;
                return capture && {
                  witness: capture.witness,
                  latest: capture.latest,
                  expired: capture.expired,
                };
              }), { timeout: 5_000, intervals: [25, 50, 100] }).toMatchObject({
                witness: {
                  deliveryText: expect.stringContaining(
                    'Building Modules delivered to Town Construction Market',
                  ),
                  statusText: 'Unloading',
                  batchText: 'Batch 4 / 4 modules',
                },
                expired: false,
              }),
              expect(page.locator('[data-testid="company-last-delivery"]'))
                .toContainText('Building Modules delivered to Town Construction Market'),
              expect(page.locator('[data-testid="company-last-delivery"]'))
                .toContainText('Running'),
              expect(page.locator('[data-testid="company-last-delivery"]'))
                .toContainText('Trip profit'),
            ]);
          } finally {
            await disposeTownDeliveryDomWitness(page);
          }
        },
      );
    } finally {
      await disposeTownDeliveryDomWitness(page);
    }
    await enterPlay(page);
    await selectTrainThroughPointer(page, flatbedId);
    await page.setViewportSize(MOBILE);
    await waitForRenderedFrame(page);
    await expect(trainInspector).toHaveAttribute('data-layout', 'mobile');
    await expect.poll(async () => {
      current = await snapshot(page);
      return {
        delivered: trainById(
          current,
          flatbedId,
        ).operations.lifetimeDeliveredUnits,
        cargo: trainById(current, flatbedId).cargo,
        townModules: facility(
          current,
          'town-construction-market',
        ).inventories['building-modules'].quantity,
      };
    }, {
      timeout: 30_000,
      intervals: [100, 250, 500],
    }).toEqual({
      delivered: moduleDeliveredBefore + 4,
      cargo: null,
      townModules: 4,
    });
    expect(trainById(current, flatbedId).cargo).toBeNull();
    expect(facility(
      current,
      'town-construction-market',
    ).inventories['building-modules'].quantity).toBe(4);
    expect(facility(current, 'prefabrication-plant')
      .inventories['building-modules'].quantity).toBe(24);
    assertModuleProductionConservation(current, productionOpening, 10 + 60, 7);
    expect(current.world.freightProgress).toMatchObject({
      profitableSteelDeliveryCompleted: true,
      profitableBuildingModuleDeliveryCompleted: true,
    });
    expect(current.objective).toMatchObject({
      id: 'regional-construction-supply',
      achieved: true,
      status: 'Regional construction supplied · Network ready to automate',
    });
    expect(current.objective.steps.map(({ id, state }) => ({ id, state })))
      .toEqual([
        { id: 'connect-port', state: 'complete' },
        { id: 'deliver-steel-profitably', state: 'complete' },
        { id: 'assemble-building-modules', state: 'complete' },
        { id: 'connect-town', state: 'complete' },
        {
          id: 'deliver-building-modules-profitably',
          state: 'complete',
        },
      ]);
    await expectRegionalObjectiveDom(
      page,
      'Regional construction supplied · Network ready to automate',
      {
        'connect-port': 'complete',
        'deliver-steel-profitably': 'complete',
        'assemble-building-modules': 'complete',
        'connect-town': 'complete',
        'deliver-building-modules-profitably': 'complete',
      },
    );
    const moduleOperations = trainById(current, flatbedId).operations;
    await expect(page.locator('[data-testid="train-last-delivery-profit"]'))
      .toHaveText(CASH.format(
        moduleOperations.lastTripRevenue
          - moduleOperations.lastTripRunningCost,
      ));
    expect(current.world.company.cash).toBe(
      current.world.company.ledger.reduce(
        (total, entry) => total + entry.amount,
        0,
      ),
    );
    expect(current.world.company.cash).toBeGreaterThan(
      openingCash
      - categoryMagnitude(current, 'construction-capex')
      - categoryMagnitude(current, 'vehicle-capex')
      - categoryMagnitude(current, 'train-running-cost'),
    );
    await assertInactiveTrainsParked(
      page,
      [aggregateId, cementId],
      parkingTail.tailTrackUUIDs,
    );

    await page.keyboard.press('Escape');
    console.info(JSON.stringify({
      regionalMilestone: 'town-complete',
      tick: current.world.economy.tick,
      townModules: facility(current, 'town-construction-market').inventories['building-modules'].quantity,
      tripProfit: moduleOperations.lastTripRevenue - moduleOperations.lastTripRunningCost,
      objectiveAchieved: current.objective.achieved,
    }));
    for (const selector of [
      '[data-testid="company-hud"]',
      '[data-testid="train-inspector"]',
      '[data-testid="freight-objective"]',
    ]) {
      await expect(page.locator(selector)).toBeHidden();
    }
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas is not visible');
    await canvas.click({
      position: { x: box.width / 2, y: box.height * 0.56 },
    });
    await expect(page.locator('[data-testid="freight-objective"]'))
      .toBeVisible();
    await page.keyboard.press('p');
    const clearPoint = await findClearCanvasPoint(page);
    await page.mouse.move(clearPoint.x, clearPoint.y);
    await page.mouse.down();
    await page.mouse.move(clearPoint.x + 20, clearPoint.y, { steps: 4 });
    expect((await snapshot(page)).construction.phase).toBe('dragging');
    await page.mouse.up();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

});
