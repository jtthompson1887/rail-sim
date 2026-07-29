import {
  expect,
  test,
  type Page,
  type ViewportSize,
} from '@playwright/test';
import type { FirstRouteBrowserSnapshot } from '../../src/scenes/WorldScene';
import type { TrackTopologySnapshot } from '../../src/managers/TrackManager';
import { queryRailAccessConnectivity } from '../../src/freight/RailAccessConnectivity';
import type {
  ConstructionPreviewModel,
  ConstructionToolPhase,
} from '../../src/ui/ConstructionPreviewOverlay';
import { worldToCameraPoint } from './helpers/CameraCoordinates';

const DESKTOP = { width: 1920, height: 1400 };
const MOBILE = { width: 375, height: 667 };
const MOBILE_LANDSCAPE = { width: 667, height: 375 };
const REGIONAL_DEVELOPMENT_GRANT = 250_000;
const FLATBED_PRICE = 90_000;
const OPERATING_RESERVE = 20_000;
const DEVELOPMENT_GRANT_REFERENCE =
  'regional-development-grant:v1';
const CASH = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

interface Point {
  readonly x: number;
  readonly y: number;
}

interface CanvasBounds extends Point {
  readonly width: number;
  readonly height: number;
}

const rectanglesOverlap = (
  first: CanvasBounds,
  second: CanvasBounds,
): boolean => first.x < second.x + second.width
  && first.x + first.width > second.x
  && first.y < second.y + second.height
  && first.y + first.height > second.y;

const canvasDragCandidates = (canvas: CanvasBounds): Point[] => {
  const preferred = [
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.65 },
    { x: 0.4, y: 0.6 },
    { x: 0.6, y: 0.6 },
    { x: 0.5, y: 0.75 },
  ].map((ratio) => ({
    x: canvas.x + canvas.width * ratio.x,
    y: canvas.y + canvas.height * ratio.y,
  }));
  const axis = (start: number, length: number): number[] => {
    const values: number[] = [];
    for (let offset = 8; offset <= length - 8; offset += 24) {
      values.push(start + offset);
    }
    values.push(start + length - 8);
    return [...new Set(values)];
  };
  const grid = axis(canvas.y, canvas.height).flatMap((y) =>
    axis(canvas.x, canvas.width).map((x) => ({ x, y })));
  const unique = new Map<string, Point>();
  [...preferred, ...grid].forEach((point) => {
    unique.set(`${point.x.toFixed(2)}:${point.y.toFixed(2)}`, point);
  });
  return [...unique.values()];
};

const dragPathClearsPoints = (
  origin: Point,
  offset: Point,
  blockedPoints: readonly Point[],
): boolean => blockedPoints.every((blocked) => {
  for (let step = 0; step <= 8; step += 1) {
    const ratio = step / 8;
    if (Math.hypot(
      origin.x + offset.x * ratio - blocked.x,
      origin.y + offset.y * ratio - blocked.y,
    ) <= 80) return false;
  }
  return true;
});

const interactiveMapPoints = (
  state: StructuralBrowserSnapshot,
  canvas: CanvasBounds,
): Point[] => [
  ...state.runtime,
  ...state.world.economy.facilities,
].map((point) => {
  const internal = worldToCameraPoint(point, state.camera);
  return {
    x: canvas.x + internal.x * canvas.width / state.camera.width,
    y: canvas.y + internal.y * canvas.height / state.camera.height,
  };
});

const findCanvasDragOrigin = async (
  page: Page,
  candidates: readonly Point[],
  offset: Point,
): Promise<{
  origin: Point | null;
  coverage: Readonly<Record<string, number>>;
}> => page.evaluate(({ points, dragOffset }) => {
  const coverage: Record<string, number> = {};
  const editorUI = window.__railSimGame.scene.getScene(
    'EditorUIScene',
  ) as unknown as {
    containsScreenPoint(x: number, y: number): boolean;
  };
  const phaserOverlays = window.__railSimGame.scene.getScenes(true)
    .filter((scene) => scene.scene.key !== 'WorldScene')
    .flatMap((scene) => scene.children.list.map((object) => ({
      object: object as unknown as {
        active?: boolean;
        visible?: boolean;
        input?: { enabled?: boolean } | null;
        getBounds?: () => {
          left: number;
          right: number;
          top: number;
          bottom: number;
        };
      },
      sceneKey: scene.scene.key,
    })));
  for (const point of points) {
    let blocked = false;
    let blocker: Element | null = null;
    let blockerLabel: string | null = null;
    for (let step = 0; step <= 8; step += 1) {
      const ratio = step / 8;
      const x = point.x + dragOffset.x * ratio;
      const y = point.y + dragOffset.y * ratio;
      if (editorUI.containsScreenPoint(x, y)) {
        blocked = true;
        blockerLabel = 'editor-ui';
        break;
      }
      const phaserOverlay = phaserOverlays.find(({ object }) => {
        if (
          object.active === false
          || object.visible === false
          || object.input?.enabled !== true
          || typeof object.getBounds !== 'function'
        ) return false;
        const bounds = object.getBounds();
        return x >= bounds.left && x <= bounds.right
          && y >= bounds.top && y <= bounds.bottom;
      });
      if (phaserOverlay) {
        blocked = true;
        blockerLabel = `phaser:${phaserOverlay.sceneKey}`;
        break;
      }
      const element = document.elementFromPoint(
        x,
        y,
      );
      if (!(element instanceof HTMLCanvasElement)) {
        blocked = true;
        blocker = element;
        break;
      }
    }
    if (!blocked) return { origin: point, coverage };
    if (blockerLabel) {
      coverage[blockerLabel] = (coverage[blockerLabel] ?? 0) + 1;
      continue;
    }
    if (blocker === null) {
      coverage['outside-viewport'] =
        (coverage['outside-viewport'] ?? 0) + 1;
      continue;
    }
    const testId = blocker instanceof HTMLElement
      ? blocker.dataset.testid
      : undefined;
    const label = testId
      ? `${blocker.tagName.toLowerCase()}[data-testid="${testId}"]`
      : blocker.tagName.toLowerCase();
    coverage[label] = (coverage[label] ?? 0) + 1;
  }
  return { origin: null, coverage };
}, {
  points: candidates,
  dragOffset: offset,
});

interface StructuralBrowserSnapshot extends FirstRouteBrowserSnapshot {
  readonly construction: {
    readonly phase: ConstructionToolPhase;
    readonly preview: ConstructionPreviewModel | null;
    readonly topology: TrackTopologySnapshot;
  };
}

interface SeedCase {
  readonly seed: string;
  readonly viewport: ViewportSize;
}

type TrainState = FirstRouteBrowserSnapshot['world']['trains'][number];
type RuntimeState = FirstRouteBrowserSnapshot['runtime'][number];
type FacilityState =
  FirstRouteBrowserSnapshot['world']['economy']['facilities'][number];
type TrackState = FirstRouteBrowserSnapshot['world']['tracks'][number];

const SEEDS: readonly SeedCase[] = [
  { seed: 'playtest-753', viewport: DESKTOP },
  { seed: 'real-terrain-alpha', viewport: DESKTOP },
  { seed: 'first-route-browser-gamma', viewport: MOBILE },
];

declare global {
  interface Window {
    __railSimFirstRouteHarness?: {
      snapshot(): FirstRouteBrowserSnapshot;
    };
    __railSimScene?: string;
  }
}

const snapshot = async (page: Page): Promise<StructuralBrowserSnapshot> =>
  page.evaluate(() => {
    const harness = window.__railSimFirstRouteHarness;
    if (!harness) throw new Error('Structural-timber snapshot is unavailable');
    return harness.snapshot() as StructuralBrowserSnapshot;
  });

const facility = (
  state: StructuralBrowserSnapshot,
  definitionId: string,
) => {
  const result = state.world.economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!result) throw new Error(`Missing ${definitionId}`);
  return result;
};

const categoryTotal = (
  state: StructuralBrowserSnapshot,
  category: string,
): number => state.world.company.ledger
  .filter((entry) => entry.category === category)
  .reduce((total, entry) => total + Math.abs(entry.amount), 0);

