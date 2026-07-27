import { ENDPOINT_CONNECTION_COST } from '../../src/config/ConstructionConfig';
import type { ConstructionProposal } from '../../src/systems/ConstructionAnalyzer';
import { deriveAutomaticCubic } from '../../src/systems/TrackGeometry';
import {
  analyzePrefabricationExtension,
} from '../../src/economy/PrefabricationOpportunity';

const sawmill = { x: 100, y: 200 };
const prefabricationPlant = { x: 1_100, y: 700 };

function proposalWith(
  constructionCost: number,
  valid = true,
): ConstructionProposal {
  return {
    geometry: {
      geometryVersion: 1,
      p0: { x: 100, y: 200 },
      p1: { x: 300, y: 300 },
      p2: { x: 900, y: 600 },
      p3: { x: 1_100, y: 700 },
    },
    verticalProfile: {
      profileVersion: 1,
      knots: [
        { t: 0, elevation: 0 },
        { t: 1, elevation: 0 },
      ],
    },
    length: 1_118,
    minimumRadius: Number.POSITIVE_INFINITY,
    maximumGradePercent: 0,
    maximumGradeT: 0,
    maximumGradeDistance: 0,
    structures: [],
    structureLengths: {
      surface: 1_118,
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

describe('analyzePrefabricationExtension', () => {
  it('accepts the inclusive £194,000 witness boundary with one topology charge', () => {
    const proposal = proposalWith(191_500);
    const analyzedGeometries: unknown[] = [];
    const analyzer = {
      analyze(geometry: unknown): ConstructionProposal {
        analyzedGeometries.push(geometry);
        return proposal;
      },
    };

    const witness = analyzePrefabricationExtension(
      analyzer,
      sawmill,
      prefabricationPlant,
    );

    expect(witness).toEqual({
      proposal,
      topologyCost: 2_500,
      totalCost: 194_000,
    });
    expect(witness?.topologyCost).toBe(ENDPOINT_CONNECTION_COST);
    expect(analyzedGeometries).toEqual([
      deriveAutomaticCubic({
        start: sawmill,
        end: prefabricationPlant,
      }),
    ]);
  });

  it('rejects £194,001 after adding the endpoint topology charge', () => {
    const analyzer = {
      analyze: () => proposalWith(191_501),
    };

    expect(analyzePrefabricationExtension(
      analyzer,
      sawmill,
      prefabricationPlant,
    )).toBeNull();
  });

  it('rejects invalid construction geometry even when it is affordable', () => {
    const analyzer = {
      analyze: () => proposalWith(1_000, false),
    };

    expect(analyzePrefabricationExtension(
      analyzer,
      sawmill,
      prefabricationPlant,
    )).toBeNull();
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['unsafe integer', Number.MAX_SAFE_INTEGER],
  ])('rejects a %s construction cost', (_label, constructionCost) => {
    const analyzer = {
      analyze: () => proposalWith(constructionCost),
    };

    expect(analyzePrefabricationExtension(
      analyzer,
      sawmill,
      prefabricationPlant,
    )).toBeNull();
  });
});
