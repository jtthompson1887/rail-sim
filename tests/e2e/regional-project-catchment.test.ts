import { test, expect, type Page } from '@playwright/test';
import { TrackArcLengthIndex } from '../../src/physics/TrackArcLengthIndex';
import { TRAIN_PHYSICS_CONFIG } from '../../src/physics/TrainPhysicsConfig';

const world = (page: Page) => page.evaluate(() => window.__railSimFirstRouteHarness!.snapshot().world);

test('nearby passenger arrivals advance housing through real station and service controls', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 700 });
  await page.goto('/');
  await page.waitForFunction(() => window.__railSimScene === 'MenuScene');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__railSimScene === 'WorldSelectScene');
  await page.locator('canvas').click({ position: { x: 683, y: 610 } });
  const picker = page.getByRole('dialog', { name: 'Create railway region' });
  await picker.getByLabel('World seed').fill('playtest-884');
  await picker.getByLabel('Landscape').selectOption('lowlands');
  await picker.getByRole('button', { name: 'Create region', exact: true }).click();
  await page.waitForFunction(() => window.__railSimScene === 'WorldScene');
  const panel = page.locator('.railway-panel');
  await panel.getByRole('button', { name: 'Railway', exact: true }).click();
  const initial = await world(page);
  const works = initial.economy.facilities.find(f => f.definitionId === 'prefabrication-plant')!;
  const town = initial.economy.facilities.find(f => f.definitionId === 'town-construction-market')!;

  await panel.getByRole('button', { name: 'Plans', exact: true }).click();
  await panel.locator('[name="from"]').selectOption(works.id);
  await panel.locator('[name="to"]').selectOption(town.id);
  await panel.getByRole('button', { name: 'Preview connection', exact: true }).click();
  await panel.getByRole('button', { name: 'Build draft', exact: true }).click();
  const railway = await world(page);
  expect(railway.tracks.length).toBe(1);
  const index = new TrackArcLengthIndex(railway.tracks[0], TRAIN_PHYSICS_CONFIG.arcSampleSpacing);
  const positions = Array.from({ length: 91 }, (_, i) => i + 5).filter(percent => {
    const distance = index.distanceAtParameter(percent / 100);
    return distance >= 300 && index.length - distance >= 300;
  });
  const originPercent = positions[0];
  const destinationPercent = positions[positions.length - 1];
  expect(originPercent).toBeDefined();
  expect(destinationPercent).toBeDefined();
  const originPoint = index.poseAtDistance(index.distanceAtParameter(originPercent / 100)).point;
  const destinationPoint = index.poseAtDistance(index.distanceAtParameter(destinationPercent / 100)).point;
  expect(Math.hypot(originPoint.x - town.x, originPoint.y - town.y)).toBeGreaterThan(1200);
  expect(Math.hypot(destinationPoint.x - town.x, destinationPoint.y - town.y)).toBeLessThanOrEqual(1200);
  const setPlatformPosition = async (percent: number) => {
    const slider = panel.getByLabel('Position (%)', { exact: true });
    await slider.press('Home');
    for (let value = 5; value < percent; value++) await slider.press('ArrowRight');
    await expect(slider).toHaveValue(String(percent));
  };

  await panel.getByRole('button', { name: 'Stations', exact: true }).click();
  await panel.getByLabel('Station name', { exact: true }).fill('Works origin');
  await setPlatformPosition(originPercent);
  await panel.getByLabel('Platform length (m)', { exact: true }).fill('50');
  await panel.getByRole('button', { name: 'Build platform', exact: true }).click();
  await panel.getByLabel('Station name', { exact: true }).fill('Homes access');
  await setPlatformPosition(destinationPercent);
  await panel.getByLabel('Platform length (m)', { exact: true }).fill('50');
  await panel.getByRole('button', { name: 'Build platform', exact: true }).click();
  const built = await world(page);
  const origin = built.stations.find(s => s.name === 'Works origin')!;
  const destination = built.stations.find(s => s.name === 'Homes access')!;
  expect(origin).toBeDefined();
  expect(destination).toBeDefined();
  expect(origin.trackT).toBe(originPercent / 100);
  expect(destination.trackT).toBe(destinationPercent / 100);

  await panel.getByRole('button', { name: 'Projects', exact: true }).click();
  const housing = panel.locator('.rp-card').filter({ has: page.getByRole('heading', { name: 'Homes by the Railway', exact: true }) });
  const stations = housing.getByRole('combobox', { name: 'Passenger station', exact: true });
  await expect(stations.locator(`option[value="${destination.id}"]`)).toHaveCount(1);
  await expect(stations.locator(`option[value="${origin.id}"]`)).toHaveCount(0);
  await expect(stations).toHaveValue('');
  await housing.getByRole('button', { name: 'Accept project', exact: true }).click();
  expect((await world(page)).region!.projects.find(p => p.definitionId === 'housing')!.stationId).toBeNull();

  await panel.getByRole('button', { name: 'Fleet', exact: true }).click();
  await panel.locator('[name="family"]').selectOption('regional-dmu');
  await panel.getByRole('button', { name: 'Buy and place train', exact: true }).click();
  expect((await world(page)).trains).toHaveLength(1);
  await panel.getByRole('button', { name: 'Services', exact: true }).click();
  await panel.locator('[name="service-name"]').fill('Homes shuttle');
  await panel.locator('[name="kind"]').selectOption('passenger');
  await panel.locator('[name="stop-0"]').selectOption('station:' + origin.id);
  await panel.locator('[name="stop-1"]').selectOption('station:' + destination.id);
  await panel.locator('[name="wait"]').fill('1');
  await panel.getByRole('button', { name: 'Start service', exact: true }).click();
  expect((await world(page)).management!.services[0].kind).toBe('passenger');
  await panel.getByRole('button', { name: '4× simulation speed', exact: true }).click();
  await expect.poll(async () => (await world(page)).region!.projects.find(p => p.definitionId === 'housing')!.progress.residents,
    { timeout: 150_000, intervals: [250, 500, 1000] }).toBeGreaterThan(0);
  await panel.getByRole('button', { name: 'Pause railway', exact: true }).click();
  const paused = await world(page);
  const progress = paused.region!.projects.find(p => p.definitionId === 'housing')!;
  expect(progress.stationId).toBeNull();
  expect(progress.progress.modules).toBe(0);
  expect(progress.completedAtTick).toBeNull();
  expect(paused.company.ledger.some(entry => entry.referenceId === 'project:housing')).toBe(false);
  expect(paused.management!.passengers.arrived).toBeGreaterThanOrEqual(progress.progress.residents);

  await panel.getByRole('button', { name: 'Company', exact: true }).click();
  await panel.getByRole('button', { name: 'Save world', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('World saved.');
  await page.reload();
  await page.waitForFunction(() => window.__railSimScene === 'MenuScene');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__railSimScene === 'WorldSelectScene');
  await page.locator('canvas').click({ position: { x: 683, y: 200 } });
  await page.waitForFunction(() => window.__railSimScene === 'WorldScene');
  expect((await world(page)).region).toEqual(paused.region);
  expect(errors).toEqual([]);
});