const trainById = (
  state: StructuralBrowserSnapshot,
  trainId: string,
): TrainState => {
  const result = state.world.trains.find(({ id }) => id === trainId);
  if (!result) throw new Error(`Missing train ${trainId}`);
  return result;
};

const runtimeById = (
  state: StructuralBrowserSnapshot,
  trainId: string,
): RuntimeState => {
  const result = state.runtime.find(({ trainId: id }) => id === trainId);
  if (!result) throw new Error(`Missing runtime ${trainId}`);
  return result;
};

const distanceTo = (point: Point, target: Point): number => Math.hypot(
  point.x - target.x,
  point.y - target.y,
);

const topologyKey = (
  node: { readonly kind: 'track' | 'junction'; readonly uuid: string },
): string => `${node.kind}:${node.uuid}`;

const expectConnectedFacilityPath = (
  state: StructuralBrowserSnapshot,
  sourceDefinitionId: string,
  destinationDefinitionId: string,
  expectedTrackUUIDs?: readonly string[],
): void => {
  const byKey = new Map(
    state.construction.topology.map((node) => [topologyKey(node), node]),
  );
  for (const node of state.construction.topology) {
    for (const reference of [node.previous, node.next]) {
      if (!reference) continue;
      const neighbour = byKey.get(topologyKey(reference));
      expect(neighbour).toBeDefined();
      expect([neighbour?.previous, neighbour?.next].some(
        (candidate) => candidate
          && topologyKey(candidate) === topologyKey(node),
      )).toBe(true);
    }
  }
  const result = queryRailAccessConnectivity(
    state.world.tracks,
    state.construction.topology,
    facility(state, sourceDefinitionId).railAccess,
    facility(state, destinationDefinitionId).railAccess,
  );
  expect(result.sourceEndpointTrackUUIDs.length).toBeGreaterThan(0);
  expect(result.destinationEndpointTrackUUIDs.length).toBeGreaterThan(0);
  expect(result.connected).toBe(true);
  if (expectedTrackUUIDs) {
    expect(new Set(result.connectedTrackUUIDs)).toEqual(
      new Set(expectedTrackUUIDs),
    );
  }
};

const tangentAt = (track: TrackState, t: number): Point => {
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
  state: StructuralBrowserSnapshot,
  runtime: RuntimeState,
  target: Point,
): 'w' | 's' => {
  const track = state.world.tracks.find(
    ({ uuid }) => uuid === runtime.trackUUID,
  );
  if (!track || runtime.trackT === null) return 'w';
  const tangent = tangentAt(track, runtime.trackT);
  const forwardDot = runtime.facing * (
    tangent.x * (target.x - runtime.x)
    + tangent.y * (target.y - runtime.y)
  );
  return forwardDot >= 0 ? 'w' : 's';
};

const oppositeKey = (key: 'w' | 's'): 'w' | 's' =>
  key === 'w' ? 's' : 'w';

const signedLedgerSum = (
  state: StructuralBrowserSnapshot,
  startingEntryCount: number,
): number => state.world.company.ledger
  .slice(startingEntryCount)
  .reduce((sum, entry) => sum + entry.amount, 0);

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
): Promise<StructuralBrowserSnapshot> {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  // Generated menu preview initialization is outside timed gameplay.
  await page.waitForFunction(
    () => window.__railSimScene === 'MenuScene',
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.press('Enter');
  const canvas = page.locator('canvas');
  const pickerPanelHeight = Math.min(690, viewport.height - 40);
  const pickerSeedY = viewport.height / 2 - pickerPanelHeight / 2 + 126;
  const pickerConfirmY =
    viewport.height / 2 + pickerPanelHeight / 2 - 44;
  await canvas.click({
    position: { x: viewport.width / 2, y: viewport.height - 90 },
  });
  page.once('dialog', (dialog) => dialog.accept(seed));
  await canvas.click({
    position: { x: viewport.width / 2, y: pickerSeedY },
  });
  await canvas.click({
    position: { x: viewport.width / 2, y: pickerConfirmY },
  });
  await waitForHarness(page);

  const created = await snapshot(page);
  expect(created.world.schemaVersion).toBe(10);
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
  state: StructuralBrowserSnapshot,
): Promise<Point> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Canvas is not visible');
  const internal = worldToCameraPoint(point, state.camera);
  return {
    x: canvas.x + internal.x * canvas.width / state.camera.width,
    y: canvas.y + internal.y * canvas.height / state.camera.height,
  };
}

async function dragTrack(
  page: Page,
  start: Point,
  end: Point,
): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();
}

async function buildCheapestStarter(
  page: Page,
): Promise<StructuralBrowserSnapshot> {
  const opening = await snapshot(page);
  const mobile = opening.camera.width <= 720;
  const selected = [...opening.world.starterOpportunity.corridors]
    .sort((left, right) => left.estimatedCost - right.estimatedCost
      || left.id.localeCompare(right.id))[0];
  if (!selected) throw new Error('No starter corridor was generated');
  expect(selected.estimatedCost + 90_000 + 20_000)
    .toBeLessThanOrEqual(opening.world.company.cash);

  for (const segment of selected.feasibilityWitness.segments) {
    await panWorldPointToCentre(page, {
      x: (segment.geometry.p0.x + segment.geometry.p3.x) / 2,
      y: (segment.geometry.p0.y + segment.geometry.p3.y) / 2,
    }, { x: 0.5, y: mobile ? 0.57 : 0.4 });
    await page.keyboard.press('p');
    const current = await snapshot(page);
    const startScreen = await toPagePoint(
      page,
      segment.geometry.p0,
      current,
    );
    const endScreen = await toPagePoint(
      page,
      segment.geometry.p3,
      current,
    );
    if (mobile) {
      const dragStart = await findCanvasDragOrigin(
        page,
        [startScreen],
        { x: 0, y: 0 },
      );
      expect(
        dragStart.origin,
        `construction pointer-down must clear mobile UI; coverage ${
          JSON.stringify(dragStart.coverage)
        }`,
      ).toEqual(startScreen);
    }
    await dragTrack(
      page,
      startScreen,
      endScreen,
    );
    const confirm = page.locator('[data-testid="construction-confirm"]');
    if (mobile) {
      for (const selector of [
        '[data-testid="construction-inspector"]',
        '[data-testid="construction-actions"]',
        '[data-testid="construction-confirm"]',
      ]) {
        await assertVisibleWithinViewport(page, selector);
      }
    }
    if (!await confirm.isEnabled()) {
      const startScreen = await toPagePoint(
        page,
        segment.geometry.p0,
        current,
      );
      const endScreen = await toPagePoint(
        page,
        segment.geometry.p3,
        current,
      );
      throw new Error(JSON.stringify({
        startScreen,
        endScreen,
        camera: current.camera,
        preview: (await snapshot(page)).construction,
        elements: await page.evaluate(({ start, end }) => ({
          start: document.elementFromPoint(start.x, start.y)?.outerHTML,
          end: document.elementFromPoint(end.x, end.y)?.outerHTML,
        }), { start: startScreen, end: endScreen }),
      }));
    }
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.locator('[data-testid="company-save-state"]'))
      .toHaveText('Saved');
  }

  const built = await snapshot(page);
  expect(categoryTotal(built, 'construction-capex'))
    .toBe(selected.estimatedCost);
  expect(built.world.tracks).toHaveLength(
    selected.feasibilityWitness.segments.length,
  );
  return built;
}

const nearestEndpoint = (
  state: StructuralBrowserSnapshot,
  target: Point,
): Point => {
  const endpoint = state.world.tracks.flatMap((track) => [
    track.p0,
    track.p3,
  ]).sort((left, right) => (
    Math.hypot(left.x - target.x, left.y - target.y)
    - Math.hypot(right.x - target.x, right.y - target.y)
  ))[0];
  if (!endpoint) throw new Error('No player track endpoint exists');
  return endpoint;
};

