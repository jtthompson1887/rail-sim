import { ENDPOINT_CONNECTION_COST } from '../../src/config/ConstructionConfig';
import {
  MAX_MODULE_REFERENCE_ACTIVE_TICKS,
  MAX_REGIONAL_CONSTRUCTION_LINK_COST,
  MAX_REGIONAL_PAIR_ANALYSES,
  MAX_STEEL_REFERENCE_ACTIVE_TICKS,
  REFERENCE_MANOEUVRE_TICKS,
  REFERENCE_SPEED_WORLD_UNITS_PER_TICK,
} from '../../src/config/FreightProgression';
import type {
  OpportunityCorridorDef,
  StarterOpportunityDef,
  Vec2Def,
} from '../../src/config/WorldData';
import type {
  CementSupplyOpportunityWitness,
} from '../../src/economy/CementSupplyOpportunity';
import type {
  PrefabricationExtensionWitness,
} from '../../src/economy/PrefabricationOpportunity';
import {
  createRegionalConstructionOpportunityAnalyzer,
  type RegionalConstructionSites,
} from '../../src/economy/RegionalConstructionOpportunity';
import type {
  ConstructionAnalysisDetail,
  ConstructionProposal,
} from '../../src/systems/ConstructionAnalyzer';
import * as ConstructionCurveSampler
  from '../../src/systems/ConstructionCurveSampler';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
  type TrackGeometryDef,
} from '../../src/systems/TrackGeometry';
import { clonePlainData } from '../../src/utils/PlainData';

const realSampleConstructionCurve =
  ConstructionCurveSampler.sampleConstructionCurve.bind(
    ConstructionCurveSampler,
  );

const FOREST = { x: 0, y: 0 };
const STARTER_MIDPOINT = { x: 1_000, y: 0 };
const SAWMILL = { x: 2_000, y: 0 };
const PREFABRICATION = { x: 3_000, y: 0 };
const CEMENT_WORKS = { x: 4_000, y: 0 };
const QUARRY = { x: 5_000, y: 0 };
const DEFAULT_SITES: RegionalConstructionSites = {
  portInterchange: { x: 5_000, y: 1_000 },
  townConstructionMarket: { x: 0, y: -1_000 },
};

function geometry(
  start: Vec2Def,
  end: Vec2Def,
  startOutward?: Vec2Def,
  endOutward?: Vec2Def,
): TrackGeometryDef {
  return deriveAutomaticCubic({
    start,
    end,
    ...(startOutward ? { startOutward } : {}),
    ...(endOutward ? { endOutward } : {}),
  });
}

function proposalWith(
  trackGeometry: TrackGeometryDef,
  constructionCost = 1_000,
  valid = true,
): ConstructionProposal {
  const sampled = realSampleConstructionCurve(trackGeometry);
  const length = sampled.ok
    ? sampled.length
    : Math.hypot(
      trackGeometry.p3.x - trackGeometry.p0.x,
      trackGeometry.p3.y - trackGeometry.p0.y,
    );
  return {
    geometry: trackGeometry,
    verticalProfile: {
      profileVersion: 1,
      knots: [
        { t: 0, elevation: 0 },
        { t: 1, elevation: 0 },
      ],
    },
    length,
    minimumRadius: Number.POSITIVE_INFINITY,
    maximumGradePercent: 0,
    maximumGradeT: 0,
    maximumGradeDistance: 0,
    structures: [],
    structureLengths: {
      surface: length,
      cut: 0,
      fill: 0,
      bridge: 0,
      tunnel: 0,
    },
    costs: {
      track: constructionCost,
      earthworks: 0,
      bridge: 0,
      tunnel: 0,
      total: constructionCost,
    },
    valid,
    reasonCode: valid ? 'ok' : 'grade',
    remedy: valid ? '' : 'Too steep.',
  };
}

