/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom',
  roots: ['<rootDir>/tests'],
  testPathIgnorePatterns: ['[\\\\/]tests[\\\\/]e2e[\\\\/]'],
  moduleNameMapper: {
    '^phaser$': '<rootDir>/__mocks__/phaser.js',
  },
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/scenes/**/*.ts',
    '!src/main.ts',
    '!src/systems/CameraController.ts',
    '!src/managers/AudioManager.ts',
    '!src/systems/InputManager.ts',
    '!src/entities/Background.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 85,
    },
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: false, module: 'commonjs', types: ['jest', 'node'] } }],
  },
};