const bezierPoint = (
  track: StructuralBrowserSnapshot['world']['tracks'][number],
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

const placementInsideAccess = (
  state: StructuralBrowserSnapshot,
  access: Point & { readonly radius: number },
): {
  track: StructuralBrowserSnapshot['world']['tracks'][number];
  point: Point;
  trackT: number;
} => {
  const candidates = state.world.tracks.flatMap((track) => {
    const points: Array<{
      track: typeof state.world.tracks[number];
      point: Point;
      trackT: number;
      distance: number;
    }> = [];
    for (let step = 0; step <= 100; step += 1) {
      const trackT = step / 100;
      const point = bezierPoint(track, trackT);
      const distance = distanceTo(point, access);
      if (distance >= access.radius * 0.5
        && distance <= access.radius * 0.78) {
        points.push({ track, point, trackT, distance });
      }
    }
    return points;
  }).sort((left, right) => right.distance - left.distance
    || left.track.uuid.localeCompare(right.track.uuid)
    || left.trackT - right.trackT);
  const result = candidates[0];
  if (!result) throw new Error('No train placement inside rail access');
  return result;
};

async function panWorldPointToCentre(
  page: Page,
  target: Point,
  viewportRatio: Point = { x: 0.5, y: 0.5 },
): Promise<void> {
  const operating = await page.locator(
    '[data-testid="train-inspector"]',
  ).isVisible();
  if (!operating) {
    await page.keyboard.press('h');
    await expect(page.locator('canvas')).toHaveCSS('cursor', 'grab');
  } else {
    const canvas = await page.locator('canvas').boundingBox();
    if (!canvas) throw new Error('Canvas is not visible');
    const releaseState = await snapshot(page);
    const blockedPoints = interactiveMapPoints(releaseState, canvas);
    const releaseOffset = { x: 4, y: 0 };
    const candidates = canvasDragCandidates(canvas)
      .filter((candidate) => dragPathClearsPoints(
        candidate,
        releaseOffset,
        blockedPoints,
      ));
    expect(
      candidates.length,
      'follow-release candidates must clear trains and facilities',
    ).toBeGreaterThan(0);
    const releaseOrigin = await findCanvasDragOrigin(
      page,
      candidates,
      releaseOffset,
    );
    const origin = releaseOrigin.origin;
    expect(
      origin,
      `follow-release drag must stay on canvas; DOM coverage ${
        JSON.stringify(releaseOrigin.coverage)
      }`,
    ).not.toBeNull();
    if (!origin) throw new Error('No canvas point to release camera follow');
    const beforeRelease = await snapshot(page);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 4, origin.y, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const afterRelease = await snapshot(page);
    expect({
      x: afterRelease.camera.scrollX,
      y: afterRelease.camera.scrollY,
    }).not.toEqual({
      x: beforeRelease.camera.scrollX,
      y: beforeRelease.camera.scrollY,
    });
  }
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const state = await snapshot(page);
    const canvas = await page.locator('canvas').boundingBox();
    if (!canvas) throw new Error('Canvas is not visible');
    const internal = worldToCameraPoint(target, state.camera);
    const dx = state.camera.width * viewportRatio.x - internal.x;
    const dy = state.camera.height * viewportRatio.y - internal.y;
    if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) return;
    const scaleX = canvas.width / state.camera.width;
    const scaleY = canvas.height / state.camera.height;
    const maxMoveX = state.camera.width <= 720
      ? 35
      : Math.min(100, canvas.width * 0.1);
    const maxMoveY = state.camera.width <= 720
      ? 35
      : Math.min(100, canvas.height * 0.1);
    const moveX = Math.max(-maxMoveX, Math.min(
      maxMoveX,
      dx * scaleX,
    ));
    const moveY = Math.max(-maxMoveY, Math.min(
      maxMoveY,
      dy * scaleY,
    ));
    const blockedPoints = interactiveMapPoints(state, canvas);
    const moveOffset = { x: moveX, y: moveY };
    const origins = canvasDragCandidates(canvas)
      .filter((candidate) => dragPathClearsPoints(
        candidate,
        moveOffset,
        blockedPoints,
      ));
    expect(
      origins.length,
      'camera drag candidates must clear trains and facilities',
    ).toBeGreaterThan(0);
    const dragOrigin = await findCanvasDragOrigin(
      page,
      origins,
      moveOffset,
    );
    const origin = dragOrigin.origin;
    expect(
      origin,
      `camera drag path must remain entirely on canvas; DOM coverage ${
        JSON.stringify(dragOrigin.coverage)
      }`,
    ).not.toBeNull();
    if (!origin) throw new Error('No unobstructed canvas drag path');
    const errorBefore = Math.hypot(dx, dy);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + moveX, origin.y + moveY, { steps: 8 });
    await page.mouse.up();
    const moved = await snapshot(page);
    const movedInternal = worldToCameraPoint(target, moved.camera);
    const movedDx = moved.camera.width * viewportRatio.x - movedInternal.x;
    const movedDy = moved.camera.height * viewportRatio.y - movedInternal.y;
    expect(
      Math.hypot(movedDx, movedDy),
      'each camera drag must reduce target error',
    ).toBeLessThan(errorBefore);
  }
  const finalState = await snapshot(page);
  throw new Error(JSON.stringify({
    message: 'Could not centre the generated extension',
    target,
    viewportRatio,
    camera: finalState.camera,
    internal: worldToCameraPoint(target, finalState.camera),
  }));
}

async function fitExtension(
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
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = await snapshot(page);
    const startInternal = worldToCameraPoint(start, state.camera);
    const endInternal = worldToCameraPoint(end, state.camera);
    const insetX = state.camera.width <= 720 ? 60 : 90;
    const insetY = state.camera.width <= 720 ? 80 : 110;
    if ([startInternal, endInternal].every((point) => (
      point.x >= insetX
      && point.x <= state.camera.width - insetX
      && point.y >= insetY
      && point.y <= state.camera.height - insetY
    ))) return;
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    await page.mouse.wheel(0, 600);
  }
  const finalState = await snapshot(page);
  throw new Error(JSON.stringify({
    message: 'Generated extension does not fit the playable viewport',
    start,
    end,
    camera: finalState.camera,
    startInternal: worldToCameraPoint(start, finalState.camera),
    endInternal: worldToCameraPoint(end, finalState.camera),
  }));
}

async function purchaseFlatbedAtForest(
  page: Page,
): Promise<string> {
  const before = await snapshot(page);
  const existingIds = new Set(before.world.trains.map(({ id }) => id));
  const forest = facility(before, 'managed-forest');
  const sawmill = facility(before, 'sawmill');
  const placement = placementInsideAccess(before, forest.railAccess);
  const mobile = before.camera.width <= 720;
  await panWorldPointToCentre(
    page,
    placement.point,
    {
      x: mobile
        ? (before.camera.width - 4) / before.camera.width
        : 0.5,
      y: mobile ? 0.55 : 0.5,
    },
  );
  if (mobile) {
    await assertVisibleWithinViewport(
      page,
      '[data-testid="vehicle-purchase-panel"]',
    );
    await assertVisibleWithinViewport(
      page,
      '[data-testid="flatbed-freight-set-buy"]',
    );
  }
  await page.locator('[data-testid="flatbed-freight-set-buy"]').click();
  const framed = await snapshot(page);
  const placementScreen = await toPagePoint(page, placement.point, framed);
  await page.mouse.click(placementScreen.x, placementScreen.y);
  const confirm = page.locator('[data-testid="freight-purchase-confirm"]');
  await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
    .toContainText('£90,000');
  await expect(confirm).toBeEnabled();
  if (mobile) {
    await confirm.scrollIntoViewIfNeeded();
    await assertVisibleWithinViewport(
      page,
      '[data-testid="freight-purchase-confirm"]',
    );
  }
  await confirm.click();
  await page.waitForFunction(
    (count) => window.__railSimFirstRouteHarness
      ?.snapshot().world.trains.length === count,
    existingIds.size + 1,
  );

  const purchased = await snapshot(page);
  const added = purchased.world.trains.find(({ id }) => !existingIds.has(id));
  if (!added) throw new Error('Purchased train was not persisted');
  expect(purchased.world.company.cash).toBe(
    before.world.company.cash - FLATBED_PRICE,
  );
  expect(categoryTotal(purchased, 'vehicle-capex')).toBe(
    FLATBED_PRICE * purchased.world.trains.length,
  );
  expect(added.trackUUID).toBe(placement.track.uuid);
  expect(added.trackT).toBeCloseTo(placement.trackT, 2);
  const track = purchased.world.tracks.find(
    ({ uuid }) => uuid === added.trackUUID,
  );
  if (!track) throw new Error('Purchased train track is absent');
  const tangent = added.trackT <= 0.5
    ? {
      x: track.p1.x - track.p0.x,
      y: track.p1.y - track.p0.y,
    }
    : {
      x: track.p3.x - track.p2.x,
      y: track.p3.y - track.p2.y,
    };
  const trainPoint = bezierPoint(track, added.trackT);
  const towardSawmill = {
    x: sawmill.railAccess.x - trainPoint.x,
    y: sawmill.railAccess.y - trainPoint.y,
  };
  expect(
    added.facing
      * (tangent.x * towardSawmill.x + tangent.y * towardSawmill.y),
  ).toBeGreaterThan(0);
  return added.id;
}

