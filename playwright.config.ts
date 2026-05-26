import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:8080',
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
    /** Build must have been run before executing the e2e suite. */
    command: 'npx serve dist -p 8080 -s --no-clipboard',
    port: 8080,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
