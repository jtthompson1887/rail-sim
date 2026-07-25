import { MAX_ANALYSIS_SAMPLES } from '../../src/config/ConstructionConfig';
import {
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
} from '../../src/config/WorldGeneration';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { WorldOpportunityGenerator } from '../../src/systems/WorldOpportunityGenerator';

const WORST_CASE_SEED = 'playtest-082';
const GENERATION_CONFIG = {
  generationConfigVersion: 1 as const,
  seed: WORST_CASE_SEED,
  biome: 'temperate' as const,
  constructionDifficultyId: 'standard' as const,
};

function generate() {
  return new WorldOpportunityGenerator(
    new TerrainGenerator(WORST_CASE_SEED),
  ).generate(GENERATION_CONFIG);
}

declare global {
  interface Window {
    __runWorldGenerationBenchmark?: () => {
      seed: string;
      durationMs: number;
      attemptsCap: number;
      candidatesCap: number;
      analysisSamplesCap: number;
      result: ReturnType<typeof generate>;
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
    seed: WORST_CASE_SEED,
    durationMs,
    attemptsCap: MAX_OPPORTUNITY_ATTEMPTS,
    candidatesCap: MAX_SITE_CANDIDATES_PER_ATTEMPT,
    analysisSamplesCap: MAX_ANALYSIS_SAMPLES,
    result,
    deterministicReplay: JSON.stringify(replay) === JSON.stringify(result),
  };
};
