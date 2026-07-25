import type { StarterOpportunityDef } from '../../src/config/WorldData';
import { WorldOpportunityGenerator } from '../../src/systems/WorldOpportunityGenerator';

const terrain = {
  getHeightAt(x: number, y: number): number {
    return 120 + x * 0.008 + Math.sin(x / 420) * 32 + Math.cos(y / 510) * 24;
  },
};

const cached = new Map<string, StarterOpportunityDef>();

export function makeStarterOpportunity(seed = 'test-opportunity'): StarterOpportunityDef {
  let opportunity = cached.get(seed);
  if (!opportunity) {
    const result = new WorldOpportunityGenerator(terrain).generate({
      generationConfigVersion: 1,
      seed,
      biome: 'temperate',
      constructionDifficultyId: 'standard',
    });
    if (result.ok === false) {
      throw new Error(`Starter opportunity fixture failed for ${seed}`);
    }
    opportunity = result.opportunity;
    cached.set(seed, opportunity);
  }
  return JSON.parse(JSON.stringify(opportunity)) as StarterOpportunityDef;
}
