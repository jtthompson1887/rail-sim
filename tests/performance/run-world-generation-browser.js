const http = require('http');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const webpack = require('webpack');
const { chromium } = require('playwright');

const workspace = path.resolve(__dirname, '../..');
const outputPath = path.join(workspace, 'test-results', 'world-generation-benchmark');
const bundleName = 'world-generation-browser.js';
const targetMs = 2_000;

function buildHarness() {
  return new Promise((resolve, reject) => {
    webpack({
      mode: 'development',
      target: 'web',
      context: workspace,
      entry: path.join(__dirname, 'world-generation-browser-entry.ts'),
      output: {
        path: outputPath,
        filename: bundleName,
      },
      resolve: { extensions: ['.ts', '.js'] },
      module: {
        rules: [{
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: 'ts-loader',
            options: { transpileOnly: true },
          },
        }],
      },
      externals: { phaser: 'Phaser' },
      devtool: false,
    }, (error, stats) => {
      if (error) return reject(error);
      if (stats.hasErrors()) {
        return reject(new Error(stats.toString({ all: false, errors: true })));
      }
      resolve();
    });
  });
}

function startHarnessServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body></body></html>');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

async function loadHarnessPage(browser, url) {
  const page = await browser.newPage();
  page.on('console', (message) => {
    process.stdout.write(`[browser-console] ${message.text()}\n`);
  });
  await page.goto(url);
  await page.addScriptTag({ path: require.resolve('phaser/dist/phaser.js') });
  await page.addScriptTag({ path: path.join(outputPath, bundleName) });
  return page;
}

function aggregateJointAudits(shards, durationMs) {
  if (shards.length === 0) {
    throw new RangeError('At least one joint-audit shard is required');
  }
  const aggregate = {
    range: {
      startSeed: shards[0].range.startSeed,
      endSeed: shards[shards.length - 1].range.endSeed,
    },
    seedsEvaluated: 0,
    seedsResolved: 0,
    seedsExhausted: 0,
    exhaustedSeeds: [],
    exhaustedErrors: [],
    maxResolvedAttempt: 0,
    maxEconomyEvaluations: 0,
    maxTotalEconomyCandidatesEvaluated: 0,
    maxTotalPrefabAnalyses: 0,
    maxTotalMineralPairAnalyses: 0,
    maxTotalRegionalPairAnalyses: 0,
    totalPairCapHits: 0,
    maxPairCapHits: 0,
    totalRegionalPairCapHits: 0,
    maxRegionalPairCapHits: 0,
    maxRegionalConstructionCost: 0,
    maxRegionalSteelReferenceActiveTicks: 0,
    maxRegionalModuleReferenceActiveTicks: 0,
    minimumRegionalSteelMargin: Number.POSITIVE_INFINITY,
    minimumRegionalModuleMargin: Number.POSITIVE_INFINITY,
    maxJointWorkUnits: 0,
    maxGenerationDurationMs: 0,
    firstSlowestSeed: '',
    firstWorstSeed: '',
    durationMs,
  };
  const sumFields = [
    'seedsEvaluated',
    'seedsResolved',
    'seedsExhausted',
    'totalPairCapHits',
    'totalRegionalPairCapHits',
  ];
  const maxFields = [
    'maxResolvedAttempt',
    'maxEconomyEvaluations',
    'maxTotalEconomyCandidatesEvaluated',
    'maxTotalPrefabAnalyses',
    'maxTotalMineralPairAnalyses',
    'maxTotalRegionalPairAnalyses',
    'maxPairCapHits',
    'maxRegionalPairCapHits',
    'maxRegionalConstructionCost',
    'maxRegionalSteelReferenceActiveTicks',
    'maxRegionalModuleReferenceActiveTicks',
  ];
  for (const shard of shards) {
    for (const field of sumFields) aggregate[field] += shard[field];
    for (const field of maxFields) {
      aggregate[field] = Math.max(aggregate[field], shard[field]);
    }
    aggregate.exhaustedSeeds.push(...shard.exhaustedSeeds);
    aggregate.exhaustedErrors.push(...shard.exhaustedErrors);
    aggregate.minimumRegionalSteelMargin = Math.min(
      aggregate.minimumRegionalSteelMargin,
      shard.minimumRegionalSteelMargin,
    );
    aggregate.minimumRegionalModuleMargin = Math.min(
      aggregate.minimumRegionalModuleMargin,
      shard.minimumRegionalModuleMargin,
    );
    if (shard.maxGenerationDurationMs > aggregate.maxGenerationDurationMs) {
      aggregate.maxGenerationDurationMs = shard.maxGenerationDurationMs;
      aggregate.firstSlowestSeed = shard.firstSlowestSeed;
    }
    if (shard.maxJointWorkUnits > aggregate.maxJointWorkUnits) {
      aggregate.maxJointWorkUnits = shard.maxJointWorkUnits;
      aggregate.firstWorstSeed = shard.firstWorstSeed;
    }
  }
  if (!Number.isFinite(aggregate.minimumRegionalSteelMargin)) {
    aggregate.minimumRegionalSteelMargin = 0;
  }
  if (!Number.isFinite(aggregate.minimumRegionalModuleMargin)) {
    aggregate.minimumRegionalModuleMargin = 0;
  }
  return aggregate;
}

