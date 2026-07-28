import { MAX_ANALYSIS_SAMPLES } from '../../src/config/ConstructionConfig';
import {
  MAX_ECONOMY_SITE_CANDIDATES,
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
} from '../../src/config/WorldGeneration';
import {
  MAX_CEMENT_SUPPLY_PAIR_ANALYSES,
  type EconomyGenerationResult,
  WorldEconomyGenerator,
  validateGeneratedEconomy,
} from '../../src/economy/WorldEconomyGenerator';
import {
  analyzeCementSupplyOpportunity,
} from '../../src/economy/CementSupplyOpportunity';
import {
  MAX_CEMENT_SUPPLY_LINK_COST,
  MAX_STARTER_CORRIDOR_COST,
} from '../../src/config/FreightProgression';
import {
  analyzePrefabricationExtension,
  resolvePrefabricationExtensionStart,
} from '../../src/economy/PrefabricationOpportunity';
import { WorldManager } from '../../src/managers/WorldManager';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';

export interface WorldGenerationAuditRange {
  readonly start: number;
  readonly end: number;
}

export const DEFAULT_WORLD_GENERATION_AUDIT_RANGE:
Readonly<WorldGenerationAuditRange> = Object.freeze({
  start: 601,
  end: 884,
});

function generate(seed: string) {
  const terrain = new TerrainGenerator(seed);
  const originalGenerate = WorldEconomyGenerator.prototype.generate;
  let economyEvaluations = 0;
  let totalEconomyCandidatesEvaluated = 0;
  let totalPrefabAnalyses = 0;
  let totalMineralPairAnalyses = 0;
  let pairCapHits = 0;
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
      totalPrefabAnalyses += result.ok
        ? result.diagnostics.prefabAnalyses
        : result.error.prefabAnalyses;
      totalMineralPairAnalyses += result.ok
        ? result.diagnostics.mineralPairAnalyses
        : result.error.mineralPairAnalyses;
      if ((result.ok
        ? result.diagnostics.mineralPairAnalyses
        : result.error.mineralPairAnalyses)
        === MAX_CEMENT_SUPPLY_PAIR_ANALYSES) {
        pairCapHits += 1;
      }
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

  const prefab = creationResult.world.economy.facilities.find(
    ({ id }) => id === 'prefabrication-plant',
  )!;
  const extensionStart = resolvePrefabricationExtensionStart(
    creationResult.world.starterOpportunity,
  );
  const prefabWitnessCost = analyzePrefabricationExtension(
    new ConstructionAnalyzer(terrain),
    extensionStart!,
    prefab.railAccess,
  )?.totalCost ?? null;
  const facility = (id: string) => creationResult.world.economy.facilities.find(
    (candidate) => candidate.id === id,
  )!;
  const prefabWitness = analyzePrefabricationExtension(
    new ConstructionAnalyzer(terrain),
    extensionStart!,
    facility('prefabrication-plant').railAccess,
  );
  const cementSupplyWitnessCost = prefabWitness
    ? analyzeCementSupplyOpportunity(
      new ConstructionAnalyzer(terrain),
      creationResult.world.starterOpportunity,
      prefabWitness,
      {
        quarry: facility('quarry').railAccess,
        cementWorks: facility('cement-works').railAccess,
        prefabricationPlant: facility('prefabrication-plant').railAccess,
      },
    )?.totalCost ?? null
    : null;
  const starterCorridorCost = Math.min(
    ...creationResult.world.starterOpportunity.corridors.map(
      ({ estimatedCost }) => estimatedCost,
    ),
  );
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
    cementSupplyWitnessCost,
    starterCorridorCost,
    economyEvaluations,
    totalEconomyCandidatesEvaluated,
    totalPrefabAnalyses,
    totalMineralPairAnalyses,
    pairCapHits,
    blankInfrastructure,
  };
}

