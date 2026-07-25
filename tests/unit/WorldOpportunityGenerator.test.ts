import {
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
  OPPORTUNITY_CAMERA_PADDING,
} from '../../src/config/WorldGeneration';
import {
  WorldOpportunityGenerator,
} from '../../src/systems/WorldOpportunityGenerator';
import {
  ENDPOINT_CONNECTION_COST,
  STANDARD_STARTING_CASH,
} from '../../src/config/ConstructionConfig';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import type { StarterOpportunityDef } from '../../src/config/WorldData';
import { GameConfig } from '../../src/config/GameConfig';

const config = {
  generationConfigVersion: 1 as const,
  seed: 'opportunity-alpha',
  biome: 'temperate' as const,
  constructionDifficultyId: 'standard' as const,
};

const variedTerrain = {
  getHeightAt(x: number, y: number): number {
    return 120
      + x * 0.008
      + Math.sin(x / 420) * 32
      + Math.cos(y / 510) * 24;
  },
};

function expectSurveyFitsRecommendedCamera(
  opportunity: StarterOpportunityDef,
): void {
  const { x, y, zoom } = opportunity.recommendedCamera;
  const halfWidth = GameConfig.RESOLUTION.WIDTH / (2 * zoom);
  const halfHeight = GameConfig.RESOLUTION.HEIGHT / (2 * zoom);
  for (const corridor of opportunity.corridors) {
    for (const waypoint of corridor.waypoints) {
      expect(Math.abs(waypoint.x - x) + OPPORTUNITY_CAMERA_PADDING)
        .toBeLessThanOrEqual(halfWidth);
      expect(Math.abs(waypoint.y - y) + OPPORTUNITY_CAMERA_PADDING)
        .toBeLessThanOrEqual(halfHeight);
    }
  }
  for (const site of opportunity.sites) {
    expect(Math.abs(site.x - x) + site.footprintRadius + OPPORTUNITY_CAMERA_PADDING)
      .toBeLessThanOrEqual(halfWidth);
    expect(Math.abs(site.y - y) + site.footprintRadius + OPPORTUNITY_CAMERA_PADDING)
      .toBeLessThanOrEqual(halfHeight);
  }
}