function normalizedMeasurementPayload(payload) {
  const {
    witnessDurationMs: _witnessDurationMs,
    replayWitnessDurationMs: _replayWitnessDurationMs,
    durationMs: _durationMs,
    jointAudit: _jointAudit,
    deterministicReplay: _deterministicReplay,
    ...normalized
  } = payload;
  return normalized;
}

async function main() {
  process.stdout.write('[world-generation-browser] boundary=build-start\n');
  await buildHarness();
  process.stdout.write('[world-generation-browser] boundary=build-complete\n');
  const harnessServer = await startHarnessServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const probeSeeds = process.env.WORLD_GENERATION_PROBE_SEEDS;
    if (probeSeeds) {
      const page = await loadHarnessPage(browser, harnessServer.url);
      try {
        const probe = await page.evaluate(
          (seeds) => window.__probeWorldGenerationSeeds(seeds),
          probeSeeds.split(','),
        );
        process.stdout.write(
          `[world-generation-browser-probe] ${JSON.stringify(probe)}\n`,
        );
        return;
      } finally {
        await page.close();
      }
    }
    const auditStartedAt = performance.now();
    const shards = [];
    for (let index = 601; index <= 884; index++) {
      const page = await loadHarnessPage(browser, harnessServer.url);
      try {
        shards.push(await page.evaluate(
          (seedIndex) => window.__auditWorldGenerationRange({
            start: seedIndex,
            end: seedIndex,
          }),
          index,
        ));
      } finally {
        await page.close();
      }
      const completed = index - 600;
      if (completed % 25 === 0 || index === 884) {
        process.stdout.write(
          `[world-generation-browser] progress=${completed}/284\n`,
        );
      }
    }
    const jointAudit = aggregateJointAudits(
      shards,
      performance.now() - auditStartedAt,
    );
    const slowestIndex = Number(
      jointAudit.firstSlowestSeed.replace('playtest-', ''),
    );
    const measureFresh = async () => {
      const page = await loadHarnessPage(browser, harnessServer.url);
      try {
        return await page.evaluate(
          (seedIndex) => window.__measureWorldGenerationSeed(
            `playtest-${seedIndex}`,
          ),
          slowestIndex,
        );
      } finally {
        await page.close();
      }
    };
    const firstMeasurement = await measureFresh();
    const replayMeasurement = await measureFresh();
    const measurement = {
      ...firstMeasurement,
      durationMs: jointAudit.maxGenerationDurationMs,
      replayWitnessDurationMs: replayMeasurement.witnessDurationMs,
      jointAudit,
      deterministicReplay: JSON.stringify(
        normalizedMeasurementPayload(firstMeasurement),
      ) === JSON.stringify(
        normalizedMeasurementPayload(replayMeasurement),
      ),
    };
    const record = {
      ...measurement,
      targetMs,
      target: 'exact-2s',
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      browser: `Chromium ${await browser.version()}`,
    };
    process.stdout.write(`[world-generation-browser] ${JSON.stringify(record)}\n`);

    const audit = measurement.jointAudit;
    const exactJointAudit = audit !== undefined
      && audit.range.startSeed === 'playtest-601'
      && audit.range.endSeed === 'playtest-884'
      && audit.seedsEvaluated === 284
      && audit.seedsResolved === 284
      && audit.seedsExhausted === 0
      && audit.maxResolvedAttempt <= measurement.attemptsCap
      && audit.maxEconomyEvaluations >= 1
      && audit.maxTotalEconomyCandidatesEvaluated
        <= audit.maxEconomyEvaluations * measurement.economyCandidatesCap
      && audit.maxTotalMineralPairAnalyses
        <= audit.maxEconomyEvaluations * measurement.mineralPairAnalysesCap
      && Number.isInteger(audit.maxTotalRegionalPairAnalyses)
      && audit.maxTotalRegionalPairAnalyses > 0
      && audit.maxTotalRegionalPairAnalyses
        <= audit.maxEconomyEvaluations * measurement.regionalPairAnalysesCap
      && Number.isInteger(audit.totalRegionalPairCapHits)
      && audit.totalRegionalPairCapHits >= 0
      && Number.isInteger(audit.maxRegionalPairCapHits)
      && audit.maxRegionalPairCapHits >= 0
      && audit.maxRegionalConstructionCost <= 60_000
      && audit.maxRegionalSteelReferenceActiveTicks <= 1_599
      && audit.maxRegionalModuleReferenceActiveTicks <= 1_060
      && audit.minimumRegionalSteelMargin > 0
      && audit.minimumRegionalModuleMargin > 0
      && typeof audit.firstSlowestSeed === 'string'
      && audit.firstSlowestSeed.length > 0
      && Number.isFinite(audit.maxGenerationDurationMs)
      && audit.maxGenerationDurationMs < targetMs
      && Number.isFinite(audit.durationMs)
      && audit.durationMs > 0;
    const exactObservedSlowestCase = exactJointAudit
      && measurement.seed === audit.firstSlowestSeed
      && measurement.opportunityResult.ok === true
      && measurement.opportunityResult.diagnostics.attemptsEvaluated
        === measurement.opportunityResult.opportunity.resolvedAttempt
      && measurement.opportunityResult.diagnostics.maxSiteCandidatesEvaluated === 256
      && measurement.economyResult.ok === true
      && measurement.economyResult.economy.facilities.length === 7
      && measurement.economyResult.diagnostics.candidatesEvaluated
        <= measurement.economyCandidatesCap
      && measurement.economyEvaluations >= 1
      && measurement.totalEconomyCandidatesEvaluated
        <= measurement.economyEvaluations * measurement.economyCandidatesCap
      && measurement.prefabWitnessCost <= 194_000
      && measurement.starterCorridorCost
        <= measurement.starterCorridorCostCap
      && measurement.cementSupplyWitnessCost
        <= measurement.cementSupplyLinkCostCap
      && measurement.regionalConstructionWitness !== null
      && measurement.regionalConstructionWitness.totalCost
        <= measurement.regionalConstructionLinkCostCap
      && measurement.regionalConstructionWitness.minimumSteelMargin > 0
      && measurement.regionalConstructionWitness.minimumModuleMargin > 0
      && measurement.totalRegionalPairAnalyses
        <= measurement.economyEvaluations
          * measurement.regionalPairAnalysesCap
      && measurement.blankInfrastructure === true;
    if (!exactObservedSlowestCase
      || measurement.attemptsCap !== 26
      || measurement.candidatesCap !== 256
      || measurement.economyCandidatesCap !== 256
      || measurement.analysisSamplesCap !== 96
      || measurement.regionalPairAnalysesCap !== 32
      || measurement.deterministicReplay !== true
      || !Number.isFinite(measurement.durationMs)
      || measurement.durationMs !== audit.maxGenerationDurationMs
      || measurement.durationMs >= targetMs) {
      process.exitCode = 1;
    }
    if (!Number.isFinite(measurement.witnessDurationMs)
      || measurement.witnessDurationMs <= 0
      || !Number.isFinite(measurement.replayWitnessDurationMs)
      || measurement.replayWitnessDurationMs <= 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => harnessServer.server.close(resolve));
  }
}

module.exports = {
  aggregateJointAudits,
  normalizedMeasurementPayload,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
