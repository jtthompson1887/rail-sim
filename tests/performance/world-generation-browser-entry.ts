import { MAX_ANALYSIS_SAMPLES } from '../../src/config/ConstructionConfig';
import {
  MAX_ECONOMY_SITE_CANDIDATES,
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
} from '../../src/config/WorldGeneration';
import {
  type EconomyGenerationResult,
  WorldEconomyGenerator,
  validateGeneratedEconomy,
} from '../../src/economy/WorldEconomyGenerator';
import {
  analyzePrefabricationExtension,
} from '../../src/economy/PrefabricationOpportunity';
import { WorldManager } from '../../src/managers/WorldManager';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';

const AUDIT_RANGE_START = 601;
const AUDIT_RANGE_END = 884;

function generate(seed: string) {
  const terrain = new TerrainGenerator(seed);
  const originalGenerate = WorldEconomyGenerator.prototype.generate;
  let economyEvaluations = 0;
  let totalEconomyCandidatesEvaluated = 0;
  let acceptedEconomy: Extract<
    EconomyGenerationResult,
    { ok: true }
  > | null = null;

  let creationResult: ReturnType<typeof WorldManager.tryCreateNew>;
  try {
    WorldEconomyGenerator.prototype.generate = function measuredGenerate(
      generationConfig,
      opportunity,
    ) {
      economyEvaluations += 1;
      const result = originalGenerate.call(
        this,
        generationConfig,
        opportunity,
      );
      totalEconomyCandidatesEvaluated += result.ok
        ? result.diagnostics.candidatesEvaluated
        : result.error.candidatesEvaluated;
      if (result.ok) acceptedEconomy = result;
      return result;
    };
    localStorage.clear();
    WorldManager.reset();
    creationResult = WorldManager.tryCreateNew(seed, seed);
  } finally {
    WorldEconomyGenerator.prototype.generate = originalGenerate;
  }
  if (creationResult.ok === false || acceptedEconomy === null) {
    throw new Error(`audited joint generation failed for ${seed}`);
  }
  const economyResult = acceptedEconomy as Extract<
    EconomyGenerationResult,
    { ok: true }
  >;
  if (!validateGeneratedEconomy(
    creationResult.world.economy,
    creationResult.world.starterOpportunity,
    terrain,
  )) {
    throw new Error(`audited economy validation failed for ${seed}`);
  }

  const sawmill = creationResult.world.economy.facilities.find(
    ({ id }) => id === 'sawmill',
  )!;
  const prefab = creationResult.world.economy.facilities.find(
    ({ id }) => id === 'prefabrication-plant',
  )!;
  const prefabWitnessCost = analyzePrefabricationExtension(
    new ConstructionAnalyzer(terrain),
    sawmill.railAccess,
    prefab.railAccess,
  )?.totalCost ?? null;
  const blankInfrastructure = creationResult.world.tracks.length === 0
    && creationResult.world.junctions.length === 0
    && creationResult.world.stations.length === 0
    && creationResult.world.trains.length === 0
    && !('services' in creationResult.world);
  const opportunityResult = {
    ok: true as const,
    opportunity: creationResult.world.starterOpportunity,
    diagnostics: {
      attemptsEvaluated:
        creationResult.world.starterOpportunity.resolvedAttempt,
      maxSiteCandidatesEvaluated: MAX_SITE_CANDIDATES_PER_ATTEMPT,
    },
  };

  return {
    opportunityResult,
    economyResult,
    prefabWitnessCost,
    economyEvaluations,
    totalEconomyCandidatesEvaluated,
    blankInfrastructure,
  };
}

