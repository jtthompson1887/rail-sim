const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'rail-sim-electron-smoke-'));
  let application;
  let activePage;
  let stage = 'launch';
  const errors = [];
  const launch = async () => {
    const app = await electron.launch({
      ...(process.env.RAIL_SIM_PACKAGED_EXE ? { executablePath: path.resolve(process.env.RAIL_SIM_PACKAGED_EXE) } : {}),
      args: process.env.RAIL_SIM_PACKAGED_EXE ? [] : [path.resolve(__dirname, '../../native/electron/main.cjs')],
      env: { ...process.env, RAIL_SIM_SMOKE_TEST: '1', RAIL_SIM_TEST_USER_DATA: userData },
      timeout: 30000,
    });
    application = app;
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 700));
    activePage = page;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => Math.abs(innerWidth - 1366) <= 1 && Math.abs(innerHeight - 700) <= 1);
    await page.locator('canvas').waitFor({ timeout: 30000 });
    // Local preload assets finish before the menu accepts input; no development test hooks are needed.
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => window.railSimStorage !== undefined);
    return { app, page };
  };
  const newestWorld = (page) => page.evaluate(async () => {
    const envelopes = await Promise.all((await window.railSimStorage.list('world-'))
      .filter((key) => /\.slot-[ab]$/.test(key))
      .map(async (key) => JSON.parse(await window.railSimStorage.read(key))));
    envelopes.sort((left, right) => right.sequence - left.sequence);
    if (!envelopes.length) throw new Error('The real game has not written a native world');
    return JSON.parse(envelopes[0].payload);
  });
  const closeWithAcknowledgement = async (app) => {
    const closed = app.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
  };
  const settleScene = (page) => page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  try {
    const first = await launch();
    application = first.app;
    const page = first.page;
    await page.evaluate(async () => {
      if (typeof window.require !== 'undefined') throw new Error('Node leaked into the renderer');
      await window.railSimStorage.write('smoke-check', 'offline storage works');
      if (await window.railSimStorage.read('smoke-check') !== 'offline storage works') throw new Error('Native storage mismatch');
      await window.railSimStorage.remove('smoke-check');
    });
    const rehearsal = await page.evaluate(() => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('rehearsal-worker.js', document.baseURI));
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Native rehearsal worker timed out')); }, 10000);
      worker.onerror = (event) => { clearTimeout(timeout); worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = (event) => {
        clearTimeout(timeout); worker.terminate();
        if (event.data.type === 'result') resolve(event.data.result);
        else reject(new Error(event.data.message));
      };
      worker.postMessage({ type: 'run', request: {
        requestId: 'native-worker-check', horizonSeconds: 1,
        world: { schemaVersion: 11, id: 'native-worker-fixture', name: 'Worker smoke fixture',
          revision: 0, constructionRevision: 0, operationsRevision: 0,
          tracks: [], junctions: [], stations: [], trains: [], scenery: [],
          generationConfig: { generationConfigVersion: 1, seed: 'native-worker-check', biome: 'temperate', constructionDifficultyId: 'standard' },
          company: { cash: 100000, nextLedgerId: 2, ledger: [{ id: 1, tick: 0, category: 'opening-balance', ledgerClass: 'opening', amount: 100000, referenceId: 'opening-balance' }] },
          economy: { economyVersion: 1, tick: 0, facilities: [], market: { constructionIndexBps: 10000, regionalDemandBpsByProduct: {} } },
          freightProgress: { progressVersion: 1, profitableLogDeliveryCompleted: false, developmentGrantAwarded: false,
            profitableStructuralTimberDeliveryCompleted: false, profitableLimestoneDeliveryCompleted: false,
            profitableCementDeliveryCompleted: false, profitableSteelDeliveryCompleted: false, profitableBuildingModuleDeliveryCompleted: false },
          metadata: { createdAt: 0, updatedAt: 0 } },
      } });
    }));
    assert.equal(rehearsal.status, 'complete');
    assert.equal(rehearsal.elapsedSeconds, 1);
    assert.equal(rehearsal.requestId, 'native-worker-check');
    assert.equal(new URL(page.url()).protocol, 'rail-sim:');
    const localOrigin = page.url();
    stage = 'create actual region';
    await settleScene(page);
    await page.locator('canvas').click({ position: { x: 983, y: 307 } });
    await settleScene(page);
    await page.locator('canvas').click({ position: { x: 683, y: 610 } });
    const picker = page.getByRole('dialog', { name: 'Create railway region' });
    await picker.waitFor({ timeout: 15000 });
    await picker.getByLabel('Region name').fill('Native smoke railway');
    await picker.getByLabel('World seed').fill('native-storage-check');
    await picker.getByLabel('Landscape').selectOption('lowlands');
    await picker.getByRole('button', { name: 'Create region', exact: true }).click();
    stage = 'construct and save';
    const panel = page.locator('.railway-panel');
    await panel.getByRole('button', { name: 'Railway', exact: true }).click();
    await panel.getByRole('button', { name: 'Plans', exact: true }).click();
    await panel.locator('[name="from"]').selectOption('managed-forest');
    await panel.locator('[name="to"]').selectOption('sawmill');
    await panel.getByRole('button', { name: 'Preview connection', exact: true }).click();
    await panel.getByRole('button', { name: 'Build draft', exact: true }).click();
    await panel.getByRole('button', { name: 'Company', exact: true }).click();
    await panel.getByRole('button', { name: 'Save world', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: 'World saved.' }).waitFor();
    const saved = await newestWorld(page);
    assert.equal(saved.name, 'Native smoke railway');
    assert.equal(saved.management.speed, 0);
    assert.ok(saved.tracks.length > 0, 'The game must persist player-built infrastructure');
    await panel.getByRole('button', { name: '1× simulation speed', exact: true }).click();
    await closeWithAcknowledgement(application);
    application = undefined;
    stage = 'reopen actual region';
    const closedEnvelopes = await Promise.all((await fs.readdir(path.join(userData, 'saves')))
      .filter((key) => /\.slot-[ab]$/.test(key))
      .map(async (key) => JSON.parse(await fs.readFile(path.join(userData, 'saves', key), 'utf8'))));
    closedEnvelopes.sort((left, right) => right.sequence - left.sequence);
    const closedWorld = JSON.parse(closedEnvelopes[0].payload);
    assert.equal(closedWorld.management.speed, 0, 'Native close must persist a paused clock');
    assert.ok(closedWorld.management.clockSeconds >= saved.management.clockSeconds);
    assert.deepEqual(closedWorld.tracks, saved.tracks);
    const second = await launch();
    application = second.app;
    await settleScene(second.page);
    await second.page.locator('canvas').click({ position: { x: 983, y: 307 } });
    await settleScene(second.page);
    await second.page.locator('canvas').click({ position: { x: 683, y: 200 } });
    await second.page.locator('.railway-panel').getByRole('button', { name: 'Railway', exact: true }).click();
    await second.page.locator('.railway-panel').getByRole('button', { name: 'Company', exact: true }).click();
    assert.equal(await second.page.locator('[name="company-name"]').inputValue(), saved.name);
    const reopened = await newestWorld(second.page);
    assert.equal(reopened.id, saved.id);
    assert.deepEqual(reopened.tracks, saved.tracks);
    assert.deepEqual(reopened.company, closedWorld.company);
    assert.equal(reopened.management.speed, 0);
    assert.deepEqual(errors, []);
    await closeWithAcknowledgement(application);
    application = undefined;
    console.log(JSON.stringify({ nativeDesktop: 'passed', packagedApp: Boolean(process.env.RAIL_SIM_PACKAGED_EXE), localOrigin, rendererSandbox: true, nativeStorage: 'passed', rehearsalWorker: 'passed', constructedWorldReopened: 'passed', durableCloseAcknowledgement: 'passed' }));
  } catch (error) {
    console.error(`Native smoke failed during ${stage}:`, error);
    if (activePage && !activePage.isClosed()) {
      console.error(await activePage.evaluate(() => ({ hidden: document.hidden, viewport: [innerWidth, innerHeight], canvas: document.querySelector('canvas')?.getBoundingClientRect().toJSON(), body: document.body.innerText.slice(0, 1200) })).catch(() => undefined));
      await activePage.screenshot({ path: 'test-results/native-smoke-failure.png', timeout: 5000 }).catch(() => undefined);
    }
    throw error;
  } finally {
    if (application) {
      // A failed-close modal intentionally keeps the app alive; terminate only this test's child.
      const child = application.process();
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await exited;
      }
      await application.close().catch(() => undefined);
    }
    // The test creates this exact temporary directory and never touches user saves.
    assert.equal(path.dirname(path.resolve(userData)), path.resolve(os.tmpdir()));
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
