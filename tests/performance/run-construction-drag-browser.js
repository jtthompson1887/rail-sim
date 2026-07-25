const os = require('os');
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

(async () => {
  process.stdout.write('[construction-drag-browser] boundary=build-start\n');
  await buildHarness();
  process.stdout.write('[construction-drag-browser] boundary=build-complete\n');
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
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(() => {
      if (!crypto.randomUUID) {
        let sequence = 0;
        crypto.randomUUID = () => (
          `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`
        );
      }
    });
    process.stdout.write('[construction-drag-browser] boundary=page-ready\n');
    await page.addScriptTag({ path: path.join(outputPath, bundleName) });
    process.stdout.write('[construction-drag-browser] boundary=script-ready\n');
    process.stdout.write('[construction-drag-browser] boundary=benchmark-start\n');
    const result = await page.evaluate(() => window.__runConstructionDragBenchmark());
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
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
