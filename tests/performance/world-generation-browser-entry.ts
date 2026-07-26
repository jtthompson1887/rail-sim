import { MAX_ANALYSIS_SAMPLES } from '../../src/config/ConstructionConfig';
import {
  MAX_ECONOMY_SITE_CANDIDATES,
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
} from '../../src/config/WorldGeneration';
import { WorldEconomyGenerator } from '../../src/economy/WorldEconomyGenerator';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { WorldOpportunityGenerator } from '../../src/systems/WorldOpportunityGenerator';

const AUDIT_RANGE_START = 601;
const AUDIT_RANGE_END = 884;

function generationConfig(seed: string) {
  return {
    generationConfigVersion: 1 as const,
    seed,
    biome: 'temperate' as const,
    constructionDifficultyId: 'standard' as const,
  };
}

function generate(seed: string) {
  const config = generationConfig(seed);
  const terrain = new TerrainGenerator(seed);
  const opportunityResult = new WorldOpportunityGenerator(terrain).generate(
    config,
  );
  if (!opportunityResult.ok) {
    throw new Error(`audited opportunity generation failed for ${seed}`);
  }
  const economyResult = new WorldEconomyGenerator(terrain).generate(
    config,
    opportunityResult.opportunity,
  );
  return { opportunityResult, economyResult };
}

function auditOpportunitySeeds() {
  const startedAt = performance.now();
  let maxResolvedAttempt = 0;
  let firstWorstSeed = '';
  let seedsEvaluated = 0;
  let seedsResolved = 0;
  let seedsExhausted = 0;
  for (let index = AUDIT_RANGE_START; index <= AUDIT_RANGE_END; index++) {
    const seed = `playtest-${index}`;
    const terrain = new TerrainGenerator(seed);
    const result = new WorldOpportunityGenerator(terrain).generate(
      generationConfig(seed),
    );
    seedsEvaluated++;
    if (!result.ok) {
      seedsExhausted++;
      continue;
    }
    seedsResolved++;
    if (result.opportunity.resolvedAttempt > maxResolvedAttempt) {
      maxResolvedAttempt = result.opportunity.resolvedAttempt;
      firstWorstSeed = seed;
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
    firstWorstSeed,
    durationMs: performance.now() - startedAt,
  };
}

declare global {
  interface Window {
    __runWorldGenerationBenchmark?: () => {
      seed: string;
      durationMs: number;
      opportunityAudit: ReturnType<typeof auditOpportunitySeeds>;
      attemptsCap: number;
      candidatesCap: number;
      economyCandidatesCap: number;
      analysisSamplesCap: number;
      opportunityResult: ReturnType<typeof generate>['opportunityResult'];
      economyResult: ReturnType<typeof generate>['economyResult'];
      deterministicReplay: boolean;
    };
  }
}

window.__runWorldGenerationBenchmark = () => {
  const opportunityAudit = auditOpportunitySeeds();
  const seed = opportunityAudit.firstWorstSeed;
  const startedAt = performance.now();
  const result = generate(seed);
  const durationMs = performance.now() - startedAt;
  const replay = generate(seed);
  return {
    seed,
    durationMs,
    opportunityAudit,
    attemptsCap: MAX_OPPORTUNITY_ATTEMPTS,
    candidatesCap: MAX_SITE_CANDIDATES_PER_ATTEMPT,
    economyCandidatesCap: MAX_ECONOMY_SITE_CANDIDATES,
    analysisSamplesCap: MAX_ANALYSIS_SAMPLES,
    opportunityResult: result.opportunityResult,
    economyResult: result.economyResult,
    deterministicReplay: JSON.stringify(replay) === JSON.stringify(result),
  };
};
