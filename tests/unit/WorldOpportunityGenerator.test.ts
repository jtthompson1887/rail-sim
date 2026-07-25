import {
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
} from '../../src/config/WorldGeneration';
import {
  WorldOpportunityGenerator,
} from '../../src/systems/WorldOpportunityGenerator';
import { STANDARD_STARTING_CASH } from '../../src/config/ConstructionConfig';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';

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

  it('keeps estimates quote-equivalent, topology-free, and affordable', () => {
    const result = new WorldOpportunityGenerator(variedTerrain).generate(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const corridor of result.opportunity.corridors) {
      const handTotal = corridor.feasibilityWitness.segments.reduce(
        (sum, segment) => sum + segment.costs.total + segment.topologyCost,
        0,
      );
      expect(corridor.feasibilityWitness.segments.every(
        (segment) => segment.topologyCost === 0,
      )).toBe(true);
      expect(corridor.feasibilityWitness.totalCost).toBe(handTotal);
      expect(corridor.estimatedCost).toBe(handTotal);
    }
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

  it('centres the recommendation on the complete survey envelope', () => {
    const result = new WorldOpportunityGenerator(variedTerrain).generate(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const points = result.opportunity.corridors.reduce(
      (all, corridor) => all.concat(corridor.waypoints),
      [] as Array<{ x: number; y: number }>,
    );
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);

    expect(result.opportunity.recommendedCamera.x)
      .toBe((Math.min(...xs) + Math.max(...xs)) / 2);
    expect(result.opportunity.recommendedCamera.y)
      .toBe((Math.min(...ys) + Math.max(...ys)) / 2);
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
