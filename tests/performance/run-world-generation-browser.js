const http = require('http');
const os = require('os');
const path = require('path');
const webpack = require('webpack');
const { chromium } = require('playwright');

const workspace = path.resolve(__dirname, '../..');
const outputPath = path.join(workspace, 'test-results', 'world-generation-benchmark');
const bundleName = 'world-generation-browser.js';
const targetMs = process.env.CI ? 5_000 : 2_000;

function buildHarness() {
  return new Promise((resolve, reject) => {
    webpack({
      mode: 'development',
      target: 'web',
      context: workspace,
      entry: path.join(__dirname, 'world-generation-browser-entry.ts'),
      output: {
        path: outputPath,
        filename: bundleName,
      },
      resolve: { extensions: ['.ts', '.js'] },
      module: {
        rules: [{
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: 'ts-loader',
            options: { transpileOnly: true },
          },
        }],
      },
      externals: { phaser: 'Phaser' },
      devtool: false,
    }, (error, stats) => {
      if (error) return reject(error);
      if (stats.hasErrors()) {
        return reject(new Error(stats.toString({ all: false, errors: true })));
      }
      resolve();
    });
  });
}

function startHarnessServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body></body></html>');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

(async () => {
  process.stdout.write('[world-generation-browser] boundary=build-start\n');
  await buildHarness();
  process.stdout.write('[world-generation-browser] boundary=build-complete\n');
  const harnessServer = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(harnessServer.url);
    await page.addScriptTag({ path: require.resolve('phaser/dist/phaser.js') });
    await page.addScriptTag({ path: path.join(outputPath, bundleName) });
    const measurement = await page.evaluate(
      () => window.__runWorldGenerationBenchmark(),
    );
    const record = {
      ...measurement,
      targetMs,
      target: process.env.CI ? 'ci-smoke' : 'local',
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      browser: `Chromium ${await browser.version()}`,
    };
    process.stdout.write(`[world-generation-browser] ${JSON.stringify(record)}\n`);

    const exactObservedWorstCase = measurement.seed === 'playtest-644'
      && measurement.opportunityResult.ok === true
      && measurement.opportunityResult.opportunity.resolvedAttempt === 9
      && measurement.opportunityResult.diagnostics.attemptsEvaluated === 9
      && measurement.opportunityResult.diagnostics.maxSiteCandidatesEvaluated === 256
      && measurement.economyResult.ok === true
      && measurement.economyResult.economy.facilities.length === 7
      && measurement.economyResult.diagnostics.candidatesEvaluated
        <= measurement.economyCandidatesCap;
    if (!exactObservedWorstCase
      || measurement.attemptsCap !== 12
      || measurement.candidatesCap !== 256
      || measurement.economyCandidatesCap !== 256
      || measurement.analysisSamplesCap !== 96
      || measurement.deterministicReplay !== true
      || !Number.isFinite(measurement.durationMs)
      || measurement.durationMs >= targetMs) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => harnessServer.server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
