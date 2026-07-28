import { WorldOpportunityGenerator } from '../../src/systems/WorldOpportunityGenerator';
import { WorldOpportunityValidator } from '../../src/systems/WorldOpportunityValidator';
import type { StarterOpportunityDef } from '../../src/config/WorldData';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { MAX_STARTER_CORRIDOR_COST } from '../../src/config/FreightProgression';
import { MAX_OPPORTUNITY_ATTEMPTS } from '../../src/config/WorldGeneration';

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

function opportunityWithCheapestCorridorCost(
  cheapestCorridorCost: number,
): {
  value: StarterOpportunityDef;
  analyzer: ConstructionAnalyzer;
} {
  const value = opportunity();
  const desiredTotals = [cheapestCorridorCost, cheapestCorridorCost + 10_000];
  value.corridors.forEach((corridor, index) => {
    const desiredTotal = desiredTotals[index];
    const delta = desiredTotal - corridor.estimatedCost;
    const firstCosts = corridor.feasibilityWitness.segments[0].costs;
    firstCosts.track += delta;
    firstCosts.total += delta;
    corridor.estimatedCost = desiredTotal;
    corridor.feasibilityWitness.totalCost = desiredTotal;
  });
  const realAnalyzer = new ConstructionAnalyzer(terrain);
  const details = value.corridors.flatMap((corridor) => (
    corridor.feasibilityWitness.segments.map((segment) => {
      const detail = realAnalyzer.analyzeDetailed(segment.geometry);
      return {
        ...detail,
        proposal: {
          ...detail.proposal,
          costs: { ...segment.costs },
        },
      };
    })
  ));
  const analyzeDetailed = jest.fn();
  for (const detail of details) analyzeDetailed.mockReturnValueOnce(detail);
  return {
    value,
    analyzer: { analyzeDetailed } as unknown as ConstructionAnalyzer,
  };
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
      value.resolvedAttempt = MAX_OPPORTUNITY_ATTEMPTS + 1;
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

  it('accepts a cheapest corridor costing exactly £400,000', () => {
    const fixture = opportunityWithCheapestCorridorCost(
      MAX_STARTER_CORRIDOR_COST,
    );

    expect(new WorldOpportunityValidator(terrain, fixture.analyzer).validate(
      fixture.value,
      config,
    )).toEqual({ valid: true });
  });

  it('rejects a £400,001 cheapest corridor with the reserve reason', () => {
    const fixture = opportunityWithCheapestCorridorCost(
      MAX_STARTER_CORRIDOR_COST + 1,
    );

    expect(new WorldOpportunityValidator(terrain, fixture.analyzer).validate(
      fixture.value,
      config,
    )).toEqual({
      valid: false,
      reason: 'opportunity breaches starter reserve',
    });
  });
});
