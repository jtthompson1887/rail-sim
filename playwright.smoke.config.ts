import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Short playable checks for the current regional game. */
export default defineConfig({
  ...base,
  outputDir: './test-results-smoke',
});