async function enterOperateThroughCanvas(page: Page): Promise<void> {
  const state = await snapshot(page);
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  const mobile = state.camera.width <= 720;
  const togglePoint = {
    x: state.camera.width - (mobile ? 45 : 70),
    y: mobile ? 24 : 34,
  };
  await canvas.click({
    position: {
      x: togglePoint.x * box.width / state.camera.width,
      y: togglePoint.y * box.height / state.camera.height,
    },
  });
  await expect(page.locator('[data-testid="train-inspector"]')).toBeVisible();
  await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
    .toBeHidden();
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
}

async function returnToCreateThroughPause(
  page: Page,
  expectPurchasePanel = true,
): Promise<void> {
  await page.keyboard.press('Escape');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await canvas.click({
    position: { x: box.width / 2, y: box.height * 0.56 },
  });
  if (expectPurchasePanel) {
    await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
      .toBeVisible();
  } else {
    await page.keyboard.press('h');
    await expect(page.locator('canvas')).toHaveCSS('cursor', 'grab');
  }
  await expect(page.locator('[data-testid="train-inspector"]')).toBeHidden();
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
}

async function selectTrainThroughPointer(
  page: Page,
  trainId: string,
): Promise<void> {
  let state = await snapshot(page);
  let live = runtimeById(state, trainId);
  await panWorldPointToCentre(page, live, {
    x: 0.5,
    y: state.camera.width <= 720 ? 0.55 : 0.5,
  });
  state = await snapshot(page);
  live = runtimeById(state, trainId);
  const screen = await toPagePoint(page, live, state);
  await page.mouse.click(screen.x, screen.y);
  await expect(page.locator('[data-testid="train-inspector"]')).toBeVisible();
  if (state.camera.width <= 720) {
    for (const selector of [
      '[data-testid="train-inspector"]',
      '[data-testid="train-cargo-progress"]',
      '[data-testid="train-transfer-status"]',
      '[data-throttle="-1"]',
      '[data-throttle="0"]',
      '[data-throttle="1"]',
    ]) {
      await assertVisibleWithinViewport(page, selector);
    }
  }
}

async function waitForFullCargo(
  page: Page,
  trainId: string,
  productId: 'logs' | 'structural-timber',
  timeout = 30_000,
): Promise<StructuralBrowserSnapshot> {
  await expect.poll(async () => {
    const state = await snapshot(page);
    const cargo = trainById(state, trainId).cargo;
    return {
      productId: cargo?.productId ?? null,
      units: cargo?.units ?? 0,
    };
  }, {
    timeout,
    intervals: [250, 500, 750],
  }).toEqual({ productId, units: 60 });
  return snapshot(page);
}

