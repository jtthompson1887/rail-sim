/**
 * @jest-environment node
 */

jest.mock('@playwright/test', () => ({
  defineConfig: (config: PlaywrightConfig) => config,
}));

type PlaywrightConfig = {
  use?: {
    baseURL?: string;
  };
  webServer?: {
    command: string;
    url?: string;
    reuseExistingServer?: boolean;
  };
};

const loadConfig = (port?: string): PlaywrightConfig => {
  const previousPort = process.env.PLAYWRIGHT_PORT;

  jest.resetModules();
  if (port === undefined) {
    delete process.env.PLAYWRIGHT_PORT;
  } else {
    process.env.PLAYWRIGHT_PORT = port;
  }

  try {
    return require('../../playwright.config').default as PlaywrightConfig;
  } finally {
    if (previousPort === undefined) {
      delete process.env.PLAYWRIGHT_PORT;
    } else {
      process.env.PLAYWRIGHT_PORT = previousPort;
    }
  }
};

describe('Playwright browser gate configuration', () => {
  it('builds test-controlled source before serving it on a dedicated non-reused port', () => {
    const config = loadConfig();

    expect(config.use?.baseURL).toBe('http://127.0.0.1:41719');
    expect(config.webServer).toEqual(expect.objectContaining({
      command: 'npm run build:test-controls && npx serve dist -p 41719 -s --no-clipboard',
      url: 'http://127.0.0.1:41719',
      reuseExistingServer: false,
    }));
  });

  it('uses one validated port override for the browser and server', () => {
    const config = loadConfig('43123');

    expect(config.use?.baseURL).toBe('http://127.0.0.1:43123');
    expect(config.webServer).toEqual(expect.objectContaining({
      command: 'npm run build:test-controls && npx serve dist -p 43123 -s --no-clipboard',
      url: 'http://127.0.0.1:43123',
    }));
  });

  it.each(['0', '65536', '4173.5', 'not-a-port'])(
    'rejects invalid PLAYWRIGHT_PORT=%s before starting the browser gate',
    (port) => {
      expect(() => loadConfig(port)).toThrow(
        `PLAYWRIGHT_PORT must be an integer from 1 to 65535; received "${port}"`,
      );
    },
  );
});
