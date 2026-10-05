const base = require('./jest.config');

/** Full coverage and performance tests are an explicit extended check. */
module.exports = {
  ...base,
  collectCoverage: true,
  testMatch: [...base.testMatch, '**/tests/performance/**/*.test.ts'],
};