async function driveSelectedTrainToFacility(
  page: Page,
  trainId: string,
  destination: 'sawmill' | 'prefabrication-plant',
  timeout = 210_000,
): Promise<StructuralBrowserSnapshot> {
  const opening = await snapshot(page);
  const access = facility(opening, destination).railAccess;
  const openingCargo = trainById(opening, trainId).cargo;
  expect(openingCargo?.units).toBe(60);
  let previousDistance = distanceTo(runtimeById(opening, trainId), access);
  let motion: 'approaching' | 'receding' | 'stationary' = 'stationary';
  let unloadingStarted = false;
  let firstInsideTick: number | null = null;
  let firstUnloadTick: number | null = null;
  let heldKey: 'w' | 's' | null = null;
  let maxObservedSpeed = 0;
  const driveStartedAt = Date.now();
  const recent: Array<Record<string, unknown>> = [];
  const setHeldKey = async (next: 'w' | 's' | null): Promise<void> => {
    if (next === heldKey) return;
    if (heldKey) await page.keyboard.up(heldKey);
    heldKey = next;
    if (heldKey) await page.keyboard.down(heldKey);
  };
  const pulse = async (
    key: 'w' | 's',
    duration = 25,
  ): Promise<void> => {
    await setHeldKey(null);
    await page.keyboard.down(key);
    await page.waitForTimeout(duration);
    await page.keyboard.up(key);
  };

  try {
    try {
      await expect.poll(async () => {
        const state = await snapshot(page);
        const live = runtimeById(state, trainId);
        const currentTrain = trainById(state, trainId);
        const cargoUnits = currentTrain.cargo?.units ?? 0;
        const distance = distanceTo(live, access);
        maxObservedSpeed = Math.max(
          maxObservedSpeed,
          live.speedWorldUnitsPerSecond,
        );
        const delta = distance - previousDistance;
        if (Math.abs(delta) >= 0.5) {
          motion = delta < 0 ? 'approaching' : 'receding';
        } else if (live.speedWorldUnitsPerSecond <= 2) {
          motion = 'stationary';
        }
        previousDistance = distance;
        if (distance <= access.radius && firstInsideTick === null) {
          firstInsideTick = state.world.economy.tick;
        }
        if (cargoUnits < 60 && firstUnloadTick === null) {
          firstUnloadTick = state.world.economy.tick;
        }
        const propulsionKey = keyToward(state, live, access);
        unloadingStarted ||= cargoUnits < 60;
        recent.push({
          economyTick: state.world.economy.tick,
          cargoUnits,
          distance,
          speed: live.speedWorldUnitsPerSecond,
          throttle: live.throttle,
          facing: live.facing,
          trackUUID: live.trackUUID,
          trackT: live.trackT,
          motion,
          propulsionKey,
        });
        if (recent.length > 10) recent.shift();
        if (live.derailed) {
          throw new Error(JSON.stringify({
            message: `${trainId} derailed en route to ${destination}`,
            access,
            recent,
          }));
        }

        if (unloadingStarted) {
          await setHeldKey(null);
          if (
            distance > access.radius
            && (
              motion === 'receding'
              || live.speedWorldUnitsPerSecond <= 2
            )
          ) {
            await pulse(propulsionKey, 20);
          }
        } else if (distance <= access.radius) {
          await setHeldKey(null);
          const brakeTarget = access.radius * 0.75;
          if (distance > brakeTarget && motion === 'receding') {
            await pulse(propulsionKey, 20);
          } else if (
            distance <= brakeTarget
            && live.speedWorldUnitsPerSecond > 2
          ) {
            const brakingKey = motion === 'receding'
              ? propulsionKey
              : oppositeKey(propulsionKey);
            await pulse(
              brakingKey,
              live.speedWorldUnitsPerSecond > 20 ? 60 : 20,
            );
          }
        } else if (distance <= access.radius * 2) {
          await setHeldKey(null);
          if (motion === 'receding') {
            await pulse(propulsionKey, 20);
          } else if (live.speedWorldUnitsPerSecond > 28) {
            await pulse(oppositeKey(propulsionKey), 20);
          } else if (live.speedWorldUnitsPerSecond < 24) {
            await pulse(propulsionKey, 20);
          }
        } else if (motion === 'receding') {
          await setHeldKey(null);
          await pulse(propulsionKey, 20);
        } else {
          await setHeldKey(null);
          if (live.speedWorldUnitsPerSecond < 46) {
            await pulse(propulsionKey, 60);
          } else if (live.speedWorldUnitsPerSecond > 54) {
            await pulse(oppositeKey(propulsionKey), 60);
          }
        }

        return {
          inside: distance <= access.radius,
          stopped: live.speedWorldUnitsPerSecond <= 2,
          empty: currentTrain.cargo === null,
        };
      }, {
        timeout,
        intervals: [50, 75, 100, 150],
      }).toEqual({ inside: true, stopped: true, empty: true });
    } catch (error) {
      const finalState = await snapshot(page);
      const finalRuntime = runtimeById(finalState, trainId);
      const finalTrain = trainById(finalState, trainId);
      const transferStatus = await page
        .locator('[data-testid="train-transfer-status"]')
        .textContent()
        .catch(() => null);
      throw new Error(JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
        trainId,
        destination,
        firstInsideTick,
        firstUnloadTick,
        transferStatus,
        final: {
          economyTick: finalState.world.economy.tick,
          cargoUnits: finalTrain.cargo?.units ?? 0,
          distance: distanceTo(finalRuntime, access),
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
  expect(maxObservedSpeed).toBeLessThanOrEqual(72);
  console.info(JSON.stringify({
    browserDrive: {
      trainId,
      destination,
      durationMs: Date.now() - driveStartedAt,
      maxObservedSpeed,
    },
  }));
  return snapshot(page);
}

async function moveSelectedTrainClearOfFacility(
  page: Page,
  trainId: string,
  sourceDefinitionId: string,
  towardDefinitionId: string,
): Promise<StructuralBrowserSnapshot> {
  const opening = await snapshot(page);
  const source = facility(opening, sourceDefinitionId).railAccess;
  const target = facility(opening, towardDefinitionId).railAccess;
  expect(trainById(opening, trainId).cargo).toBeNull();
  expect(distanceTo(runtimeById(opening, trainId), source))
    .toBeLessThanOrEqual(source.radius);
  const key = keyToward(opening, runtimeById(opening, trainId), target);
  try {
    await page.keyboard.down(key);
    await expect.poll(async () => {
      const state = await snapshot(page);
      const live = runtimeById(state, trainId);
      if (live.derailed) {
        throw new Error(`${trainId} derailed while clearing ${sourceDefinitionId}`);
      }
      return distanceTo(live, source);
    }, {
      timeout: 15_000,
      intervals: [50, 75, 100, 150],
    }).toBeGreaterThan(source.radius + 80);
  } finally {
    await page.keyboard.up(key);
  }
  return snapshot(page);
}

async function buildAnchoredExtension(
  page: Page,
): Promise<StructuralBrowserSnapshot> {
  const built = await snapshot(page);
  const sawmill = facility(built, 'sawmill');
  const prefab = facility(built, 'prefabrication-plant');
  const start = nearestEndpoint(built, sawmill.railAccess);
  const end = prefab.railAccess;
  expect(Math.hypot(
    start.x - sawmill.railAccess.x,
    start.y - sawmill.railAccess.y,
  )).toBeLessThanOrEqual(sawmill.railAccess.radius);

  await fitExtension(page, start, end);
  await page.keyboard.press('p');
  const framed = await snapshot(page);
  await dragTrack(
    page,
    await toPagePoint(page, start, framed),
    await toPagePoint(page, end, framed),
  );
  const confirm = page.locator('[data-testid="construction-confirm"]');
  if (framed.camera.width <= 720) {
    for (const selector of [
      '[data-testid="construction-inspector"]',
      '[data-testid="construction-actions"]',
      '[data-testid="construction-confirm"]',
    ]) {
      await assertVisibleWithinViewport(page, selector);
    }
  }
  if (!await confirm.isEnabled()) {
    throw new Error(JSON.stringify({
      primary: await page.locator(
        '[data-testid="construction-primary"]',
      ).textContent(),
      detail: await page.locator(
        '[data-testid="construction-detail"]',
      ).textContent(),
      remedy: await page.locator(
        '[data-testid="construction-remedy"]',
      ).textContent(),
      start,
      end,
      tracks: framed.world.tracks.map((track) => ({
        uuid: track.uuid,
        p0: track.p0,
        p1: track.p1,
        p2: track.p2,
        p3: track.p3,
      })),
      camera: framed.camera,
      startScreen: await toPagePoint(page, start, framed),
      endScreen: await toPagePoint(page, end, framed),
    }));
  }
  await expect(confirm).toBeEnabled();
  const reviewed = await snapshot(page);
  expect(reviewed.construction.phase).toBe('review');
  expect(reviewed.construction.preview).toMatchObject({
    affordable: true,
    canConfirm: true,
  });
  expect(reviewed.construction.preview?.predictedConnections).toHaveLength(1);
  expect((reviewed.construction.preview?.totalCost ?? Infinity)
    + OPERATING_RESERVE).toBeLessThanOrEqual(REGIONAL_DEVELOPMENT_GRANT);
  const trackCount = reviewed.world.tracks.length;
  const topologyCount = reviewed.construction.topology.length;
  const capexBefore = categoryTotal(built, 'construction-capex');
  const extensionCost = reviewed.construction.preview!.totalCost;
  await confirm.click();
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  const committed = await snapshot(page);
  expect(committed.world.tracks).toHaveLength(trackCount + 1);
  expect(committed.construction.topology.length)
    .toBeGreaterThan(topologyCount);
  expect(categoryTotal(committed, 'construction-capex') - capexBefore)
    .toBe(extensionCost);
  expectConnectedFacilityPath(
    committed,
    'sawmill',
    'prefabrication-plant',
  );
  return committed;
}

async function clickFacilityThroughPointer(
  page: Page,
  definitionId: string,
): Promise<void> {
  let state = await snapshot(page);
  const target = facility(state, definitionId);
  const mobilePortrait =
    state.camera.width <= 720 && state.camera.width <= state.camera.height;
  await panWorldPointToCentre(page, target.railAccess, {
    x: mobilePortrait ? 0.9 : 0.5,
    y: state.camera.width <= 720 && state.camera.width > state.camera.height
      ? 0.3
      : mobilePortrait
        ? 0.15
        : 0.5,
  });
  state = await snapshot(page);
  const screen = await toPagePoint(page, target.railAccess, state);
  await page.mouse.click(screen.x, screen.y);
  await expect(page.locator('[data-testid="facility-inspector"]'))
    .toBeVisible();
}

async function assertNoViewportOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(overflow.bodyWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.bodyHeight).toBeLessThanOrEqual(overflow.clientHeight);
}

async function assertVisibleWithinViewport(
  page: Page,
  selector: string,
): Promise<void> {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`${selector} has no viewport bounds`);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function assertReachableWithinScrollableViewport(
  page: Page,
  containerSelector: string,
  selector: string,
): Promise<void> {
  const container = page.locator(containerSelector);
  const target = container.locator(selector);
  await expect(container).toBeVisible();
  await expect(target).toBeVisible();
  let tallTargetTopReached = false;
  let tallTargetBottomReached = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const containerBox = await container.boundingBox();
    const targetBox = await target.boundingBox();
    const viewport = page.viewportSize();
    if (!containerBox || !targetBox || !viewport) {
      throw new Error(`${selector} has no scrollable viewport bounds`);
    }
    const horizontallyContained = targetBox.x >= containerBox.x - 1
      && targetBox.x + targetBox.width
        <= containerBox.x + containerBox.width + 1;
    const targetBottom = targetBox.y + targetBox.height;
    const containerBottom = containerBox.y + containerBox.height;
    const targetFits = targetBox.height <= containerBox.height + 2;
    const topReached = targetBox.y >= containerBox.y - 1
      && targetBox.y <= containerBottom + 1
      && targetBox.y >= -1
      && targetBox.y <= viewport.height + 1;
    const bottomReached = targetBottom >= containerBox.y - 1
      && targetBottom <= containerBottom + 1
      && targetBottom >= -1
      && targetBottom <= viewport.height + 1;
    tallTargetTopReached ||= horizontallyContained && topReached;
    tallTargetBottomReached ||= horizontallyContained && bottomReached;
    const withinContainer = horizontallyContained
      && targetBox.y >= containerBox.y - 1
      && targetBottom <= containerBottom + 1;
    const withinViewport = targetBox.x >= 0
      && targetBox.y >= 0
      && targetBox.x + targetBox.width <= viewport.width + 1
      && targetBottom <= viewport.height + 1;
    if (withinContainer && withinViewport) return;
    if (
      !targetFits
      && tallTargetTopReached
      && tallTargetBottomReached
    ) return;
    await page.mouse.move(
      containerBox.x + containerBox.width / 2,
      containerBox.y + containerBox.height / 2,
    );
    const above = targetBox.y - containerBox.y;
    const below = targetBottom - containerBottom;
    const requiredDelta = !targetFits && !tallTargetTopReached
      ? above - 8
      : above < -1 && targetFits
        ? above - 8
        : below + 8;
    await page.mouse.wheel(
      0,
      Math.max(-120, Math.min(120, requiredDelta)),
    );
    await page.waitForTimeout(30);
  }
  const containerBox = await container.boundingBox();
  const targetBox = await target.boundingBox();
  throw new Error(JSON.stringify({
    message: 'Scrollable inspector content is not reachable',
    containerSelector,
    selector,
    containerBox,
    targetBox,
  }));
}

const expectInventoryConserved = (
  opening: FacilityState,
  closing: FacilityState,
  productId: string,
): void => {
  const before = opening.inventories[productId];
  const after = closing.inventories[productId];
  if (!before || !after) {
    throw new Error(`Missing ${productId} conservation slot`);
  }
  expect(before.quantity + after.recentInflow).toBe(
    after.quantity + after.recentOutflow,
  );
};

const persistedJourneyState = (state: StructuralBrowserSnapshot) => ({
  tracks: state.world.tracks,
  topology: state.construction.topology,
  trains: state.world.trains,
  facilities: state.world.economy.facilities,
  cash: state.world.company.cash,
  ledger: state.world.company.ledger,
  freightProgress: state.world.freightProgress,
  objective: state.objective,
});

async function quitToMenuThroughPause(page: Page): Promise<void> {
  await enterOperateThroughCanvas(page);
  await page.keyboard.press('Escape');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await canvas.click({
    position: { x: box.width / 2, y: box.height * 0.67 },
  });
  await page.waitForFunction(
    () => window.__railSimScene === 'MenuScene',
    undefined,
    { timeout: 30_000 },
  );
  await waitForRenderedFrame(page);
}

async function openOnlySavedWorld(page: Page): Promise<void> {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__railSimScene === 'WorldSelectScene',
    undefined,
    { timeout: 30_000 },
  );
  await waitForRenderedFrame(page);
  await canvas.click({
    position: { x: box.width / 2, y: Math.min(200, box.height / 3) },
  });
  await waitForHarness(page);
}

test('mobile pause owns the screen and can return from an open train inspector', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await createFixedSeedWorld(
    page,
    'first-route-browser-gamma',
    DESKTOP,
  );
  await buildCheapestStarter(page);
  await purchaseFlatbedAtForest(page);
  await enterOperateThroughCanvas(page);
  await page.setViewportSize(MOBILE);
  await waitForRenderedFrame(page);
  await expect(page.locator('[data-testid="freight-objective"]'))
    .toBeVisible();
  for (const selector of [
    '[data-testid="train-inspector"]',
    '[data-throttle="-1"]',
    '[data-throttle="0"]',
    '[data-throttle="1"]',
  ]) {
    await assertVisibleWithinViewport(page, selector);
  }

  await page.keyboard.press('Escape');
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
  const returnPoint = {
    x: box.x + box.width / 2,
    y: box.y + box.height * 0.56,
  };
  expect(await page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y) instanceof HTMLCanvasElement,
  returnPoint)).toBe(true);

  await page.mouse.click(returnPoint.x, returnPoint.y);
  await expect(page.locator('[data-testid="vehicle-purchase-panel"]'))
    .toBeVisible();
  await expect(page.locator('[data-testid="company-hud"]')).toBeVisible();
  await expect(page.locator('[data-testid="freight-objective"]'))
    .toBeVisible();
  await expect(page.locator('[data-testid="train-inspector"]')).toBeHidden();
  await expect(page.locator('[data-testid="company-save-state"]'))
    .toHaveText('Saved');
  const beforeReload = await snapshot(page);
  await page.setViewportSize(DESKTOP);
  await waitForRenderedFrame(page);
  await quitToMenuThroughPause(page);
  await openOnlySavedWorld(page);
  const reloaded = await snapshot(page);
  expect(reloaded.world.id).toBe(beforeReload.world.id);
  expect(reloaded.world.generationConfig.seed)
    .toBe('first-route-browser-gamma');
  expect(errors).toHaveLength(0);
});

