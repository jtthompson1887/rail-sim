import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Broader browser coverage; historical manual freight journeys stay optional. */
export default defineConfig({
  ...base,
  testMatch: '**/*.test.ts',
  outputDir: './test-results-extended',
});
