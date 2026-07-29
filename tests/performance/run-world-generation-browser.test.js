/** @jest-environment node */

const {
  aggregateJointAudits,
  normalizedMeasurementPayload,
} = require('./run-world-generation-browser');

function shard(seed, overrides = {}) {
  return {
    range: { startSeed: seed, endSeed: seed },
    seedsEvaluated: 1,
    seedsResolved: 1,
    seedsExhausted: 0,
    exhaustedSeeds: [],
    exhaustedErrors: [],
    maxResolvedAttempt: 4,
    maxEconomyEvaluations: 12,
    maxTotalEconomyCandidatesEvaluated: 300,
    maxTotalPrefabAnalyses: 20,
    maxTotalMineralPairAnalyses: 30,
    maxTotalRegionalPairAnalyses: 2,
    totalPairCapHits: 1,
    maxPairCapHits: 1,
    totalRegionalPairCapHits: 2,
    maxRegionalPairCapHits: 2,
    maxRegionalConstructionCost: 50_000,
    maxRegionalSteelReferenceActiveTicks: 300,
    maxRegionalModuleReferenceActiveTicks: 200,
    minimumRegionalSteelMargin: 100,
    minimumRegionalModuleMargin: 80,
    maxJointWorkUnits: 4_000,
    maxGenerationDurationMs: 900,
    firstSlowestSeed: seed,
    firstWorstSeed: seed,
    durationMs: 1_000,
    ...overrides,
  };
}

describe('aggregateJointAudits', () => {
  it('preserves sums, extrema, exhaustion, and strict first-seed ties', () => {
    const result = aggregateJointAudits([
      shard('playtest-601'),
      shard('playtest-602', {
        seedsResolved: 0,
        seedsExhausted: 1,
        exhaustedSeeds: ['playtest-602'],
        exhaustedErrors: ['forced'],
        maxResolvedAttempt: 8,
        maxEconomyEvaluations: 20,
        maxTotalEconomyCandidatesEvaluated: 500,
        maxTotalPrefabAnalyses: 40,
        maxTotalMineralPairAnalyses: 60,
        maxTotalRegionalPairAnalyses: 4,
        totalPairCapHits: 3,
        maxPairCapHits: 3,
        totalRegionalPairCapHits: 5,
        maxRegionalPairCapHits: 5,
        maxRegionalConstructionCost: 55_000,
        maxRegionalSteelReferenceActiveTicks: 350,
        maxRegionalModuleReferenceActiveTicks: 250,
        minimumRegionalSteelMargin: 90,
        minimumRegionalModuleMargin: 70,
        maxJointWorkUnits: 4_000,
        maxGenerationDurationMs: 900,
      }),
      shard('playtest-603', {
        maxJointWorkUnits: 5_000,
        maxGenerationDurationMs: 1_200,
        minimumRegionalSteelMargin: 95,
        minimumRegionalModuleMargin: 75,
      }),
    ], 12_345);

    expect(result).toEqual(expect.objectContaining({
      range: {
        startSeed: 'playtest-601',
        endSeed: 'playtest-603',
      },
      seedsEvaluated: 3,
      seedsResolved: 2,
      seedsExhausted: 1,
      exhaustedSeeds: ['playtest-602'],
      exhaustedErrors: ['forced'],
      maxResolvedAttempt: 8,
      maxEconomyEvaluations: 20,
      maxTotalEconomyCandidatesEvaluated: 500,
      maxTotalPrefabAnalyses: 40,
      maxTotalMineralPairAnalyses: 60,
      maxTotalRegionalPairAnalyses: 4,
      totalPairCapHits: 5,
      maxPairCapHits: 3,
      totalRegionalPairCapHits: 9,
      maxRegionalPairCapHits: 5,
      maxRegionalConstructionCost: 55_000,
      maxRegionalSteelReferenceActiveTicks: 350,
      maxRegionalModuleReferenceActiveTicks: 250,
      minimumRegionalSteelMargin: 90,
      minimumRegionalModuleMargin: 70,
      maxJointWorkUnits: 5_000,
      firstWorstSeed: 'playtest-603',
      maxGenerationDurationMs: 1_200,
      firstSlowestSeed: 'playtest-603',
      durationMs: 12_345,
    }));
  });

  it('keeps the first shard for equal slowest and worst values', () => {
    const result = aggregateJointAudits([
      shard('playtest-601'),
      shard('playtest-602'),
    ], 2_000);

    expect(result.firstSlowestSeed).toBe('playtest-601');
    expect(result.firstWorstSeed).toBe('playtest-601');
  });
});

describe('normalizedMeasurementPayload', () => {
  it('removes timing and orchestration fields from deterministic comparison', () => {
    const payload = {
      seed: 'playtest-601',
      witnessDurationMs: 100,
      replayWitnessDurationMs: 200,
      durationMs: 150,
      jointAudit: { seedsEvaluated: 284 },
      deterministicReplay: false,
      economyEvaluations: 3,
    };

    expect(normalizedMeasurementPayload(payload)).toEqual({
      seed: 'playtest-601',
      economyEvaluations: 3,
    });
  });
});