test('mobile facility inspection scrolls every decision section into reach', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await createFixedSeedWorld(page, 'first-route-browser-gamma', MOBILE);
  await clickFacilityThroughPointer(page, 'prefabrication-plant');
  const facilityInspector = '[data-testid="facility-inspector"]';
  await assertVisibleWithinViewport(page, facilityInspector);
  const objectiveBounds = await page.locator(
    '[data-testid="freight-objective"]',
  ).boundingBox();
  const facilityBounds = await page.locator(facilityInspector).boundingBox();
  if (!objectiveBounds || !facilityBounds) {
    throw new Error('Objective or facility inspector has no portrait bounds');
  }
  expect(rectanglesOverlap(objectiveBounds, facilityBounds)).toBe(false);
  for (const selector of [
    '[data-testid="facility-name"]',
    '[data-testid="facility-status"]',
    '[data-testid="facility-inventories"]',
    '[data-testid="facility-quotes"]',
    '[data-testid="facility-rail"]',
  ]) {
    await assertReachableWithinScrollableViewport(
      page,
      facilityInspector,
      selector,
    );
  }
  await assertNoViewportOverflow(page);
  expect(errors).toHaveLength(0);
});

test('landscape facility inspection does not occlude the objective', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await createFixedSeedWorld(
    page,
    'facility-layout-landscape',
    MOBILE_LANDSCAPE,
  );
  await clickFacilityThroughPointer(page, 'prefabrication-plant');

  const objectiveBounds = await page.locator(
    '[data-testid="freight-objective"]',
  ).boundingBox();
  const facilityBounds = await page.locator(
    '[data-testid="facility-inspector"]',
  ).boundingBox();
  if (!objectiveBounds || !facilityBounds) {
    throw new Error('Objective or facility inspector has no landscape bounds');
  }
  expect(rectanglesOverlap(objectiveBounds, facilityBounds)).toBe(false);
});