function detailWith(
  trackGeometry: TrackGeometryDef,
  constructionCost = 1_000,
): ConstructionAnalysisDetail {
  const sampled = realSampleConstructionCurve(trackGeometry);
  const fallbackLength = Math.hypot(
    trackGeometry.p3.x - trackGeometry.p0.x,
    trackGeometry.p3.y - trackGeometry.p0.y,
  );
  return {
    proposal: proposalWith(trackGeometry, constructionCost),
    curveSamples: sampled.ok
      ? sampled.samples
      : [{
        t: 0,
        point: trackGeometry.p0,
        distance: 0,
        segmentLength: 0,
      }, {
        t: 1,
        point: trackGeometry.p3,
        distance: fallbackLength,
        segmentLength: fallbackLength,
      }],
  };
}

function corridor(
  id: string,
  estimatedCost: number,
  segmentGeometries: TrackGeometryDef[],
): OpportunityCorridorDef {
  return {
    id,
    waypoints: [
      { ...segmentGeometries[0].p0 },
      ...segmentGeometries.map(({ p3 }) => ({ ...p3 })),
    ],
    estimatedCost,
    dominantTradeoff: id === 'a-selected' ? 'short-steep' : 'long-flat',
    feasibilityWitness: {
      witnessVersion: 1,
      segments: segmentGeometries.map((trackGeometry, index) => {
        const proposal = proposalWith(trackGeometry);
        return {
          geometry: proposal.geometry,
          verticalProfile: proposal.verticalProfile,
          structures: proposal.structures,
          costs: proposal.costs,
          topologyCost: index === 0 ? 0 : ENDPOINT_CONNECTION_COST,
        };
      }),
      totalCost: estimatedCost,
    },
  };
}

interface RegionalFixture {
  starter: StarterOpportunityDef;
  prefab: PrefabricationExtensionWitness;
  cement: CementSupplyOpportunityWitness;
  selectedStarterGeometries: TrackGeometryDef[];
  prefabGeometry: TrackGeometryDef;
  quarryToCementGeometry: TrackGeometryDef;
  cementToPrefabGeometry: TrackGeometryDef;
}

function regionalFixture(): RegionalFixture {
  const starterOne = geometry(FOREST, STARTER_MIDPOINT);
  const starterTwo = geometry(
    STARTER_MIDPOINT,
    SAWMILL,
    deriveTrackEndpointOutward(starterOne, 'end'),
  );
  const alternate = geometry(
    { x: 0, y: 500 },
    { x: 2_000, y: 500 },
  );
  const prefabGeometry = geometry(
    SAWMILL,
    PREFABRICATION,
    deriveTrackEndpointOutward(starterTwo, 'end'),
  );
  const quarryToCementGeometry = geometry(QUARRY, CEMENT_WORKS);
  const cementToPrefabGeometry = geometry(
    CEMENT_WORKS,
    PREFABRICATION,
    deriveTrackEndpointOutward(quarryToCementGeometry, 'end'),
    deriveTrackEndpointOutward(prefabGeometry, 'end'),
  );
  const starter: StarterOpportunityDef = {
    opportunityVersion: 1,
    resolvedAttempt: 1,
    sites: [{
      id: 'managed-forest',
      label: 'Managed Forest',
      ...FOREST,
      footprintRadius: 192,
    }, {
      id: 'sawmill',
      label: 'Sawmill',
      ...SAWMILL,
      footprintRadius: 192,
    }],
    corridors: [
      corridor('z-alternate', 20_000, [alternate]),
      corridor('a-selected', 10_000, [starterOne, starterTwo]),
    ],
    recommendedCamera: { x: 2_500, y: 0, zoom: 0.5 },
  };
  const prefabProposal = proposalWith(prefabGeometry);
  const quarryProposal = proposalWith(quarryToCementGeometry);
  const cementProposal = proposalWith(cementToPrefabGeometry);
  return {
    starter,
    prefab: {
      proposal: prefabProposal,
      topologyCost: ENDPOINT_CONNECTION_COST,
      totalCost: prefabProposal.costs.total + ENDPOINT_CONNECTION_COST,
    },
    cement: {
      quarryToCement: { proposal: quarryProposal },
      cementToPrefabrication: { proposal: cementProposal },
      topologyCost: ENDPOINT_CONNECTION_COST * 2,
      totalCost: quarryProposal.costs.total
        + cementProposal.costs.total
        + ENDPOINT_CONNECTION_COST * 2,
    },
    selectedStarterGeometries: [starterOne, starterTwo],
    prefabGeometry,
    quarryToCementGeometry,
    cementToPrefabGeometry,
  };
}

