import { MAX_ANALYSIS_SAMPLES } from '../../src/config/ConstructionConfig';
import {
  MAX_ECONOMY_SITE_CANDIDATES,
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
} from '../../src/config/WorldGeneration';
import { WorldEconomyGenerator } from '../../src/economy/WorldEconomyGenerator';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { WorldOpportunityGenerator } from '../../src/systems/WorldOpportunityGenerator';

// First configured worst case in the canonical-grid playtest-601..884 audit.
const AUDITED_WORST_CASE_SEED = 'playtest-644';
const GENERATION_CONFIG = {
  generationConfigVersion: 1 as const,
  seed: AUDITED_WORST_CASE_SEED,
  biome: 'temperate' as const,
  constructionDifficultyId: 'standard' as const,
};

function generate() {
  const terrain = new TerrainGenerator(AUDITED_WORST_CASE_SEED);
  const opportunityResult = new WorldOpportunityGenerator(terrain).generate(
    GENERATION_CONFIG,
  );
  if (!opportunityResult.ok) {
    throw new Error('audited opportunity generation failed');
  }
  const economyResult = new WorldEconomyGenerator(terrain).generate(
    GENERATION_CONFIG,
    opportunityResult.opportunity,
  );
  return { opportunityResult, economyResult };
}

declare global {
  interface Window {
    __runWorldGenerationBenchmark?: () => {
      seed: string;
      durationMs: number;
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
  const startedAt = performance.now();
  const result = generate();
  const durationMs = performance.now() - startedAt;
  const replay = generate();
  return {
    seed: AUDITED_WORST_CASE_SEED,
    durationMs,
    attemptsCap: MAX_OPPORTUNITY_ATTEMPTS,
    candidatesCap: MAX_SITE_CANDIDATES_PER_ATTEMPT,
    economyCandidatesCap: MAX_ECONOMY_SITE_CANDIDATES,
    analysisSamplesCap: MAX_ANALYSIS_SAMPLES,
    opportunityResult: result.opportunityResult,
    economyResult: result.economyResult,
    deterministicReplay: JSON.stringify(replay) === JSON.stringify(result),
  };
};