describe('WorldOpportunityGenerator', () => {
  it('replays identical sites, corridors, witnesses, attempt, and camera for one seed', () => {
    const generator = new WorldOpportunityGenerator(variedTerrain);
    const first = generator.generate(config);
    const replay = generator.generate(config);

    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
  });

  it('varies the generated opportunity for a different seed', () => {
    const generator = new WorldOpportunityGenerator(variedTerrain);
    const first = generator.generate(config);
    const different = generator.generate({ ...config, seed: 'opportunity-beta' });

    expect(first.ok).toBe(true);
    expect(different.ok).toBe(true);
    if (first.ok && different.ok) {
      expect(different.opportunity).not.toEqual(first.opportunity);
    }
  });

  it('produces two usable sites and two spatially distinct supported trade-offs', () => {
    const result = new WorldOpportunityGenerator(variedTerrain).generate(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { sites, corridors } = result.opportunity;
    expect(sites).toHaveLength(2);
    expect(corridors).toHaveLength(2);
    for (const site of sites) {
      expect(Math.abs(site.x) + site.footprintRadius).toBeLessThanOrEqual(8192);
      expect(Math.abs(site.y) + site.footprintRadius).toBeLessThanOrEqual(8192);
    }
    expect(corridors[0].waypoints).not.toEqual(corridors[1].waypoints);
    expect(corridors[0].dominantTradeoff).not.toBe(corridors[1].dominantTradeoff);

    const short = corridors.find((corridor) => corridor.dominantTradeoff === 'short-steep')!;
    const flat = corridors.find((corridor) => corridor.dominantTradeoff === 'long-flat')!;
    const shortLength = short.feasibilityWitness.segments.reduce(
      (sum, segment) => sum + Math.hypot(
        segment.geometry.p3.x - segment.geometry.p0.x,
        segment.geometry.p3.y - segment.geometry.p0.y,
      ),
      0,
    );
    const flatLength = flat.feasibilityWitness.segments.reduce(
      (sum, segment) => sum + Math.hypot(
        segment.geometry.p3.x - segment.geometry.p0.x,
        segment.geometry.p3.y - segment.geometry.p0.y,
      ),
      0,
    );
    expect(shortLength).toBeLessThan(flatLength);
    expect(short.estimatedCost).not.toBe(flat.estimatedCost);
    const analyzer = new ConstructionAnalyzer(variedTerrain);
    const shortMaximumGrade = Math.max(...short.feasibilityWitness.segments.map(
      (segment) => analyzer.analyze(segment.geometry).maximumGradePercent,
    ));
    const flatMaximumGrade = Math.max(...flat.feasibilityWitness.segments.map(
      (segment) => analyzer.analyze(segment.geometry).maximumGradePercent,
    ));
    expect(shortMaximumGrade).toBeGreaterThan(flatMaximumGrade);
  });

  it('keeps estimates quote-equivalent, chain-priced, and affordable', () => {
    const result = new WorldOpportunityGenerator(variedTerrain).generate(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const corridor of result.opportunity.corridors) {
      const handTotal = corridor.feasibilityWitness.segments.reduce(
        (sum, segment) => sum + segment.costs.total + segment.topologyCost,
        0,
      );
      expect(corridor.feasibilityWitness.totalCost).toBe(handTotal);
      expect(corridor.estimatedCost).toBe(handTotal);
    }
    const [direct, detour] = result.opportunity.corridors;
    expect(direct.feasibilityWitness.segments.map(
      (segment) => segment.topologyCost,
    )).toEqual([0]);
    expect(detour.feasibilityWitness.segments.map(
      (segment) => segment.topologyCost,
    )).toEqual([0, ENDPOINT_CONNECTION_COST]);
    expect(Math.min(...result.opportunity.corridors.map(
      (corridor) => corridor.estimatedCost,
    ))).toBeLessThanOrEqual(STANDARD_STARTING_CASH);
  });

  it('chains the two-leg detour exactly with a continuous through tangent', () => {
    const result = new WorldOpportunityGenerator(variedTerrain).generate(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detour = result.opportunity.corridors.find(
      (corridor) => corridor.dominantTradeoff === 'long-flat',
    )!;
    const [first, second] = detour.feasibilityWitness.segments;
    expect(first.geometry.p3).toEqual(second.geometry.p0);

    const incoming = {
      x: first.geometry.p3.x - first.geometry.p2.x,
      y: first.geometry.p3.y - first.geometry.p2.y,
    };
    const outgoing = {
      x: second.geometry.p1.x - second.geometry.p0.x,
      y: second.geometry.p1.y - second.geometry.p0.y,
    };
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
    expect(Math.abs(cross)).toBeLessThan(1e-8);
    expect(dot).toBeGreaterThan(0);
  });

  it('centres the recommendation on the complete opportunity envelope', () => {
    const result = new WorldOpportunityGenerator(variedTerrain).generate(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const points = result.opportunity.corridors.reduce(
      (all, corridor) => all.concat(corridor.waypoints),
      [] as Array<{ x: number; y: number }>,
    );
    const xs = points.map((point) => point.x).concat(
      result.opportunity.sites.reduce(
        (values, site) => values.concat(
          site.x - site.footprintRadius,
          site.x + site.footprintRadius,
        ),
        [] as number[],
      ),
    );
    const ys = points.map((point) => point.y).concat(
      result.opportunity.sites.reduce(
        (values, site) => values.concat(
          site.y - site.footprintRadius,
          site.y + site.footprintRadius,
        ),
        [] as number[],
      ),
    );

    expect(result.opportunity.recommendedCamera.x)
      .toBe((Math.min(...xs) + Math.max(...xs)) / 2);
    expect(result.opportunity.recommendedCamera.y)
      .toBe((Math.min(...ys) + Math.max(...ys)) / 2);
  });

  it('fits every survey waypoint and site footprint inside the 1920x1080 viewport', () => {
    const result = new WorldOpportunityGenerator(variedTerrain).generate(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expectSurveyFitsRecommendedCamera(result.opportunity);
  });

  it('returns an explicit bounded error after exhausting flat terrain', () => {
    const result = new WorldOpportunityGenerator({
      getHeightAt: () => 100,
    }).generate(config);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'opportunity-exhausted',
        seed: config.seed,
        attemptsEvaluated: MAX_OPPORTUNITY_ATTEMPTS,
        maxSiteCandidatesEvaluated: MAX_SITE_CANDIDATES_PER_ATTEMPT,
      },
    });
  });
});
