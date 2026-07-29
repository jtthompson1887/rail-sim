const configFactory = require('../../webpack.config.js');

describe('webpack test-control boundary', () => {
  function compileFlag(config: any): unknown {
    const plugin = config.plugins.find(
      (candidate: any) => candidate?.definitions?.__RAIL_SIM_TEST_CONTROLS__
        !== undefined,
    );
    return plugin?.definitions.__RAIL_SIM_TEST_CONTROLS__;
  }

  it('hard-disables privileged controls in the default production build', () => {
    const config = configFactory({}, { mode: 'production' });

    expect(compileFlag(config)).toBe('false');
  });

  it('enables privileged controls only through the explicit test-build flag', () => {
    const config = configFactory(
      { testControls: true },
      { mode: 'production' },
    );

    expect(compileFlag(config)).toBe('true');
  });
});
