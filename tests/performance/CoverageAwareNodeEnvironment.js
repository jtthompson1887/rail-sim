const { TestEnvironment } = require('jest-environment-node');

module.exports = class CoverageAwareNodeEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    Object.defineProperty(
      this.global,
      '__RAIL_SIM_COLLECT_COVERAGE__',
      {
        value: config.globalConfig.collectCoverage,
        writable: false,
        configurable: false,
      },
    );
  }
};
