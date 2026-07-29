import { ENDPOINT_CONNECTION_COST } from '../../src/config/ConstructionConfig';
import {
  MAX_CEMENT_SUPPLY_LINK_COST,
  MAX_STARTER_CORRIDOR_COST,
} from '../../src/config/FreightProgression';
import type {
  OpportunityCorridorDef,
  StarterOpportunityDef,
} from '../../src/config/WorldData';
import {
  analyzeCementSupplyOpportunity,
  createCementSupplyOpportunityAnalyzer,
} from '../../src/economy/CementSupplyOpportunity';
import {
  analyzePrefabricationExtension,
  resolvePrefabricationExtensionStart,
} from '../../src/economy/PrefabricationOpportunity';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
} from '../../src/systems/TrackGeometry';
import { clonePlainData } from '../../src/utils/PlainData';

const flatTerrain = { getHeightAt: () => 0 };

function corridor(
  id: string,
  estimatedCost: number,
  analyzer: ConstructionAnalyzer,
): OpportunityCorridorDef {
  const proposal = analyzer.analyze(deriveAutomaticCubic({
    start: { x: 0, y: 0 },
    end: { x: 1_000, y: 0 },
  }));
  return {
    id,
    waypoints: [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
    ],
    estimatedCost,
    dominantTradeoff: id === 'a-cheapest' ? 'short-steep' : 'long-flat',
    feasibilityWitness: {
      witnessVersion: 1,
      segments: [{
        geometry: proposal.geometry,
        verticalProfile: proposal.verticalProfile,
        structures: proposal.structures,
        costs: proposal.costs,
        topologyCost: 0,
      }],
      totalCost: estimatedCost,
    },
  };
}

function opportunity(analyzer: ConstructionAnalyzer): StarterOpportunityDef {
  return {
    opportunityVersion: 1,
    resolvedAttempt: 1,
    sites: [{
      id: 'managed-forest',
      label: 'Managed Forest',
      x: 0,
      y: 0,
      footprintRadius: 192,
    }, {
      id: 'sawmill',
      label: 'Sawmill',
      x: 1_000,
      y: 0,
      footprintRadius: 192,
    }],
    corridors: [
      corridor('z-expensive', 20_000, analyzer),
      corridor('a-cheapest', 10_000, analyzer),
    ],
    recommendedCamera: { x: 500, y: 0, zoom: 0.5 },
  };
}

