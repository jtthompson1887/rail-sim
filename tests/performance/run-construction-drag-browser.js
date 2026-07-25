const os = require('os');
const http = require('http');
const path = require('path');
const webpack = require('webpack');
const { chromium } = require('playwright');

const workspace = path.resolve(__dirname, '../..');
const outputPath = path.join(workspace, 'test-results', 'construction-drag-benchmark');
const bundleName = 'construction-drag-browser.js';

function buildHarness() {
  return new Promise((resolve, reject) => {
    webpack({
      mode: 'development',
      target: 'web',
      context: workspace,
      entry: path.join(__dirname, 'construction-drag-browser-entry.ts'),
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
      response.end('<!doctype html><html><body><div id="game"></div></body></html>');
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

async function drivePointerMoves(page) {
  for (let index = 0; index < 500; index++) {
    await page.mouse.move(
      250 + index * 2.8,
      540 + Math.sin(index / 11) * 140,
    );
  }
}

(async () => {
  process.stdout.write('[construction-drag-browser] boundary=build-start\n');
  await buildHarness();
  process.stdout.write('[construction-drag-browser] boundary=build-complete\n');
  const harnessServer = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  try {
    process.stdout.write('[construction-drag-browser] boundary=browser-launched\n');
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('console', (message) => {
      process.stdout.write(`[construction-drag-browser] page-console=${message.text()}\n`);
    });
    page.on('pageerror', (error) => {
      process.stdout.write(`[construction-drag-browser] page-error=${error.message}\n`);
    });
    await page.goto(harnessServer.url);
    process.stdout.write('[construction-drag-browser] boundary=page-ready\n');
    await page.addScriptTag({
      path: require.resolve('phaser/dist/phaser.js'),
    });
    process.stdout.write('[construction-drag-browser] boundary=phaser-ready\n');
    await page.addScriptTag({ path: path.join(outputPath, bundleName) });
    process.stdout.write('[construction-drag-browser] boundary=script-ready\n');
    await page.evaluate(() => window.__prepareConstructionDragBenchmark());
    await page.mouse.move(100, 540);
    await page.mouse.down();
    await drivePointerMoves(page);
    process.stdout.write('[construction-drag-browser] boundary=benchmark-start\n');
    await page.evaluate(() => window.__beginConstructionDragMeasurement());
    await drivePointerMoves(page);
    const result = await page.evaluate(
      () => window.__finishConstructionDragBenchmark(),
    );
    await page.mouse.up();
    process.stdout.write('[construction-drag-browser] boundary=benchmark-complete\n');
    const record = {
      ...result,
      targetMs: 16,
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      browser: `Chromium ${await browser.version()}`,
    };
    process.stdout.write(`[construction-drag-browser] ${JSON.stringify(record)}\n`);
    if (result.samples !== 500 || !Number.isFinite(result.p95Ms) || result.p95Ms >= 16) {
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
