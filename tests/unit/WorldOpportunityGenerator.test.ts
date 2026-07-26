import {
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
  OPPORTUNITY_CAMERA_PADDING,
} from '../../src/config/WorldGeneration';
import {
  WorldOpportunityGenerator,
} from '../../src/systems/WorldOpportunityGenerator';
import {
  ConstructionConfig,
  ENDPOINT_CONNECTION_COST,
} from '../../src/config/ConstructionConfig';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import type { StarterOpportunityDef } from '../../src/config/WorldData';
import { GameConfig } from '../../src/config/GameConfig';
import {
  ENGINEERED_GRADE_COMPARISON_EPSILON,
  meanAbsoluteEngineeredGrade,
} from '../../src/systems/ConstructionGradeMetrics';

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

function generatorWithCheapestCorridorCost(
  cheapestCorridorCost: number,
): WorldOpportunityGenerator {
  const generator = new WorldOpportunityGenerator(variedTerrain);
  let analysisIndex = 0;
  (generator as any).analyzer = {
    analyzeDetailed: jest.fn((geometry: any) => {
      const direct = analysisIndex++ % 3 === 0;
      const length = direct ? 2_000 : 1_200;
      const detourEngineeringTotal = cheapestCorridorCost + 10_000
        - ENDPOINT_CONNECTION_COST;
      const total = direct
        ? cheapestCorridorCost
        : analysisIndex % 3 === 2
          ? Math.floor(detourEngineeringTotal / 2)
          : Math.ceil(detourEngineeringTotal / 2);
      return {
        proposal: {
          geometry,
          verticalProfile: {
            profileVersion: 1,
            knots: direct
              ? [{ t: 0, elevation: 0 }, { t: 1, elevation: 100 }]
              : [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
          },
          length,
          minimumRadius: Infinity,
          maximumGradePercent: direct ? 5 : 0,
          maximumGradeT: 1,
          maximumGradeDistance: length,
          structures: [{
            type: 'surface',
            startT: 0,
            endT: 1,
            startElevation: 0,
            endElevation: direct ? 100 : 0,
          }],
          structureLengths: {
            surface: length,
            cut: 0,
            fill: 0,
            bridge: 0,
            tunnel: 0,
          },
          costs: {
            track: total,
            earthworks: 0,
            bridge: 0,
            tunnel: 0,
            total,
          },
          valid: true,
          reasonCode: 'ok',
          remedy: '',
        },
        curveSamples: [
          {
            t: 0,
            point: geometry.p0,
            distance: 0,
            segmentLength: 0,
          },
          {
            t: 1,
            point: geometry.p3,
            distance: length,
            segmentLength: length,
          },
        ],
      };
    }),
  };
  (generator as any).validator = {
    validate: jest.fn().mockReturnValue({ valid: true }),
  };
  return generator;
}

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
    expect(sites).toEqual([
      expect.objectContaining({
        id: 'managed-forest',
        label: 'Managed Forest',
      }),
      expect.objectContaining({
        id: 'sawmill',
        label: 'Sawmill',
      }),
    ]);
    expect(corridors).toHaveLength(2);
    for (const site of sites) {
      expect(Math.abs(site.x) + site.footprintRadius).toBeLessThanOrEqual(8192);
      expect(Math.abs(site.y) + site.footprintRadius).toBeLessThanOrEqual(8192);
    }
    expect(corridors[0].waypoints).not.toEqual(corridors[1].waypoints);
    expect(corridors[0].dominantTradeoff).not.toBe(corridors[1].dominantTradeoff);
    corridors.forEach((corridor) => {
      expect(corridor.waypoints[0]).toEqual({
        x: sites[0].x,
        y: sites[0].y,
      });
      expect(corridor.waypoints[corridor.waypoints.length - 1]).toEqual({
        x: sites[1].x,
        y: sites[1].y,
      });
    });

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
    const shortDetails = short.feasibilityWitness.segments.map(
      (segment) => analyzer.analyzeDetailed(segment.geometry),
    );
    const flatDetails = flat.feasibilityWitness.segments.map(
      (segment) => analyzer.analyzeDetailed(segment.geometry),
    );
    const shortMeanGrade = meanAbsoluteEngineeredGrade(shortDetails);
    const flatMeanGrade = meanAbsoluteEngineeredGrade(flatDetails);
    expect(shortMeanGrade - flatMeanGrade)
      .toBeGreaterThan(ENGINEERED_GRADE_COMPARISON_EPSILON);
    expect(Math.max(...shortDetails.map(
      ({ proposal }) => proposal.maximumGradePercent,
    ))).toBeCloseTo(ConstructionConfig.MAX_GRADE_PERCENT, 10);
    expect(Math.max(...flatDetails.map(
      ({ proposal }) => proposal.maximumGradePercent,
    ))).toBeCloseTo(ConstructionConfig.MAX_GRADE_PERCENT, 10);
  });

  it('keeps estimates quote-equivalent, chain-priced, and within the starter reserve', () => {
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
    ))).toBeLessThanOrEqual(890_000);
  });

  it('accepts an exact £890,000 cheapest corridor', () => {
    const result = generatorWithCheapestCorridorCost(890_000).generate(config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.min(...result.opportunity.corridors.map(
      (corridor) => corridor.estimatedCost,
    ))).toBe(890_000);
  });

  it('rejects a £890,001 cheapest corridor within the fixed attempt bound', () => {
    const result = generatorWithCheapestCorridorCost(890_001).generate(config);

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
