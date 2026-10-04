const http = require('http');
const path = require('path');
const webpack = require('webpack');
const { chromium } = require('playwright');

const workspace = path.resolve(__dirname, '../..');
const outputPath = path.join(workspace, 'test-results', 'train-physics-lab');
const bundleName = 'train-physics-browser.js';

function buildHarness() {
  return new Promise((resolve, reject) => {
    webpack({
      mode: 'development',
      target: 'web',
      context: workspace,
      entry: path.join(__dirname, 'train-physics-browser-entry.ts'),
      output: { path: outputPath, filename: bundleName },
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

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body style="margin:0"><div id="game"></div></body></html>');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

(async () => {
  process.stdout.write('[train-physics-browser] boundary=build-start\n');
  await buildHarness();
  process.stdout.write('[train-physics-browser] boundary=build-complete\n');
  const harness = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (error) => {
      process.stdout.write(`[train-physics-browser] page-error=${error.message}\n`);
    });
    await page.goto(harness.url);
    await page.addScriptTag({ path: require.resolve('phaser/dist/phaser.js') });
    await page.addScriptTag({ path: path.join(outputPath, bundleName) });

    const scenarioIds = [
      'safe-constant-radius-curve',
      'mixed-power-consist',
      '40-car-acceptance',
    ];
    const results = [];
    for (const scenarioId of scenarioIds) {
      await page.evaluate((id) => window.__prepareTrainPhysicsLab(id), scenarioId);
      const result = await page.evaluate(() => {
        const metrics = window.__runTrainPhysicsLab();
        return { metrics, report: window.__trainPhysicsLabReport };
      });
      results.push({ scenarioId, ...result });
    }
    process.stdout.write(`[train-physics-browser] ${JSON.stringify(results)}\n`);
    const valid = results.every(({ metrics, report }) => (
      report
      && report.replayMatches
      && report.allMetricsFinite
      && typeof metrics.replayHash === 'string'
      && Number.isFinite(metrics.durationMs)
    ));
    if (!valid) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise((resolve) => harness.server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
