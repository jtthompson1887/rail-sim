import { WorldOpportunityGenerator } from '../../src/systems/WorldOpportunityGenerator';
import { WorldOpportunityValidator } from '../../src/systems/WorldOpportunityValidator';
import type { StarterOpportunityDef } from '../../src/config/WorldData';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';

const terrain = {
  getHeightAt(x: number, y: number): number {
    return 120 + x * 0.008 + Math.sin(x / 420) * 32 + Math.cos(y / 510) * 24;
  },
};
const config = {
  generationConfigVersion: 1 as const,
  seed: 'validator-seed',
  biome: 'temperate' as const,
  constructionDifficultyId: 'standard' as const,
};

function opportunity(): StarterOpportunityDef {
  const result = new WorldOpportunityGenerator(terrain).generate(config);
  if (!result.ok) throw new Error('fixture generation failed');
  return JSON.parse(JSON.stringify(result.opportunity)) as StarterOpportunityDef;
}

describe('WorldOpportunityValidator', () => {
  it('accepts the generator witness against the same terrain authority', () => {
    expect(new WorldOpportunityValidator(terrain).validate(
      opportunity(),
      config,
    )).toEqual({ valid: true });
  });

  it.each([
    ['estimate mismatch', (value: StarterOpportunityDef) => {
      value.corridors[0].estimatedCost += 1;
    }],
    ['charged first-leg topology', (value: StarterOpportunityDef) => {
      value.corridors[0].feasibilityWitness.segments[0].topologyCost = 2_500 as 0;
    }],
    ['missing chained topology', (value: StarterOpportunityDef) => {
      value.corridors[1].feasibilityWitness.segments[1].topologyCost = 0;
    }],
    ['wrong chained topology', (value: StarterOpportunityDef) => {
      value.corridors[1].feasibilityWitness.segments[1].topologyCost = 2_501 as 0;
    }],
    ['duplicate trade-off', (value: StarterOpportunityDef) => {
      value.corridors[1].dominantTradeoff = value.corridors[0].dominantTradeoff;
    }],
    ['out-of-bounds site', (value: StarterOpportunityDef) => {
      value.sites[0].x = 9000;
    }],
    ['attempt above the fixed cap', (value: StarterOpportunityDef) => {
      value.resolvedAttempt = 13;
    }],
    ['invalid camera', (value: StarterOpportunityDef) => {
      value.recommendedCamera.zoom = Number.NaN;
    }],
    ['duplicate site id', (value: StarterOpportunityDef) => {
      value.sites[1].id = value.sites[0].id;
    }],
    ['discontinuous detour join', (value: StarterOpportunityDef) => {
      const detour = value.corridors.find(
        (corridor) => corridor.dominantTradeoff === 'long-flat',
      )!;
      detour.feasibilityWitness.segments[1].geometry.p1.y += 20;
    }],
  ])('rejects %s', (_label, mutate) => {
    const value = opportunity();
    mutate(value);
    expect(new WorldOpportunityValidator(terrain).validate(value, config).valid)
      .toBe(false);
  });

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s footprint relief samples', (_label, height) => {
    const nonFiniteTerrain = {
      getHeightAt: () => height,
    };
    const validator = new WorldOpportunityValidator(
      nonFiniteTerrain,
      new ConstructionAnalyzer(terrain),
    );

    expect(validator.validate(opportunity(), config).valid).toBe(false);
  });
});