type DetailTransform = (
  detail: ConstructionAnalysisDetail,
  analysisIndex: number,
) => ConstructionAnalysisDetail;

function analyzerDouble(
  newLegCosts: readonly [number, number] = [27_500, 27_500],
  transform: DetailTransform = (detail) => detail,
): {
  analyzer: {
    analyzeDetailed(geometry: TrackGeometryDef): ConstructionAnalysisDetail;
  };
  details: ConstructionAnalysisDetail[];
  geometries: TrackGeometryDef[];
} {
  const details: ConstructionAnalysisDetail[] = [];
  const geometries: TrackGeometryDef[] = [];
  return {
    analyzer: {
      analyzeDetailed(trackGeometry: TrackGeometryDef) {
        const analysisIndex = geometries.length;
        const constructionCost = analysisIndex < 5
          ? 1_000
          : newLegCosts[analysisIndex - 5] ?? 1_000;
        geometries.push(clonePlainData(trackGeometry));
        const transformed = transform(
          detailWith(trackGeometry, constructionCost),
          analysisIndex,
        );
        details.push(transformed);
        return transformed;
      },
    },
    details,
    geometries,
  };
}

function createAnalyzer(
  fixture: RegionalFixture,
  testAnalyzer = analyzerDouble(),
) {
  return {
    ...testAnalyzer,
    opportunityAnalyzer: createRegionalConstructionOpportunityAnalyzer(
      testAnalyzer.analyzer,
      fixture.starter,
      fixture.prefab,
      fixture.cement,
    ),
  };
}

function reversed(trackGeometry: TrackGeometryDef): TrackGeometryDef {
  return {
    geometryVersion: 1,
    p0: { ...trackGeometry.p3 },
    p1: { ...trackGeometry.p2 },
    p2: { ...trackGeometry.p1 },
    p3: { ...trackGeometry.p0 },
  };
}

function allowSyntheticCanonicalSampling(): void {
  jest.spyOn(ConstructionCurveSampler, 'sampleConstructionCurve')
    .mockImplementation((trackGeometry) => {
      const sampled = realSampleConstructionCurve(trackGeometry);
      if (sampled.ok) return sampled;
      const length = Math.hypot(
        trackGeometry.p3.x - trackGeometry.p0.x,
        trackGeometry.p3.y - trackGeometry.p0.y,
      );
      return {
        ok: true,
        samples: [{
          t: 0,
          point: trackGeometry.p0,
          distance: 0,
          segmentLength: 0,
        }, {
          t: 1,
          point: trackGeometry.p3,
          distance: length,
          segmentLength: length,
        }],
        length,
        maxLengthError: 0,
      };
    });
}

