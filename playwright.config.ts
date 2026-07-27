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

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: serverUrl,
    // Allow WebGL / Canvas; SW renderer keeps CI happy without a GPU
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-webgl',
      ],
    },
  },
  webServer: {
    command: `npm run build:test-controls && npx serve dist/client -p ${port} -s --no-clipboard`,
    url: serverUrl,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
