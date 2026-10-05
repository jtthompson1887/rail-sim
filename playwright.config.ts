import { defineConfig } from '@playwright/test';

const rawPort = process.env.PLAYWRIGHT_PORT ?? '41719';
if (!/^\d+$/.test(rawPort)) {
  throw new Error(`PLAYWRIGHT_PORT must be an integer from 1 to 65535; received "${rawPort}"`);
}

const port = Number(rawPort);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PLAYWRIGHT_PORT must be an integer from 1 to 65535; received "${rawPort}"`);
}

const serverUrl = `http://127.0.0.1:${port}`;

export const LEGACY_JOURNEY_FILES = [
  '**/first-freight-route.test.ts',
  '**/structural-timber-link.test.ts',
  '**/cement-supply-chain.test.ts',
  '**/regional-construction-supply.test.ts',
];

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    '**/*riverside*.test.ts',
  ],
  testIgnore: LEGACY_JOURNEY_FILES,
  grepInvert: /@legacy/,
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: serverUrl,
    // Allow WebGL / Canvas; SW renderer keeps CI happy without a GPU
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-webgl',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  webServer: {
    command: `${process.env.PLAYWRIGHT_REUSE_BUILD === '1' ? '' : 'npm run build:test-controls && '}npx serve dist/client -p ${port} -s --no-clipboard`,
    url: serverUrl,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