function auditJointSeeds(
  range: Readonly<WorldGenerationAuditRange>
    = DEFAULT_WORLD_GENERATION_AUDIT_RANGE,
) {
  const startedAt = performance.now();
  let maxResolvedAttempt = 0;
  let maxEconomyEvaluations = 0;
  let maxTotalEconomyCandidatesEvaluated = 0;
  let maxTotalPrefabAnalyses = 0;
  let maxTotalMineralPairAnalyses = 0;
  let totalPairCapHits = 0;
  let maxPairCapHits = 0;
  let maxJointWorkUnits = 0;
  let maxGenerationDurationMs = 0;
  let firstSlowestSeed = '';
  let firstWorstSeed = '';
  let seedsEvaluated = 0;
  let seedsResolved = 0;
  let seedsExhausted = 0;
  const exhaustedSeeds: string[] = [];

  for (let index = range.start; index <= range.end; index++) {
    const seed = `playtest-${index}`;
    let result: ReturnType<typeof generate>;
    const generationStartedAt = performance.now();
    try {
      result = generate(seed);
    } catch {
      seedsEvaluated += 1;
      seedsExhausted += 1;
      exhaustedSeeds.push(seed);
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
    maxTotalPrefabAnalyses = Math.max(
      maxTotalPrefabAnalyses,
      result.totalPrefabAnalyses,
    );
    maxTotalMineralPairAnalyses = Math.max(
      maxTotalMineralPairAnalyses,
      result.totalMineralPairAnalyses,
    );
    totalPairCapHits += result.pairCapHits;
    maxPairCapHits = Math.max(maxPairCapHits, result.pairCapHits);
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
      startSeed: `playtest-${range.start}`,
      endSeed: `playtest-${range.end}`,
    },
    seedsEvaluated,
    seedsResolved,
    seedsExhausted,
    exhaustedSeeds,
    maxResolvedAttempt,
    maxEconomyEvaluations,
    maxTotalEconomyCandidatesEvaluated,
    maxTotalPrefabAnalyses,
    maxTotalMineralPairAnalyses,
    totalPairCapHits,
    maxPairCapHits,
    maxJointWorkUnits,
    maxGenerationDurationMs,
    firstSlowestSeed,
    firstWorstSeed,
    durationMs: performance.now() - startedAt,
  };
}

declare global {
  interface Window {
    __runWorldGenerationBenchmark?: (
      auditRange?: Readonly<WorldGenerationAuditRange>,
    ) => {
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
      cementSupplyWitnessCost: number | null;
      starterCorridorCost: number;
      economyEvaluations: number;
      totalEconomyCandidatesEvaluated: number;
      totalPrefabAnalyses: number;
      totalMineralPairAnalyses: number;
      mineralPairAnalysesCap: number;
      starterCorridorCostCap: number;
      cementSupplyLinkCostCap: number;
      blankInfrastructure: boolean;
      deterministicReplay: boolean;
    };
  }
}

window.__runWorldGenerationBenchmark = (
  auditRange = DEFAULT_WORLD_GENERATION_AUDIT_RANGE,
) => {
  const jointAudit = auditJointSeeds(auditRange);
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
    cementSupplyWitnessCost: result.cementSupplyWitnessCost,
    starterCorridorCost: result.starterCorridorCost,
    economyEvaluations: result.economyEvaluations,
    totalEconomyCandidatesEvaluated:
      result.totalEconomyCandidatesEvaluated,
    totalPrefabAnalyses: result.totalPrefabAnalyses,
    totalMineralPairAnalyses: result.totalMineralPairAnalyses,
    mineralPairAnalysesCap: MAX_CEMENT_SUPPLY_PAIR_ANALYSES,
    starterCorridorCostCap: MAX_STARTER_CORRIDOR_COST,
    cementSupplyLinkCostCap: MAX_CEMENT_SUPPLY_LINK_COST,
    blankInfrastructure: result.blankInfrastructure,
    deterministicReplay: JSON.stringify(replay) === JSON.stringify(result),
  };
};
