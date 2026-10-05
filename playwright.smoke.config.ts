import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Short playable checks for the current regional game. */
export default defineConfig({
  ...base,
  testMatch: ['**/*riverside*.test.ts', '**/vehicle-purchase.test.ts'],
  outputDir: './test-results-smoke',
});
