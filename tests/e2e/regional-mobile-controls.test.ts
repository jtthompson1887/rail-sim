import { expect, test, type Page } from '@playwright/test';
import { createLegacyWorld } from './helpers/CreateLegacyWorld';

const PHONE = { width: 844, height: 390 };
const SMALL_PHONE = { width: 668, height: 375 };

const renderedFrame = (page: Page): Promise<void> => page.evaluate(() =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

async function waitForScene(page: Page, scene: string): Promise<void> {
  await page.waitForFunction((name) => window.__railSimScene === name, scene, { timeout: 60_000 });
  await renderedFrame(page);
}

async function tapSceneLabel(page: Page, sceneName: string, label: string): Promise<void> {
  const position = await page.evaluate(({ sceneName, label }) => {
    const scene = window.__railSimGame.scene.getScene(sceneName);
    const text = scene.children.list.find((object) => (object as unknown as { text?: string }).text === label);
    if (!text) throw new Error(`No visible ${label} in ${sceneName}`);
    const bounds = (text as unknown as { getBounds(): { centerX: number; centerY: number } }).getBounds();
    return { x: bounds.centerX, y: bounds.centerY, width: scene.scale.width, height: scene.scale.height };
  }, { sceneName, label });
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('The game canvas must be visible');
  await page.touchscreen.tap(canvas.x + position.x * canvas.width / position.width,
    canvas.y + position.y * canvas.height / position.height);
}

async function openWorldList(page: Page): Promise<void> {
  await page.goto('/');
  await waitForScene(page, 'MenuScene');
  await tapSceneLabel(page, 'MenuScene', 'New World');
  await waitForScene(page, 'WorldSelectScene');
}

async function reopenSavedWorld(page: Page): Promise<void> {
  await openWorldList(page);
  const viewport = page.viewportSize()!;
  await page.locator('canvas').tap({ position: { x: viewport.width / 2, y: 200 } });
  await waitForScene(page, 'WorldScene');
  await expect(page.getByTestId('company-hud')).toBeVisible();
}

const managementState = (page: Page) => page.evaluate(() => {
  const world = window.__railSimFirstRouteHarness!.snapshot().world;
  return { id: world.id, speed: world.management?.speed ?? null,
    clock: world.management?.clockSeconds ?? null, tick: world.economy.tick };
});

const touchHud = (page: Page) => page.evaluate(() => {
  const scene = window.__railSimGame.scene.getScene('HUDScene');
  const controls = (scene as unknown as {
    mobileControls: Array<{ active: boolean; visible: boolean; input?: { enabled?: boolean };
      getBounds(): { width: number; height: number } }>;
  }).mobileControls;
  return {
    count: controls.length,
    visible: controls.every((control) => control.active && control.visible),
    interactiveSizes: controls.filter((control) => control.input?.enabled)
      .map((control) => ({ width: control.getBounds().width, height: control.getBounds().height })),
    throttleLabels: scene.children.list.filter((object) =>
      (object as unknown as { text?: string; active?: boolean }).text === 'THROTTLE'
      && (object as unknown as { active?: boolean }).active !== false).length,
  };
});

async function expectRegionalHud(page: Page): Promise<void> {
  await expect.poll(async () => {
    const hud = await touchHud(page);
    return { controls: hud.count, labels: hud.throttleLabels };
  }).toEqual({ controls: 0, labels: 0 });
  const panel = page.getByRole('region', { name: 'Railway management', exact: true });
  await expect(panel.getByRole('button', { name: '1× simulation speed', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Pause railway', exact: true })).toBeVisible();
}

async function saveRegionalWorld(page: Page): Promise<void> {
  const panel = page.getByRole('region', { name: 'Railway management', exact: true });
  await panel.getByRole('button', { name: 'Company', exact: true }).tap();
  await panel.getByRole('button', { name: 'Save world', exact: true }).tap();
  await expect(panel.getByRole('status')).toHaveText('World saved.');
}

async function durableWorldCopies(page: Page, id: string): Promise<number> {
  return page.evaluate((worldId) => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('rail-sim-durable-saves');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('files', 'readonly');
      const files = transaction.objectStore('files').getAll();
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.oncomplete = () => {
        const count = files.result.filter((value) => {
          try { return typeof value === 'string' && JSON.parse(value).worldId === worldId; }
          catch { return false; }
        }).length;
        database.close(); resolve(count);
      };
    };
  }), id);
}

test.describe('regional mobile control ownership', () => {
  test.use({ hasTouch: true, viewport: PHONE });

  test('a newly created region uses touch clock controls through resize and durable reload', async ({ page }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openWorldList(page);
    await tapSceneLabel(page, 'WorldSelectScene', '+ New World');
    const picker = page.getByRole('dialog', { name: 'Create railway region' });
    await expect(picker).toBeVisible();
    await picker.getByLabel('World seed').fill('regional-touch-hud');
    await picker.getByLabel('Landscape').selectOption('lowlands');
    await picker.getByRole('button', { name: 'Create region', exact: true }).tap();
    await waitForScene(page, 'WorldScene');
    await expectRegionalHud(page);
    const initial = await managementState(page);
    expect(initial.speed).toBe(0);
    const panel = page.getByRole('region', { name: 'Railway management', exact: true });
    await panel.getByRole('button', { name: 'Railway', exact: true }).tap();
    await panel.getByRole('button', { name: '1× simulation speed', exact: true }).tap();
    await expect.poll(async () => (await managementState(page)).speed).toBe(1);
    await expect.poll(async () => (await managementState(page)).clock!).toBeGreaterThan(initial.clock! + 0.2);
    await panel.getByRole('button', { name: 'Pause railway', exact: true }).tap();
    await expect.poll(async () => (await managementState(page)).speed).toBe(0);
    const paused = await managementState(page);
    await page.waitForTimeout(600);
    expect(await managementState(page)).toEqual(paused);
    await page.setViewportSize(SMALL_PHONE);
    await renderedFrame(page);
    await expectRegionalHud(page);
    await saveRegionalWorld(page);
    expect(await durableWorldCopies(page, initial.id)).toBeGreaterThan(0);
    await reopenSavedWorld(page);
    await expectRegionalHud(page);
    expect(await managementState(page)).toEqual(paused);
    expect(errors).toEqual([]);
  });

  test('opting a durably reloaded legacy world into regional play removes its legacy touch throttle', async ({ page }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openWorldList(page);
    const id = await createLegacyWorld(page, 'playtest-753');
    await waitForScene(page, 'WorldScene');
    expect((await managementState(page)).speed).toBeNull();
    expect((await touchHud(page)).count).toBe(5);

    // A clean navigation uses normal IndexedDB startup, which durably migrates
    // the fixture's legacy save and exposes the public regional opt-in panel.
    await reopenSavedWorld(page);
    expect(new URL(page.url()).searchParams.has('legacyAcceptanceFixture')).toBe(false);
    expect(await durableWorldCopies(page, id)).toBeGreaterThan(0);
    expect((await managementState(page)).id).toBe(id);
    expect((await managementState(page)).speed).toBeNull();
    const legacyHud = await touchHud(page);
    expect(legacyHud.count).toBe(5);
    expect(legacyHud.visible).toBe(true);
    expect(legacyHud.interactiveSizes).toHaveLength(2);
    expect(legacyHud.interactiveSizes.every((bounds) => bounds.width >= 44 && bounds.height >= 44)).toBe(true);
    // Enter the legacy operating view through its visible touch mode toggle;
    // that closes the legacy purchase panel before using the regional opt-in.
    await tapSceneLabel(page, 'EditorUIScene', '▶ Play');
    await expect(page.getByTestId('vehicle-purchase-panel')).toBeHidden();
    expect((await touchHud(page)).count).toBe(5);
    const panel = page.getByRole('region', { name: 'Railway management', exact: true });
    await panel.getByRole('button', { name: 'Railway', exact: true }).tap();
    await panel.getByRole('button', { name: 'Start regional play', exact: true }).tap();
    await expectRegionalHud(page);
    expect((await managementState(page)).speed).toBe(0);
    await page.setViewportSize(SMALL_PHONE);
    await renderedFrame(page);
    await expectRegionalHud(page);
    await saveRegionalWorld(page);
    await reopenSavedWorld(page);
    await expectRegionalHud(page);
    expect((await managementState(page)).id).toBe(id);
    expect(errors).toEqual([]);
  });
});