function auditJointSeeds() {
  const startedAt = performance.now();
  let maxResolvedAttempt = 0;
  let maxEconomyEvaluations = 0;
  let maxTotalEconomyCandidatesEvaluated = 0;
  let maxJointWorkUnits = 0;
  let maxGenerationDurationMs = 0;
  let firstSlowestSeed = '';
  let firstWorstSeed = '';
  let seedsEvaluated = 0;
  let seedsResolved = 0;
  let seedsExhausted = 0;

  for (let index = AUDIT_RANGE_START; index <= AUDIT_RANGE_END; index++) {
    const seed = `playtest-${index}`;
    let result: ReturnType<typeof generate>;
    const generationStartedAt = performance.now();
    try {
      result = generate(seed);
    } catch {
      seedsEvaluated += 1;
      seedsExhausted += 1;
      continue;
    }
    const generationDurationMs = performance.now() - generationStartedAt;
    seedsEvaluated += 1;
    seedsResolved += 1;
    const resolvedAttempt = result.opportunityResult.opportunity.resolvedAttempt;
    maxResolvedAttempt = Math.max(maxResolvedAttempt, resolvedAttempt);
    maxEconomyEvaluations = Math.max(
      maxEconomyEvaluations,
      result.economyEvaluations,
    );
    maxTotalEconomyCandidatesEvaluated = Math.max(
      maxTotalEconomyCandidatesEvaluated,
      result.totalEconomyCandidatesEvaluated,
    );
    const jointWorkUnits = resolvedAttempt * MAX_SITE_CANDIDATES_PER_ATTEMPT
      + result.totalEconomyCandidatesEvaluated;
    if (jointWorkUnits > maxJointWorkUnits) {
      maxJointWorkUnits = jointWorkUnits;
      firstWorstSeed = seed;
    }
    if (generationDurationMs > maxGenerationDurationMs) {
      maxGenerationDurationMs = generationDurationMs;
      firstSlowestSeed = seed;
    }
  }

  return {
    range: {
      startSeed: `playtest-${AUDIT_RANGE_START}`,
      endSeed: `playtest-${AUDIT_RANGE_END}`,
    },
    seedsEvaluated,
    seedsResolved,
    seedsExhausted,
    maxResolvedAttempt,
    maxEconomyEvaluations,
    maxTotalEconomyCandidatesEvaluated,
    maxJointWorkUnits,
    maxGenerationDurationMs,
    firstSlowestSeed,
    firstWorstSeed,
    durationMs: performance.now() - startedAt,
  };
}

declare global {
  interface Window {
    __runWorldGenerationBenchmark?: () => {
      seed: string;
      durationMs: number;
      jointAudit: ReturnType<typeof auditJointSeeds>;
      attemptsCap: number;
      candidatesCap: number;
      economyCandidatesCap: number;
      analysisSamplesCap: number;
      opportunityResult: ReturnType<typeof generate>['opportunityResult'];
      economyResult: ReturnType<typeof generate>['economyResult'];
      prefabWitnessCost: number | null;
      economyEvaluations: number;
      totalEconomyCandidatesEvaluated: number;
      blankInfrastructure: boolean;
      deterministicReplay: boolean;
    };
  }
}

window.__runWorldGenerationBenchmark = () => {
  const jointAudit = auditJointSeeds();
  const seed = jointAudit.firstWorstSeed;
  const startedAt = performance.now();
  const result = generate(seed);
  const durationMs = performance.now() - startedAt;
  const replay = generate(seed);
  return {
    seed,
    durationMs,
    jointAudit,
    attemptsCap: MAX_OPPORTUNITY_ATTEMPTS,
    candidatesCap: MAX_SITE_CANDIDATES_PER_ATTEMPT,
    economyCandidatesCap: MAX_ECONOMY_SITE_CANDIDATES,
    analysisSamplesCap: MAX_ANALYSIS_SAMPLES,
    opportunityResult: result.opportunityResult,
    economyResult: result.economyResult,
    prefabWitnessCost: result.prefabWitnessCost,
    economyEvaluations: result.economyEvaluations,
    totalEconomyCandidatesEvaluated:
      result.totalEconomyCandidatesEvaluated,
    blankInfrastructure: result.blankInfrastructure,
    deterministicReplay: JSON.stringify(replay) === JSON.stringify(result),
  };
};