describe('createRegionalConstructionOpportunityAnalyzer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('extends Port from the Quarry open end and Town from the Forest open end', () => {
    const fixture = regionalFixture();
    const { opportunityAnalyzer } = createAnalyzer(fixture);

    const witness = opportunityAnalyzer?.(DEFAULT_SITES);

    expect(witness).not.toBeNull();
    expect(witness!.portExtension.proposal.geometry).toEqual(
      geometry(
        QUARRY,
        DEFAULT_SITES.portInterchange,
        deriveTrackEndpointOutward(
          fixture.quarryToCementGeometry,
          'start',
        ),
      ),
    );
    expect(witness!.townExtension.proposal.geometry).toEqual(
      geometry(
        FOREST,
        DEFAULT_SITES.townConstructionMarket,
        deriveTrackEndpointOutward(
          fixture.selectedStarterGeometries[0],
          'start',
        ),
      ),
    );
    expect(witness!.topologyCost).toBe(ENDPOINT_CONNECTION_COST * 2);
    expect(witness!.totalCost).toBe(MAX_REGIONAL_CONSTRUCTION_LINK_COST);
  });

  it('replays the canonical selected starter, Prefab, and cement details', () => {
    const fixture = regionalFixture();
    const { geometries, opportunityAnalyzer } = createAnalyzer(fixture);

    expect(opportunityAnalyzer).not.toBeNull();
    expect(geometries).toEqual([
      ...fixture.selectedStarterGeometries,
      fixture.prefabGeometry,
      fixture.quarryToCementGeometry,
      fixture.cementToPrefabGeometry,
    ]);
  });

  it('publishes the bounded pair-analysis and operating-plan constants', () => {
    expect(MAX_REGIONAL_PAIR_ANALYSES).toBe(32);
    expect(REFERENCE_SPEED_WORLD_UNITS_PER_TICK).toBe(20);
    expect(REFERENCE_MANOEUVRE_TICKS).toBe(60);
  });

  it.each([
    ['accepts the inclusive £60,000 cap', 27_500, true],
    ['rejects £60,001', 27_501, false],
  ])('%s', (_label, legCost, accepted) => {
    const fixture = regionalFixture();
    const { opportunityAnalyzer } = createAnalyzer(
      fixture,
      analyzerDouble([legCost, 27_500]),
    );

    const witness = opportunityAnalyzer?.(DEFAULT_SITES) ?? null;

    expect(witness !== null).toBe(accepted);
    if (witness) expect(witness.totalCost).toBe(60_000);
  });

  it.each([
    {
      label: 'accepts 1,599 steel ticks and 1,060 module ticks',
      portLength: 28_780,
      townLength: 17_000,
      accepted: true,
    },
    {
      label: 'rejects 1,600 steel ticks',
      portLength: 28_781,
      townLength: 17_000,
      accepted: false,
    },
    {
      label: 'rejects 1,061 module ticks',
      portLength: 28_780,
      townLength: 17_001,
      accepted: false,
    },
  ])('$label', ({ portLength, townLength, accepted }) => {
    const fixture = regionalFixture();
    jest.spyOn(ConstructionCurveSampler, 'sampleConstructionCurve')
      .mockImplementation((trackGeometry) => {
        const sampled = realSampleConstructionCurve(trackGeometry);
        if (!sampled.ok) return sampled;
        const isPort = trackGeometry.p0.x === QUARRY.x
          && trackGeometry.p0.y === QUARRY.y
          && trackGeometry.p3.y === DEFAULT_SITES.portInterchange.y;
        const isTown = trackGeometry.p0.x === FOREST.x
          && trackGeometry.p0.y === FOREST.y
          && trackGeometry.p3.y === DEFAULT_SITES.townConstructionMarket.y;
        return {
          ...sampled,
          length: isPort ? portLength : isTown ? townLength : 1_000,
        };
      });
    const { opportunityAnalyzer } = createAnalyzer(fixture);

    const witness = opportunityAnalyzer?.(DEFAULT_SITES) ?? null;

    expect(witness !== null).toBe(accepted);
    if (witness) {
      expect(witness.steelPathLength).toBe(30_780);
      expect(witness.modulePathLength).toBe(20_000);
      expect(witness.steelReferenceActiveTicks)
        .toBe(MAX_STEEL_REFERENCE_ACTIVE_TICKS);
      expect(witness.moduleReferenceActiveTicks)
        .toBe(MAX_MODULE_REFERENCE_ACTIVE_TICKS);
      expect(witness.minimumSteelMargin).toBe(10);
      expect(witness.minimumModuleMargin).toBe(16);
    }
  });

  it('fails closed when canonical sampling fails for any selected path segment', () => {
    const fixture = regionalFixture();
    jest.spyOn(ConstructionCurveSampler, 'sampleConstructionCurve')
      .mockImplementation((trackGeometry) => (
        trackGeometry.p0.x === CEMENT_WORKS.x
          && trackGeometry.p3.x === PREFABRICATION.x
          ? { ok: false, lowerBoundLength: 1_000 }
          : realSampleConstructionCurve(trackGeometry)
      ));
    const { opportunityAnalyzer } = createAnalyzer(fixture);

    expect(opportunityAnalyzer?.(DEFAULT_SITES)).toBeNull();
  });

  it.each([
    ['invalid Port analysis', 5],
    ['invalid Town analysis', 6],
  ])('rejects %s', (_label, invalidIndex) => {
    const fixture = regionalFixture();
    const testAnalyzer = analyzerDouble([1_000, 1_000], (detail, index) => (
      index === invalidIndex
        ? {
          ...detail,
          proposal: {
            ...detail.proposal,
            valid: false,
            reasonCode: 'grade',
          },
        }
        : detail
    ));
    const { opportunityAnalyzer } = createAnalyzer(fixture, testAnalyzer);

    expect(opportunityAnalyzer?.(DEFAULT_SITES)).toBeNull();
  });

  it.each([
    ['crossing', { portInterchange: { x: -500, y: 1_000 } }],
    ['overlap', { portInterchange: { ...CEMENT_WORKS } }],
    ['Town overlap', { townConstructionMarket: { ...STARTER_MIDPOINT } }],
  ])('rejects a regional %s', (_label, replacement) => {
    const fixture = regionalFixture();
    allowSyntheticCanonicalSampling();
    const { opportunityAnalyzer } = createAnalyzer(
      fixture,
      analyzerDouble([1_000, 1_000]),
    );

    expect(opportunityAnalyzer?.({
      ...DEFAULT_SITES,
      ...replacement,
    })).toBeNull();
  });

  it('protects the accepted Port leg while checking Town clearance', () => {
    const fixture = regionalFixture();
    allowSyntheticCanonicalSampling();
    const port = { x: 5_000, y: 1_000 };
    const town = { x: 5_500, y: 1_000 };
    const testAnalyzer = analyzerDouble([1_000, 1_000], (detail, index) => {
      if (index !== 6) return detail;
      const points = [
        detail.proposal.geometry.p0,
        { x: -100, y: 100 },
        { x: 0, y: 1_000 },
        { x: 5_000, y: 800 },
        detail.proposal.geometry.p3,
      ];
      return {
        ...detail,
        curveSamples: points.map((point, sampleIndex) => ({
          t: sampleIndex / (points.length - 1),
          point,
          distance: sampleIndex * 1_000,
          segmentLength: sampleIndex === 0 ? 0 : 1_000,
        })),
      };
    });
    const { opportunityAnalyzer } = createAnalyzer(fixture, testAnalyzer);

    expect(opportunityAnalyzer?.({
      portInterchange: port,
      townConstructionMarket: town,
    })).toBeNull();
  });

  it.each([
    ['starter track', 0],
    ['Prefabrication extension', 2],
    ['Quarry-to-Cement track', 3],
    ['Cement-to-Prefabrication track', 4],
  ])('protects every prior %s', (_label, protectedIndex) => {
    const fixture = regionalFixture();
    allowSyntheticCanonicalSampling();
    const testAnalyzer = analyzerDouble([1_000, 1_000], (detail, index) => {
      if (index !== 5) return detail;
      const target = protectedIndex === 0
        ? { x: 500, y: 0 }
        : protectedIndex === 2
        ? { x: 2_500, y: 0 }
        : protectedIndex === 3
        ? { x: 4_500, y: 0 }
        : { x: 3_500, y: 0 };
      const points = [
        detail.proposal.geometry.p0,
        { x: 5_500, y: 500 },
        target,
        detail.proposal.geometry.p3,
      ];
      return {
        ...detail,
        curveSamples: points.map((point, sampleIndex) => ({
          t: sampleIndex / (points.length - 1),
          point,
          distance: sampleIndex * 1_000,
          segmentLength: sampleIndex === 0 ? 0 : 1_000,
        })),
      };
    });
    const { opportunityAnalyzer } = createAnalyzer(fixture, testAnalyzer);

    expect(opportunityAnalyzer?.({
      ...DEFAULT_SITES,
      portInterchange: { x: -500, y: 1_000 },
    })).toBeNull();
  });

  it.each([
    ['Port', 5],
    ['Town', 6],
  ])('rejects analyzer output with reversed %s endpoints', (_label, target) => {
    const fixture = regionalFixture();
    const testAnalyzer = analyzerDouble([1_000, 1_000], (detail, index) => {
      if (index !== target) return detail;
      const reversedGeometry = reversed(detail.proposal.geometry);
      return detailWith(reversedGeometry, detail.proposal.costs.total);
    });
    const { opportunityAnalyzer } = createAnalyzer(fixture, testAnalyzer);

    expect(opportunityAnalyzer?.(DEFAULT_SITES)).toBeNull();
  });

  it.each([
    ['Prefab endpoint', (fixture: RegionalFixture) => {
      fixture.prefab.proposal.geometry.p0.x += 1;
    }],
    ['Prefab topology cost', (fixture: RegionalFixture) => {
      (fixture.prefab as { topologyCost: number }).topologyCost += 1;
    }],
    ['Cement replay cost', (fixture: RegionalFixture) => {
      fixture.cement.quarryToCement.proposal.costs.total += 1;
    }],
    ['Cement topology cost', (fixture: RegionalFixture) => {
      (fixture.cement as { topologyCost: number }).topologyCost += 1;
    }],
    ['reversed Quarry leg', (fixture: RegionalFixture) => {
      fixture.cement.quarryToCement.proposal.geometry =
        reversed(fixture.cement.quarryToCement.proposal.geometry);
    }],
  ])('rejects a forged prior witness: %s', (_label, forge) => {
    const fixture = regionalFixture();
    forge(fixture);

    expect(createRegionalConstructionOpportunityAnalyzer(
      analyzerDouble().analyzer,
      fixture.starter,
      fixture.prefab,
      fixture.cement,
    )).toBeNull();
  });

  it('rejects overflow after individually safe construction costs', () => {
    const fixture = regionalFixture();
    const { opportunityAnalyzer } = createAnalyzer(
      fixture,
      analyzerDouble([Number.MAX_SAFE_INTEGER, 0]),
    );

    expect(opportunityAnalyzer?.(DEFAULT_SITES)).toBeNull();
  });

  it('detaches factory authority from later caller mutation', () => {
    const fixture = regionalFixture();
    const before = clonePlainData(fixture);
    const { opportunityAnalyzer } = createAnalyzer(
      fixture,
      analyzerDouble([1_000, 1_000]),
    );
    fixture.starter.corridors[1].feasibilityWitness.segments[0]
      .geometry.p0.x = 99_999;
    fixture.prefab.proposal.geometry.p3.x = 99_999;
    fixture.cement.quarryToCement.proposal.geometry.p0.x = 99_999;

    const witness = opportunityAnalyzer?.(DEFAULT_SITES);

    expect(witness).not.toBeNull();
    expect(witness!.portExtension.proposal.geometry.p0).toEqual(QUARRY);
    expect(witness!.townExtension.proposal.geometry.p0).toEqual(FOREST);
    expect(before.starter.corridors[1].feasibilityWitness.segments[0]
      .geometry.p0).toEqual(FOREST);
  });

  it('returns a detached deeply frozen witness without mutating callers', () => {
    const fixture = regionalFixture();
    const fixtureBefore = clonePlainData(fixture);
    const sites = clonePlainData(DEFAULT_SITES);
    const sitesBefore = clonePlainData(sites);
    const testAnalyzer = analyzerDouble([1_000, 1_000]);
    const { opportunityAnalyzer, details } = createAnalyzer(
      fixture,
      testAnalyzer,
    );

    const witness = opportunityAnalyzer?.(sites);
    expect(witness).not.toBeNull();
    const acceptedPortY = witness!.portExtension.proposal.geometry.p3.y;
    (sites.portInterchange as Vec2Def).y += 123;
    details[5].proposal.geometry.p3.y += 456;

    expect(witness!.portExtension.proposal.geometry.p3.y).toBe(acceptedPortY);
    expect(fixture).toEqual(fixtureBefore);
    expect({ ...sites, portInterchange: sitesBefore.portInterchange })
      .toEqual(sitesBefore);
    expect(Object.isFrozen(witness)).toBe(true);
    expect(Object.isFrozen(witness!.portExtension)).toBe(true);
    expect(Object.isFrozen(witness!.portExtension.proposal)).toBe(true);
    expect(Object.isFrozen(witness!.portExtension.proposal.geometry)).toBe(true);
    expect(Object.isFrozen(witness!.townExtension.proposal.costs)).toBe(true);
  });
});
