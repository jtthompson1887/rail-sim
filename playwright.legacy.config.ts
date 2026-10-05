import { defineConfig } from '@playwright/test';
import base, { LEGACY_JOURNEY_FILES } from './playwright.config';

/** Opt-in historical journeys can take tens of minutes and are never a fast gate. */
export default defineConfig({
  ...base,
  testMatch: LEGACY_JOURNEY_FILES,
  testIgnore: [],
  grepInvert: undefined,
  retries: 0,
  outputDir: './test-results-legacy',
});