test.describe('real structural-timber browser journey', () => {
  for (const seedCase of SEEDS) {
    test(`${seedCase.seed} completes the structural-timber link`, async ({
      page,
    }) => {
      test.setTimeout(720_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });

      try {
        const opening = await createFixedSeedWorld(
          page,
          seedCase.seed,
          seedCase.viewport,
        );
        const openingForest = facility(opening, 'managed-forest');
        const openingSawmill = facility(opening, 'sawmill');
        const openingPrefab = facility(opening, 'prefabrication-plant');
        const starter = await buildCheapestStarter(page);
        expectConnectedFacilityPath(
          starter,
          'managed-forest',
          'sawmill',
          starter.world.tracks.map(({ uuid }) => uuid),
        );

        const firstTrainId = await purchaseFlatbedAtForest(page);
        await enterOperateThroughCanvas(page);
        await waitForFullCargo(page, firstTrainId, 'logs');
        await selectTrainThroughPointer(page, firstTrainId);
        const firstDelivered = await driveSelectedTrainToFacility(
          page,
          firstTrainId,
          'sawmill',
        );
        const firstTrain = trainById(firstDelivered, firstTrainId);
        expect(firstTrain.cargo).toBeNull();
        expect(firstTrain.operations.lastTripRevenue).toBeGreaterThan(
          firstTrain.operations.lastTripRunningCost,
        );
        expect(firstDelivered.world.freightProgress).toEqual({
          progressVersion: 1,
          profitableLogDeliveryCompleted: true,
          developmentGrantAwarded: true,
          profitableStructuralTimberDeliveryCompleted: false,
          profitableLimestoneDeliveryCompleted: false,
          profitableCementDeliveryCompleted: false,
          profitableSteelDeliveryCompleted: false,
          profitableBuildingModuleDeliveryCompleted: false,
        });
        expect(firstDelivered.world.company.ledger.filter(
          ({ referenceId }) =>
            referenceId === DEVELOPMENT_GRANT_REFERENCE,
        )).toHaveLength(1);
        expect(categoryTotal(firstDelivered, 'delivery-revenue'))
          .toBeGreaterThan(0);
        expect(
          categoryTotal(firstDelivered, 'delivery-revenue')
          - categoryTotal(firstDelivered, 'train-running-cost'),
        ).toBeGreaterThan(0);
        expect(categoryTotal(firstDelivered, 'contract-bonus'))
          .toBe(REGIONAL_DEVELOPMENT_GRANT);
        expect(firstDelivered.objective).toMatchObject({
          id: 'structural-timber-link',
          achieved: false,
        });
        await expect(page.locator('[data-testid="freight-objective"]'))
          .toHaveAttribute('data-objective', 'structural-timber-link');
        await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
        await expect(
          page.locator('[data-testid="company-delivery-revenue"]'),
        ).toContainText(/Deliveries £[1-9]/);
        await expect(
          page.locator('[data-testid="company-contract-bonuses"]'),
        ).toContainText(`Development ${CASH.format(
          REGIONAL_DEVELOPMENT_GRANT,
        )}`);
        await expect(
          page.locator('[data-testid="company-operating-profit"]'),
        ).toContainText(/Rail profit £[1-9]/);
        if (seedCase.viewport.width <= 720) {
          for (const selector of [
            '[data-testid="freight-objective"]',
            '[data-testid="company-hud"]',
            '[data-testid="company-cash"]',
            '[data-testid="company-delivery-revenue"]',
            '[data-testid="company-contract-bonuses"]',
            '[data-testid="company-operating-profit"]',
          ]) {
            await assertVisibleWithinViewport(page, selector);
          }
        }

        await returnToCreateThroughPause(page);
        const secondTrainId = await purchaseFlatbedAtForest(page);
        const extended = await buildAnchoredExtension(page);
        expect(extended.world.trains).toHaveLength(2);
        expect(extended.world.company.cash).toBeGreaterThanOrEqual(
          OPERATING_RESERVE,
        );

        await enterOperateThroughCanvas(page);
        let handoffState = await snapshot(page);
        await panWorldPointToCentre(
          page,
          runtimeById(handoffState, secondTrainId),
          {
            x: 0.5,
            y: handoffState.camera.width <= 720 ? 0.55 : 0.5,
          },
        );
        handoffState = await snapshot(page);
        const handoffSawmill = facility(handoffState, 'sawmill');
        expect(distanceTo(
          runtimeById(handoffState, firstTrainId),
          handoffSawmill.railAccess,
        )).toBeLessThanOrEqual(handoffSawmill.railAccess.radius);
        const secondTrainScreen = await toPagePoint(
          page,
          runtimeById(handoffState, secondTrainId),
          handoffState,
        );
        try {
          await page.keyboard.down('w');
          await page.mouse.click(
            secondTrainScreen.x,
            secondTrainScreen.y,
          );
          await expect.poll(async () => {
            const state = await snapshot(page);
            return {
              first: runtimeById(state, firstTrainId).throttle,
              second: runtimeById(state, secondTrainId).throttle,
            };
          }, {
            timeout: 15_000,
            intervals: [100, 250, 500],
          }).toEqual({ first: 0, second: 1 });
        } finally {
          await page.keyboard.up('w');
        }
        const handedOff = await snapshot(page);
        expect(distanceTo(
          runtimeById(handedOff, firstTrainId),
          facility(handedOff, 'sawmill').railAccess,
        )).toBeLessThanOrEqual(
          facility(handedOff, 'sawmill').railAccess.radius,
        );

        await waitForFullCargo(page, secondTrainId, 'logs');
        await expect.poll(async () => {
          const state = await snapshot(page);
          const firstCargo = trainById(state, firstTrainId).cargo;
          const sawmill = facility(state, 'sawmill');
          return {
            firstTimberUnits:
              firstCargo?.productId === 'structural-timber'
                ? firstCargo.units
                : 0,
            storedTimberUnits:
              sawmill.inventories['structural-timber'].quantity,
            remainingLogUnits: sawmill.inventories.logs.quantity,
          };
        }, {
          timeout: 45_000,
          intervals: [100, 250, 500],
        }).toEqual({
          firstTimberUnits: 48,
          storedTimberUnits: 0,
          remainingLogUnits: 0,
        });
        const beforeSecondLogDelivery = await snapshot(page);
        const firstTimberBeforeSecond =
          trainById(beforeSecondLogDelivery, firstTrainId).cargo;
        expect(firstTimberBeforeSecond).toEqual(
          expect.objectContaining({
            productId: 'structural-timber',
            units: 48,
            loadedUnits: 48,
          }),
        );
        expect(firstTimberBeforeSecond?.units).toBeLessThan(60);
        const secondDelivered = await driveSelectedTrainToFacility(
          page,
          secondTrainId,
          'sawmill',
        );
        const deliveredSawmill = facility(secondDelivered, 'sawmill');
        const secondDeliveryDistance = distanceTo(
          runtimeById(secondDelivered, secondTrainId),
          deliveredSawmill.railAccess,
        );
        expect(secondDeliveryDistance).toBeLessThanOrEqual(
          deliveredSawmill.railAccess.radius,
        );
        expect(secondDeliveryDistance).toBeGreaterThanOrEqual(
          deliveredSawmill.railAccess.radius * 0.5,
        );
        expect(runtimeById(secondDelivered, secondTrainId)
          .speedWorldUnitsPerSecond).toBeLessThanOrEqual(2);
        const secondCleared = await moveSelectedTrainClearOfFacility(
          page,
          secondTrainId,
          'sawmill',
          'managed-forest',
        );
        expect(trainById(secondCleared, secondTrainId).cargo).toBeNull();
        expect(trainById(secondCleared, secondTrainId)
          .operations.lastTripRevenue).toBeGreaterThan(
          trainById(secondCleared, secondTrainId)
            .operations.lastTripRunningCost,
        );
        expect(secondCleared.world.company.ledger.filter(
          ({ referenceId }) =>
            referenceId === DEVELOPMENT_GRANT_REFERENCE,
        )).toHaveLength(1);
        expect(distanceTo(
          runtimeById(secondCleared, secondTrainId),
          facility(secondCleared, 'sawmill').railAccess,
        )).toBeGreaterThan(
          facility(secondCleared, 'sawmill').railAccess.radius,
        );

        const preTimberTrip = await waitForFullCargo(
          page,
          firstTrainId,
          'structural-timber',
          45_000,
        );
        expect(trainById(preTimberTrip, firstTrainId).cargo).toEqual(
          expect.objectContaining({
            productId: 'structural-timber',
            units: 60,
            loadedUnits: 60,
          }),
        );
        const preTimberLedgerCount =
          preTimberTrip.world.company.ledger.length;
        const preTimberPrefabInflow = facility(
          preTimberTrip,
          'prefabrication-plant',
        ).inventories['structural-timber'].recentInflow;
        await selectTrainThroughPointer(page, firstTrainId);
        const timberDelivered = await driveSelectedTrainToFacility(
          page,
          firstTrainId,
          'prefabrication-plant',
        );
        expect(trainById(timberDelivered, firstTrainId).cargo).toBeNull();
        const deliveredPrefab = facility(
          timberDelivered,
          'prefabrication-plant',
        );
        const timberRevenueEntries = timberDelivered.world.company.ledger
          .slice(preTimberLedgerCount)
          .filter(({ category }) => category === 'delivery-revenue');
        expect(timberRevenueEntries).toHaveLength(6);
        expect(timberRevenueEntries.every(
          ({ referenceId }) => referenceId.endsWith(`:${deliveredPrefab.id}`),
        )).toBe(true);
        expect(timberRevenueEntries.reduce(
          (sum, { amount }) => sum + amount,
          0,
        )).toBe(
          trainById(timberDelivered, firstTrainId)
            .operations.lastTripRevenue,
        );
        expect(deliveredPrefab.inventories['structural-timber'].recentInflow
          - preTimberPrefabInflow).toBe(60);
        expect(timberDelivered.world.freightProgress
          .profitableStructuralTimberDeliveryCompleted).toBe(true);

        await page.keyboard.press('Escape');
        const paused = await snapshot(page);
        const pausedTick = paused.world.economy.tick;
        await page.waitForTimeout(1_250);
        expect((await snapshot(page)).world.economy.tick).toBe(pausedTick);

        const checkpoint = await snapshot(page);
        const checkpointForest = facility(checkpoint, 'managed-forest');
        const checkpointSawmill = facility(checkpoint, 'sawmill');
        const checkpointPrefab = facility(
          checkpoint,
          'prefabrication-plant',
        );
        expect(checkpointPrefab.inventories['structural-timber'].recentInflow)
          .toBe(60);
        expect(checkpointPrefab.inventories.cement.quantity).toBe(0);
        expect(checkpointPrefab.inventories.steel.quantity).toBe(0);
        expect(checkpoint.world.freightProgress).toEqual({
          progressVersion: 1,
          profitableLogDeliveryCompleted: true,
          developmentGrantAwarded: true,
          profitableStructuralTimberDeliveryCompleted: true,
          profitableLimestoneDeliveryCompleted: false,
          profitableCementDeliveryCompleted: false,
          profitableSteelDeliveryCompleted: false,
          profitableBuildingModuleDeliveryCompleted: false,
        });
        expect(checkpoint.objective).toEqual({
          objectiveVersion: 1,
          id: 'cement-supply-chain',
          title: 'Cement supply chain',
          status: 'Build the cement supply chain',
          achieved: false,
          steps: [
            {
              id: 'connect-quarry-cement',
              label: 'Connect Quarry to Cement Works',
              state: 'current',
            },
            {
              id: 'buy-aggregate-hopper',
              label: 'Buy an Aggregate Hopper Set',
              state: 'pending',
            },
            {
              id: 'deliver-limestone-profitably',
              label: 'Deliver 120 t limestone profitably',
              state: 'pending',
            },
            {
              id: 'produce-cement',
              label: 'Produce 80 t cement',
              state: 'pending',
            },
            {
              id: 'connect-cement-prefabrication',
              label: 'Connect Cement Works to Prefabrication Plant',
              state: 'pending',
            },
            {
              id: 'buy-covered-cement',
              label: 'Buy a Covered Cement Set',
              state: 'pending',
            },
            {
              id: 'deliver-cement-profitably',
              label: 'Deliver 80 t cement profitably',
              state: 'pending',
            },
          ],
        });
        const finalFirstTrain = trainById(checkpoint, firstTrainId);
        expect(finalFirstTrain.operations.lastTripRevenue).toBeGreaterThan(
          finalFirstTrain.operations.lastTripRunningCost,
        );
        expect(finalFirstTrain.operations.lifetimeRevenue).toBeGreaterThan(
          finalFirstTrain.operations.lifetimeRunningCost,
        );
        expect(checkpoint.world.company.ledger.filter(
          ({ referenceId }) =>
            referenceId === DEVELOPMENT_GRANT_REFERENCE,
        )).toHaveLength(1);
        expect(checkpoint.world.company.ledger.filter(
          ({ category, referenceId }) => category === 'delivery-revenue'
            && referenceId.endsWith(`:${checkpointPrefab.id}`),
        )).toHaveLength(6);
        expect(checkpoint.world.company.cash - opening.world.company.cash)
          .toBe(signedLedgerSum(
            checkpoint,
            opening.world.company.ledger.length,
          ));
        expect(
          categoryTotal(checkpoint, 'delivery-revenue')
          - categoryTotal(checkpoint, 'train-running-cost'),
        ).toBeGreaterThan(0);
        expectInventoryConserved(
          openingForest,
          checkpointForest,
          'logs',
        );
        expectInventoryConserved(
          openingSawmill,
          checkpointSawmill,
          'logs',
        );
        expectInventoryConserved(
          openingSawmill,
          checkpointSawmill,
          'structural-timber',
        );
        expectInventoryConserved(
          openingPrefab,
          checkpointPrefab,
          'structural-timber',
        );

        const objectiveCard = page.locator(
          '[data-testid="freight-objective"]',
        );
        await expect(objectiveCard)
          .toHaveAttribute('data-objective', 'cement-supply-chain');
        await expect(objectiveCard)
          .toHaveAttribute('aria-label', 'Cement supply chain objective');
        const expectedSteps = [
          [
            'connect-quarry-cement',
            'Current: Connect Quarry to Cement Works',
            true,
          ],
          [
            'buy-aggregate-hopper',
            'Pending: Buy an Aggregate Hopper Set',
            false,
          ],
          [
            'deliver-limestone-profitably',
            'Pending: Deliver 120 t limestone profitably',
            false,
          ],
          ['produce-cement', 'Pending: Produce 80 t cement', false],
          [
            'connect-cement-prefabrication',
            'Pending: Connect Cement Works to Prefabrication Plant',
            false,
          ],
          [
            'buy-covered-cement',
            'Pending: Buy a Covered Cement Set',
            false,
          ],
          [
            'deliver-cement-profitably',
            'Pending: Deliver 80 t cement profitably',
            false,
          ],
        ] as const;
        for (const [step, text, current] of expectedSteps) {
          const item = page.locator(`[data-step="${step}"]`);
          await expect(item).toHaveText(text);
          if (current) {
            await expect(item).toHaveAttribute('aria-current', 'step');
          } else {
            await expect(item).not.toHaveAttribute('aria-current', 'step');
          }
        }
        await expect(page.locator('[data-step]')).toHaveCount(
          expectedSteps.length,
        );
        await expect(page.locator('[aria-current="step"]')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await clickFacilityThroughPointer(page, 'prefabrication-plant');
        await expect(page.locator('[data-testid="facility-name"]'))
          .toContainText('Prefabrication');
        await expect(page.locator('[data-testid="facility-status"]'))
          .toHaveAttribute('data-status', 'waiting-input');
        await expect(page.locator('[data-testid="facility-status"]'))
          .toContainText('Needs cement and steel');
        await expect(page.locator('[data-testid="facility-inventories"]'))
          .toContainText('Structural Timber 60');
        await expect(page.locator('[data-testid="facility-inventories"]'))
          .toContainText('Cement 0');
        await expect(page.locator('[data-testid="facility-inventories"]'))
          .toContainText('Steel 0');
        await expect(page.locator('[data-testid="facility-rail"]'))
          .toContainText('connected');

        if (seedCase.viewport.width <= 720) {
          const facilityInspector =
            '[data-testid="facility-inspector"]';
          await assertVisibleWithinViewport(page, facilityInspector);
          for (const selector of [
            '[data-testid="facility-name"]',
            '[data-testid="facility-status"]',
            '[data-testid="facility-inventories"]',
            '[data-testid="facility-quotes"]',
            '[data-testid="facility-rail"]',
          ]) {
            await assertReachableWithinScrollableViewport(
              page,
              facilityInspector,
              selector,
            );
          }
        }
        await assertNoViewportOverflow(page);
        await returnToCreateThroughPause(page, false);
        const beforeReload = await snapshot(page);
        const expectedPersisted = persistedJourneyState(beforeReload);
        await quitToMenuThroughPause(page);
        await openOnlySavedWorld(page);
        const reloaded = await snapshot(page);
        expect(persistedJourneyState(reloaded)).toEqual(expectedPersisted);
        expect(reloaded.world.company.ledger.filter(
          ({ referenceId }) =>
            referenceId === DEVELOPMENT_GRANT_REFERENCE,
        )).toHaveLength(1);
        await assertNoViewportOverflow(page);
        expect(errors).toHaveLength(0);
        console.info(JSON.stringify({
          seed: seedCase.seed,
          mobile: seedCase.viewport.width <= 720,
          ticks: checkpoint.world.economy.tick,
          tracks: checkpoint.world.tracks.length,
          extensionCost:
            categoryTotal(extended, 'construction-capex')
            - categoryTotal(starter, 'construction-capex'),
          deliveryRevenue: categoryTotal(checkpoint, 'delivery-revenue'),
          runningCosts: categoryTotal(checkpoint, 'train-running-cost'),
          cash: checkpoint.world.company.cash,
        }));
      } finally {
        await page.keyboard.up('w');
        await page.keyboard.up('s');
      }
    });
  }
});