describe('analyzeCementSupplyOpportunity', () => {
  it('publishes the explicit inclusive generation caps', () => {
    expect(MAX_STARTER_CORRIDOR_COST).toBe(400_000);
    expect(MAX_CEMENT_SUPPLY_LINK_COST).toBe(180_000);
  });

  it('proves sequential mineral links to the existing Prefab terminal with two topology charges', () => {
    const analyzer = new ConstructionAnalyzer(flatTerrain);
    const starter = opportunity(analyzer);
    const extensionStart = resolvePrefabricationExtensionStart(starter);
    expect(extensionStart).not.toBeNull();
    const prefab = { x: 2_000, y: 0 };
    const prefabWitness = analyzePrefabricationExtension(
      analyzer,
      extensionStart!,
      prefab,
    );
    expect(prefabWitness).not.toBeNull();
    const starterBefore = clonePlainData(starter);
    const prefabWitnessBefore = clonePlainData(prefabWitness);

    const witness = analyzeCementSupplyOpportunity(
      analyzer,
      starter,
      prefabWitness!,
      {
        quarry: { x: 1_000, y: 1_000 },
        cementWorks: { x: 2_000, y: 1_000 },
        prefabricationPlant: prefab,
      },
    );

    expect(witness).not.toBeNull();
    expect(witness!.quarryToCement.proposal.geometry).toEqual(
      deriveAutomaticCubic({
        start: { x: 1_000, y: 1_000 },
        end: { x: 2_000, y: 1_000 },
      }),
    );
    expect(witness!.cementToPrefabrication.proposal.geometry).toEqual(
      deriveAutomaticCubic({
        start: { x: 2_000, y: 1_000 },
        end: prefab,
        startOutward: deriveTrackEndpointOutward(
          witness!.quarryToCement.proposal.geometry,
          'end',
        ),
        endOutward: deriveTrackEndpointOutward(
          prefabWitness!.proposal.geometry,
          'end',
        ),
      }),
    );
    expect(witness!.topologyCost).toBe(ENDPOINT_CONNECTION_COST * 2);
    expect(witness!.totalCost).toBe(
      witness!.quarryToCement.proposal.costs.total
        + witness!.cementToPrefabrication.proposal.costs.total
        + ENDPOINT_CONNECTION_COST * 2,
    );
    expect(witness!.totalCost).toBeLessThanOrEqual(
      MAX_CEMENT_SUPPLY_LINK_COST,
    );
    expect(Object.isFrozen(witness)).toBe(true);
    expect(Object.isFrozen(witness!.quarryToCement.proposal.geometry)).toBe(true);
    expect(Object.isFrozen(
      witness!.cementToPrefabrication.proposal.geometry,
    )).toBe(true);
    expect(starter).toEqual(starterBefore);
    expect(prefabWitness).toEqual(prefabWitnessBefore);
  });

  it('selects the cheapest starter corridor with canonical ID tie-breaking', () => {
    const productionAnalyzer = new ConstructionAnalyzer(flatTerrain);
    const starter = opportunity(productionAnalyzer);
    starter.corridors[0].estimatedCost = 10_000;
    starter.corridors[0].feasibilityWitness.totalCost = 10_000;
    starter.corridors[0].feasibilityWitness.segments[0].geometry.p1.y = 100;
    starter.corridors[0].feasibilityWitness.segments[0].geometry.p2.y = 100;
    const expectedGeometry = starter.corridors[1]
      .feasibilityWitness.segments[0].geometry;
    const extensionStart = resolvePrefabricationExtensionStart(starter)!;
    const prefabWitness = analyzePrefabricationExtension(
      productionAnalyzer,
      extensionStart,
      { x: 2_000, y: 0 },
    )!;
    const analyzedGeometries: unknown[] = [];
    const analyzer = {
      analyzeDetailed(geometry: Parameters<
        ConstructionAnalyzer['analyzeDetailed']
      >[0]) {
        analyzedGeometries.push(JSON.parse(JSON.stringify(geometry)));
        return productionAnalyzer.analyzeDetailed(geometry);
      },
    };

    expect(createCementSupplyOpportunityAnalyzer(
      analyzer,
      starter,
      prefabWitness,
    )).not.toBeNull();
    expect(analyzedGeometries[0]).toEqual(expectedGeometry);
  });

  it.each([
    ['accepts the inclusive cap', 87_500, true],
    ['rejects one pound above the cap', 87_501, false],
  ])('%s', (_label, legCost, accepted) => {
    const productionAnalyzer = new ConstructionAnalyzer(flatTerrain);
    const starter = opportunity(productionAnalyzer);
    const extensionStart = resolvePrefabricationExtensionStart(starter)!;
    const prefab = { x: 2_000, y: 0 };
    const prefabWitness = analyzePrefabricationExtension(
      productionAnalyzer,
      extensionStart,
      prefab,
    )!;
    let analyses = 0;
    const analyzer = {
      analyzeDetailed(geometry: Parameters<
        ConstructionAnalyzer['analyzeDetailed']
      >[0]) {
        const detail = productionAnalyzer.analyzeDetailed(geometry);
        const analysisIndex = analyses++;
        if (analysisIndex < 2) return detail;
        return {
          ...detail,
          proposal: {
            ...detail.proposal,
            costs: {
              ...detail.proposal.costs,
              total: legCost,
            },
          },
        };
      },
    };
    const witness = analyzeCementSupplyOpportunity(
      analyzer,
      starter,
      prefabWitness,
      {
        quarry: { x: 1_000, y: 1_000 },
        cementWorks: { x: 2_000, y: 1_000 },
        prefabricationPlant: prefab,
      },
    );

    expect(witness !== null).toBe(accepted);
    if (witness) {
      expect(witness.totalCost).toBe(MAX_CEMENT_SUPPLY_LINK_COST);
    }
  });

  it.each([
    ['starter', { quarry: { x: 200, y: 0 }, cementWorks: { x: 800, y: 0 } }],
    ['Prefab', {
      quarry: { x: 1_500, y: 0 },
      cementWorks: { x: 2_000, y: 1_000 },
    }],
  ])('rejects a first-leg %s clearance collision', (_label, sites) => {
    const productionAnalyzer = new ConstructionAnalyzer(flatTerrain);
    const starter = opportunity(productionAnalyzer);
    const extensionStart = resolvePrefabricationExtensionStart(starter)!;
    const prefab = { x: 2_000, y: 0 };
    const prefabWitness = analyzePrefabricationExtension(
      productionAnalyzer,
      extensionStart,
      prefab,
    )!;
    expect(analyzeCementSupplyOpportunity(
      productionAnalyzer,
      starter,
      prefabWitness,
      {
        ...sites,
        prefabricationPlant: prefab,
      },
    )).toBeNull();
  });

  it('rejects a second leg that collides beyond the Cement throat', () => {
    const productionAnalyzer = new ConstructionAnalyzer(flatTerrain);
    const starter = opportunity(productionAnalyzer);
    const extensionStart = resolvePrefabricationExtensionStart(starter)!;
    const prefab = { x: 2_000, y: 0 };
    const prefabWitness = analyzePrefabricationExtension(
      productionAnalyzer,
      extensionStart,
      prefab,
    )!;
    let analyses = 0;
    let firstLeg = productionAnalyzer.analyzeDetailed(
      deriveAutomaticCubic({
        start: { x: 1_000, y: 1_000 },
        end: { x: 2_000, y: 1_000 },
      }),
    );
    const analyzer = {
      analyzeDetailed(geometry: Parameters<
        ConstructionAnalyzer['analyzeDetailed']
      >[0]) {
        const detail = productionAnalyzer.analyzeDetailed(geometry);
        const analysisIndex = analyses++;
        if (analysisIndex === 2) firstLeg = detail;
        if (analysisIndex !== 3) return detail;
        const curveSamples = detail.curveSamples.map((sample) => ({
          ...sample,
          point: { ...sample.point },
        }));
        const middle = Math.floor(curveSamples.length / 2);
        const firstMiddle = Math.floor(firstLeg.curveSamples.length / 2);
        curveSamples[middle].point = {
          ...firstLeg.curveSamples[firstMiddle].point,
        };
        return { ...detail, curveSamples };
      },
    };

    expect(analyzeCementSupplyOpportunity(
      analyzer,
      starter,
      prefabWitness,
      {
        quarry: { x: 1_000, y: 1_000 },
        cementWorks: { x: 2_000, y: 1_000 },
        prefabricationPlant: prefab,
      },
    )).toBeNull();
  });

  it.each([
    ['non-finite proposal cost', 'cost'],
    ['malformed curve samples', 'samples'],
  ])('fails closed for %s from the analyzer', (_label, failure) => {
    const productionAnalyzer = new ConstructionAnalyzer(flatTerrain);
    const starter = opportunity(productionAnalyzer);
    const extensionStart = resolvePrefabricationExtensionStart(starter)!;
    const prefab = { x: 2_000, y: 0 };
    const prefabWitness = analyzePrefabricationExtension(
      productionAnalyzer,
      extensionStart,
      prefab,
    )!;
    let analyses = 0;
    const analyzer = {
      analyzeDetailed(geometry: Parameters<
        ConstructionAnalyzer['analyzeDetailed']
      >[0]) {
        const detail = productionAnalyzer.analyzeDetailed(geometry);
        const analysisIndex = analyses++;
        if (analysisIndex !== 2) return detail;
        if (failure === 'samples') return { ...detail, curveSamples: [] };
        return {
          ...detail,
          proposal: {
            ...detail.proposal,
            costs: { ...detail.proposal.costs, total: Number.NaN },
          },
        };
      },
    };

    expect(analyzeCementSupplyOpportunity(
      analyzer,
      starter,
      prefabWitness,
      {
        quarry: { x: 1_000, y: 1_000 },
        cementWorks: { x: 2_000, y: 1_000 },
        prefabricationPlant: prefab,
      },
    )).toBeNull();
  });

  it('returns a detached deeply frozen witness', () => {
    const productionAnalyzer = new ConstructionAnalyzer(flatTerrain);
    const starter = opportunity(productionAnalyzer);
    const extensionStart = resolvePrefabricationExtensionStart(starter)!;
    const prefab = { x: 2_000, y: 0 };
    const prefabWitness = analyzePrefabricationExtension(
      productionAnalyzer,
      extensionStart,
      prefab,
    )!;
    const sourceDetails: ReturnType<
      ConstructionAnalyzer['analyzeDetailed']
    >[] = [];
    const analyzer = {
      analyzeDetailed(geometry: Parameters<
        ConstructionAnalyzer['analyzeDetailed']
      >[0]) {
        const detail = productionAnalyzer.analyzeDetailed(geometry);
        sourceDetails.push(detail);
        return detail;
      },
    };
    const witness = analyzeCementSupplyOpportunity(
      analyzer,
      starter,
      prefabWitness,
      {
        quarry: { x: 1_000, y: 1_000 },
        cementWorks: { x: 2_000, y: 1_000 },
        prefabricationPlant: prefab,
      },
    )!;
    const acceptedStartX = witness.quarryToCement.proposal.geometry.p0.x;
    sourceDetails[2].proposal.geometry.p0.x += 123;

    expect(witness.quarryToCement.proposal.geometry.p0.x).toBe(acceptedStartX);
    expect(Object.isFrozen(witness)).toBe(true);
    expect(Object.isFrozen(witness.quarryToCement.proposal)).toBe(true);
    expect(Object.isFrozen(
      witness.cementToPrefabrication.proposal.costs,
    )).toBe(true);
  });
});
