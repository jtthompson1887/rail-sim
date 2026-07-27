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
  STANDARD_STARTING_CASH,
} from '../../src/config/ConstructionConfig';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import type { StarterOpportunityDef } from '../../src/config/WorldData';
import { GameConfig } from '../../src/config/GameConfig';
import {
  ENGINEERED_GRADE_COMPARISON_EPSILON,
  meanAbsoluteEngineeredGrade,
} from '../../src/systems/ConstructionGradeMetrics';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
} from '../../src/systems/TrackGeometry';
import TrackManager from '../../src/managers/TrackManager';
import {
  resolveTrackEndpoint,
  SnapSystem,
} from '../../src/systems/SnapSystem';
import { ConstructionService } from '../../src/systems/ConstructionService';
import { PlaceTrackCommand } from '../../src/commands/PlaceTrackCommand';
import { WorldManager } from '../../src/managers/WorldManager';
import { STARTER_ROUTE_RESERVE } from '../../src/freight/FreightSetCatalog';

const { makeScene } = require('../../__mocks__/phaser');

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
  it('continues its bounded deterministic search when acceptance rejects an otherwise-valid opportunity', () => {
    const considered: StarterOpportunityDef[] = [];
    const acceptAfterFirst = jest.fn((opportunity: StarterOpportunityDef) => {
      considered.push(opportunity);
      return considered.length === 2;
    });

    const result = new WorldOpportunityGenerator(
      variedTerrain,
      acceptAfterFirst,
    ).generate(config);

    expect(acceptAfterFirst).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.opportunity).toEqual(considered[1]);

    const replayConsidered: StarterOpportunityDef[] = [];
    const replay = new WorldOpportunityGenerator(
      variedTerrain,
      (opportunity) => {
        replayConsidered.push(opportunity);
        return replayConsidered.length === 2;
      },
    ).generate(config);
    expect(replay).toEqual(result);
    expect(replayConsidered).toEqual(considered);
  });

  it('honours the existing attempt bound when acceptance rejects every valid opportunity', () => {
    const reject = jest.fn().mockReturnValue(false);

    const result = new WorldOpportunityGenerator(
      variedTerrain,
      reject,
    ).generate(config);

    expect(reject).toHaveBeenCalled();
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

  it.each([
    {
      seed: 'task15-manual-ash-keydiag',
      expectedCost: null,
      guaranteesStarterReserve: false,
    },
    {
      seed: 'task15-manual-larch',
      expectedCost: 179_259,
      guaranteesStarterReserve: true,
    },
  ])('persists $seed as exact production-sequential construction quotes', ({
    seed,
    expectedCost,
    guaranteesStarterReserve,
  }) => {
    const terrain = new TerrainGenerator(seed);
    const result = new WorldOpportunityGenerator(terrain).generate({
      generationConfigVersion: 1,
      seed,
      biome: 'temperate',
      constructionDifficultyId: 'standard',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detour = result.opportunity.corridors.find(
      ({ id }) => id === 'detour',
    );
    expect(detour).toBeDefined();
    if (!detour) return;
    expect(detour.feasibilityWitness.segments).toHaveLength(2);
    const [persistedFirst, persistedSecond] =
      detour.feasibilityWitness.segments;

    const scene = makeScene();
    const manager = new TrackManager(scene);
    WorldManager.createNew('Sequential detour', seed);
    try {
      const service = new ConstructionService(
        manager,
        new ConstructionAnalyzer(terrain),
      );
      const snap = new SnapSystem(manager);
      const firstStart = snap.snapConstructionPoint(
        detour.waypoints[0].x,
        detour.waypoints[0].y,
      );
      const firstEnd = snap.snapConstructionPoint(
        detour.waypoints[1].x,
        detour.waypoints[1].y,
      );
      expect(['none', 'grid']).toContain(firstStart.type);
      expect(['none', 'grid']).toContain(firstEnd.type);
      const firstPreview = service.createPreview(
        firstStart.type === 'grid'
          ? {
            x: firstStart.x,
            y: firstStart.y,
            snapped: true,
            type: 'grid',
          }
          : {
            x: firstStart.x,
            y: firstStart.y,
            snapped: false,
            type: 'none',
          },
        firstEnd.type === 'grid'
          ? {
            x: firstEnd.x,
            y: firstEnd.y,
            snapped: true,
            type: 'grid',
          }
          : {
            x: firstEnd.x,
            y: firstEnd.y,
            snapped: false,
            type: 'none',
          },
        'keydiag-first',
      );
      expect(firstPreview?.proposal.valid).toBe(true);
      expect(firstPreview?.quote).not.toBeNull();
      expect(new PlaceTrackCommand(
        scene,
        manager,
        service,
        firstPreview!.quote!,
      ).execute()).toBe(true);

      const installedEndpoint = resolveTrackEndpoint(
        manager,
        detour.waypoints[1].x,
        detour.waypoints[1].y,
        0,
      );
      expect(installedEndpoint).toEqual(expect.objectContaining({
        trackUUID: 'keydiag-first',
        endpoint: 'end',
        open: true,
      }));
      const secondEnd = snap.snapConstructionPoint(
        detour.waypoints[2].x,
        detour.waypoints[2].y,
      );
      expect(['none', 'grid']).toContain(secondEnd.type);
      const secondPreview = service.createPreview(
        {
          ...installedEndpoint!,
          snapped: true,
          type: 'endpoint',
        },
        secondEnd.type === 'grid'
          ? {
            x: secondEnd.x,
            y: secondEnd.y,
            snapped: true,
            type: 'grid',
          }
          : {
            x: secondEnd.x,
            y: secondEnd.y,
            snapped: false,
            type: 'none',
          },
        'keydiag-second',
      );

      expect(secondPreview?.proposal.valid).toBe(true);
      expect(secondPreview?.quote).not.toBeNull();
      expect(firstPreview!.proposal).toEqual(expect.objectContaining({
        geometry: persistedFirst.geometry,
        verticalProfile: persistedFirst.verticalProfile,
        structures: persistedFirst.structures,
        costs: persistedFirst.costs,
      }));
      expect(secondPreview!.proposal).toEqual(expect.objectContaining({
        geometry: persistedSecond.geometry,
        verticalProfile: persistedSecond.verticalProfile,
        structures: persistedSecond.structures,
        costs: persistedSecond.costs,
      }));
      expect(firstPreview!.quote!.totalCost).toBe(
        persistedFirst.costs.total + persistedFirst.topologyCost,
      );
      expect(secondPreview!.quote!.totalCost).toBe(
        persistedSecond.costs.total + persistedSecond.topologyCost,
      );
      expect(
        firstPreview!.quote!.totalCost + secondPreview!.quote!.totalCost,
      ).toBe(detour.estimatedCost);
      expect(new PlaceTrackCommand(
        scene,
        manager,
        service,
        secondPreview!.quote!,
      ).execute()).toBe(true);
      const built = WorldManager.world!;
      const authoritativeCost = built.tracks.reduce(
        (sum, track) => sum + track.paidBuildCost,
        0,
      );
      expect(authoritativeCost).toBe(detour.estimatedCost);
      expect(built.company.ledger
        .filter(({ category }) => category === 'construction-capex')
        .reduce((sum, entry) => sum + Math.abs(entry.amount), 0))
        .toBe(authoritativeCost);
      expect(built.company.cash)
        .toBe(STANDARD_STARTING_CASH - authoritativeCost);
      if (expectedCost !== null) {
        expect(authoritativeCost).toBe(expectedCost);
      }
      if (guaranteesStarterReserve) {
        expect([...result.opportunity.corridors].sort((
          left,
          right,
        ) => left.estimatedCost - right.estimatedCost
          || left.id.localeCompare(right.id))[0]).toBe(detour);
        expect(authoritativeCost).toBeLessThanOrEqual(
          STANDARD_STARTING_CASH - STARTER_ROUTE_RESERVE,
        );
        expect(built.company.cash).toBeGreaterThanOrEqual(STARTER_ROUTE_RESERVE);
      }
    } finally {
      WorldManager.reset();
    }
  });

  it('exposes the old raw diagnostic route as too steep after real construction snapping', () => {
    const seed = 'task15-manual-ash-dry';
    const terrain = new TerrainGenerator(seed);
    const snap = new SnapSystem(new TrackManager(makeScene()));
    const rawStart = {
      x: -3480.908468775451,
      y: -6246.389408730858,
    };
    const rawEnd = {
      x: -4950.662778654892,
      y: -7176.117067981511,
    };

    const snappedStart = snap.snapConstructionPoint(rawStart.x, rawStart.y);
    const snappedEnd = snap.snapConstructionPoint(rawEnd.x, rawEnd.y);
    expect(snappedStart).toEqual({
      x: -3500,
      y: -6250,
      snapped: true,
      type: 'grid',
    });
    expect(snappedEnd).toEqual({
      x: -4950,
      y: -7200,
      snapped: true,
      type: 'grid',
    });

    const analyzer = new ConstructionAnalyzer(terrain);
    const uiProposal = analyzer.analyzeDetailed(
      deriveAutomaticCubic({
        start: snappedStart,
        end: snappedEnd,
      }),
    ).proposal;
    expect(uiProposal.valid).toBe(false);
    expect(uiProposal.reasonCode).toBe('grade');
    expect(uiProposal.maximumGradePercent)
      .toBeGreaterThan(ConstructionConfig.MAX_GRADE_PERCENT);
  });

  it('keeps the known seeded witnesses feasible at construction-grid coordinates', () => {
    const seed = 'task15-manual-ash-dry';
    const terrain = new TerrainGenerator(seed);
    const result = new WorldOpportunityGenerator(terrain).generate({
      generationConfigVersion: 1,
      seed,
      biome: 'temperate',
      constructionDifficultyId: 'standard',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const analyzer = new ConstructionAnalyzer(terrain);
    const snap = new SnapSystem(new TrackManager(makeScene()));
    for (const site of result.opportunity.sites) {
      const snapped = snap.snapConstructionPoint(site.x, site.y);
      expect({ x: snapped.x, y: snapped.y })
        .toEqual({ x: site.x, y: site.y });
    }
    for (const corridor of result.opportunity.corridors) {
      for (const waypoint of corridor.waypoints) {
        const snapped = snap.snapConstructionPoint(waypoint.x, waypoint.y);
        expect({ x: snapped.x, y: snapped.y }).toEqual(waypoint);
      }
      for (const segment of corridor.feasibilityWitness.segments) {
        const snappedStart = snap.snapConstructionPoint(
          segment.geometry.p0.x,
          segment.geometry.p0.y,
        );
        const snappedEnd = snap.snapConstructionPoint(
          segment.geometry.p3.x,
          segment.geometry.p3.y,
        );
        expect({ x: snappedStart.x, y: snappedStart.y })
          .toEqual(segment.geometry.p0);
        expect({ x: snappedEnd.x, y: snappedEnd.y })
          .toEqual(segment.geometry.p3);
        expect(analyzer.analyzeDetailed({
          ...segment.geometry,
          p0: { x: snappedStart.x, y: snappedStart.y },
          p3: { x: snappedEnd.x, y: snappedEnd.y },
        }).proposal.valid)
          .toBe(true);
      }
    }

    const cheapest = [...result.opportunity.corridors].sort((
      left,
      right,
    ) => left.estimatedCost - right.estimatedCost
      || left.id.localeCompare(right.id))[0];
    expect(cheapest.feasibilityWitness.segments).toHaveLength(1);
    const cheapestSegment = cheapest.feasibilityWitness.segments[0];
    const uiCanonicalStart = snap.snapConstructionPoint(
      cheapestSegment.geometry.p0.x,
      cheapestSegment.geometry.p0.y,
    );
    const uiCanonicalEnd = snap.snapConstructionPoint(
      cheapestSegment.geometry.p3.x,
      cheapestSegment.geometry.p3.y,
    );
    const uiProposal = analyzer.analyzeDetailed(deriveAutomaticCubic({
      start: uiCanonicalStart,
      end: uiCanonicalEnd,
    })).proposal;

    expect(uiProposal.valid).toBe(true);
    expect(uiProposal.reasonCode).toBe('ok');
    expect(uiProposal.maximumGradePercent)
      .toBeCloseTo(ConstructionConfig.MAX_GRADE_PERCENT, 10);
  });

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

  it('chains the two-leg detour with exact shared endpoint control geometry', () => {
    const result = new WorldOpportunityGenerator(variedTerrain).generate(config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detour = result.opportunity.corridors.find(
      (corridor) => corridor.dominantTradeoff === 'long-flat',
    )!;
    const [first, second] = detour.feasibilityWitness.segments;
    expect(second.geometry).toEqual(deriveAutomaticCubic({
      start: first.geometry.p3,
      end: second.geometry.p3,
      startOutward: deriveTrackEndpointOutward(first.geometry, 'end'),
    }));
    expect(first.geometry.p3).toEqual(second.geometry.p0);
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
