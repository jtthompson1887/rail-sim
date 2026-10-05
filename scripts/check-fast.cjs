const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workspace = path.resolve(__dirname, '..');
const startedAt = Date.now();
const budgetMs = 180_000;
const criticalTests = [
  'tests/unit/Cab3dIsolation.test.ts',
  'tests/unit/Cab3dPurity.test.ts',
  'tests/physics/CrashTransition.test.ts',
  'tests/physics/RailCollisionDetector.test.ts',
  'tests/unit/FinanceLedger.test.ts',
  'tests/unit/CargoSystem.test.ts',
  'tests/unit/RunningCostSystem.test.ts',
  'tests/unit/SaveRepository.test.ts',
  'tests/unit/SimulationSession.test.ts',
];

const extraTests = process.argv.slice(2).filter((argument) => argument !== '--');
for (const file of extraTests) {
  const relative = path.relative(workspace, path.resolve(workspace, file)).replaceAll('\\', '/');
  if (!/^tests\/(unit|integration|physics)\/.+\.test\.ts$/.test(relative)
    || !fs.existsSync(path.resolve(workspace, file))) {
    console.error(`Fast checks accept existing unit, integration or physics test file paths: ${file}`);
    process.exit(1);
  }
}

function run(label, entrypoint, args) {
  const remainingMs = budgetMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    console.error('Fast check exceeded its 180-second budget. Split additional tests into a focused run.');
    process.exit(1);
  }
  const stageStartedAt = Date.now();
  console.log(`\n${label}`);
  const result = spawnSync(process.execPath, [require.resolve(entrypoint), ...args], {
    cwd: workspace,
    stdio: 'inherit',
    timeout: remainingMs,
  });
  console.log(`${label}: ${((Date.now() - stageStartedAt) / 1000).toFixed(1)}s`);
  if (result.error) {
    console.error(result.error.code === 'ETIMEDOUT'
      ? 'Fast check exceeded its 180-second budget; verification is incomplete.'
      : result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('TypeScript', 'typescript/bin/tsc', ['--noEmit']);
run('Critical and relevant tests', 'jest/bin/jest', [
  '--config', 'jest.config.js',
  '--runInBand',
  '--coverage=false',
  '--runTestsByPath',
  ...new Set([...criticalTests, ...extraTests]),
]);
console.log(`\nFast check passed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (budget: 180s).`);
