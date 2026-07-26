import {
  MAX_ECONOMY_SITE_CANDIDATES,
  WorldGenerationConfig,
} from '../../src/config/WorldGeneration';
import type {
  StarterOpportunityDef,
  WorldGenerationConfigDef,
} from '../../src/config/WorldData';
import {
  WorldEconomyGenerator,
} from '../../src/economy/WorldEconomyGenerator';
import { INITIAL_PRODUCTS } from '../../src/economy/InitialEconomyContent';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';

const terrain = {
  getHeightAt(x: number, y: number): number {
    return 120
      + x * 0.008
      + Math.sin(x / 420) * 32
      + Math.cos(y / 510) * 24;
  },
};

const config: WorldGenerationConfigDef = {
  generationConfigVersion: 1,
  seed: 'economy-alpha',
  biome: 'temperate',
  constructionDifficultyId: 'standard',
};

function reliefAt(x: number, y: number): number {
  const radius = WorldGenerationConfig.SITE_FOOTPRINT_RADIUS;
  const heights: number[] = [];
  for (const dx of [-radius, 0, radius]) {
    for (const dy of [-radius, 0, radius]) {
      heights.push(terrain.getHeightAt(x + dx, y + dy));
    }
  }
  return Math.max(...heights) - Math.min(...heights);
}

function generate(
  generationConfig: WorldGenerationConfigDef = config,
  opportunity: StarterOpportunityDef = makeStarterOpportunity(
    generationConfig.seed,
  ),
) {
  return new WorldEconomyGenerator(terrain).generate(
    generationConfig,
    opportunity,
  );
}

describe('WorldEconomyGenerator', () => {
  it('places the opportunity forest and sawmill at the unchanged corridor endpoints', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const result = generate(config, opportunity);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [forest, sawmill] = result.economy.facilities;
    expect(forest).toEqual(expect.objectContaining({
      id: 'managed-forest',
      definitionId: 'managed-forest',
      name: 'Managed Forest',
      x: opportunity.sites[0].x,
      y: opportunity.sites[0].y,
    }));
    expect(sawmill).toEqual(expect.objectContaining({
      id: 'sawmill',
      definitionId: 'sawmill',
      name: 'Sawmill',
      x: opportunity.sites[1].x,
      y: opportunity.sites[1].y,
    }));
    for (const corridor of opportunity.corridors) {
      expect(corridor.waypoints[0]).toEqual({
        x: forest.x,
        y: forest.y,
      });
      expect(corridor.waypoints[corridor.waypoints.length - 1]).toEqual({
        x: sawmill.x,
        y: sawmill.y,
      });
    }
  });

  it('creates all seven stable facilities on safe, separated, bounded sites', () => {
    const result = generate();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.economy.facilities.map((facility) => facility.id)).toEqual([
      'managed-forest',
      'sawmill',
      'quarry',
      'cement-works',
      'port-interchange',
      'prefabrication-plant',
      'town-construction-market',
    ]);

    const accessKeys = new Set<string>();
    result.economy.facilities.forEach((facility, index, facilities) => {
      expect(facility.definitionId).toBe(facility.id);
      expect(facility.railAccess).toEqual({
        x: facility.x,
        y: facility.y,
        radius: WorldGenerationConfig.FACILITY_RAIL_ACCESS_RADIUS,
      });
      expect(
        Math.abs(facility.x) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS,
      ).toBeLessThanOrEqual(WorldGenerationConfig.WORLD_HALF_WIDTH);
      expect(
        Math.abs(facility.y) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS,
      ).toBeLessThanOrEqual(WorldGenerationConfig.WORLD_HALF_HEIGHT);
      expect(reliefAt(facility.x, facility.y))
        .toBeLessThanOrEqual(WorldGenerationConfig.MAX_SITE_RELIEF);
      const accessKey = `${facility.railAccess.x}:${facility.railAccess.y}`;
      expect(accessKeys.has(accessKey)).toBe(false);
      accessKeys.add(accessKey);

      facilities.slice(index + 1).forEach((other) => {
        expect(Math.hypot(other.x - facility.x, other.y - facility.y))
          .toBeGreaterThanOrEqual(
            WorldGenerationConfig.MIN_FACILITY_SEPARATION,
          );
      });
    });
  });

  it('instantiates deterministic active-start inventories from the content graph', () => {
    const result = generate();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.economy.facilities.map((facility) => ({
      id: facility.id,
      recipe: facility.activeRecipeId,
      progress: facility.recipeProgressTicks,
      inventory: Object.keys(facility.inventories).sort().map((productId) => {
        const slot = facility.inventories[productId];
        return [
          productId,
          slot.quantity,
          slot.capacity,
          slot.targetStock,
          slot.reservedQuantity,
          slot.recentInflow,
          slot.recentOutflow,
        ];
      }),
    }))).toEqual([
      {
        id: 'managed-forest',
        recipe: 'forest-harvest',
        progress: 0,
        inventory: [['logs', 60, 240, 120, 0, 0, 0]],
      },
      {
        id: 'sawmill',
        recipe: 'sawmill-cut',
        progress: 0,
        inventory: [
          ['logs', 0, 200, 100, 0, 0, 0],
          ['structural-timber', 0, 160, 80, 0, 0, 0],
        ],
      },
      {
        id: 'quarry',
        recipe: 'quarry-extraction',
        progress: 0,
        inventory: [['limestone-aggregate', 75, 300, 150, 0, 0, 0]],
      },
      {
        id: 'cement-works',
        recipe: 'cement-kiln',
        progress: 0,
        inventory: [
          ['cement', 0, 160, 80, 0, 0, 0],
          ['limestone-aggregate', 0, 240, 120, 0, 0, 0],
        ],
      },
      {
        id: 'port-interchange',
        recipe: null,
        progress: 0,
        inventory: [
          ['building-modules', 0, 120, 60, 0, 0, 0],
          ['steel', 120, 240, 120, 0, 0, 0],
        ],
      },
      {
        id: 'prefabrication-plant',
        recipe: 'module-assembly',
        progress: 0,
        inventory: [
          ['building-modules', 0, 120, 60, 0, 0, 0],
          ['cement', 0, 160, 80, 0, 0, 0],
          ['steel', 0, 160, 80, 0, 0, 0],
          ['structural-timber', 0, 160, 80, 0, 0, 0],
        ],
      },
      {
        id: 'town-construction-market',
        recipe: null,
        progress: 0,
        inventory: [['building-modules', 0, 160, 80, 0, 0, 0]],
      },
    ]);
  });

  it('replays identical economy state and diagnostics for the same seed', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const first = generate(config, opportunity);
    const replay = generate(config, opportunity);

    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
  });

  it('keeps every regional demand factor bounded and varies generated state by seed', () => {
    const first = generate(config);
    const differentConfig = { ...config, seed: 'economy-beta' };
    const different = generate(differentConfig);

    expect(first.ok).toBe(true);
    expect(different.ok).toBe(true);
    if (!first.ok || !different.ok) return;
    for (const result of [first, different]) {
      expect(Object.keys(
        result.economy.market.regionalDemandBpsByProduct,
      ).sort()).toEqual(INITIAL_PRODUCTS.map((product) => product.id).sort());
      for (const factor of Object.values(
        result.economy.market.regionalDemandBpsByProduct,
      )) {
        expect(factor).toBeGreaterThanOrEqual(8_000);
        expect(factor).toBeLessThanOrEqual(12_000);
      }
    }
    expect({
      secondary: different.economy.facilities.slice(2).map(
        ({ id, x, y }) => ({ id, x, y }),
      ),
      demand: different.economy.market.regionalDemandBpsByProduct,
    }).not.toEqual({
      secondary: first.economy.facilities.slice(2).map(
        ({ id, x, y }) => ({ id, x, y }),
      ),
      demand: first.economy.market.regionalDemandBpsByProduct,
    });
  });

  it('returns a bounded exhaustion error without partial economy state', () => {
    const unusableTerrain = {
      getHeightAt(x: number): number {
        return x;
      },
    };
    const result = new WorldEconomyGenerator(unusableTerrain).generate(
      config,
      makeStarterOpportunity(config.seed),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: config.seed,
        candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
        facilitiesPlaced: 0,
      },
    });
    expect('economy' in result).toBe(false);
  });

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s terrain samples instead of accepting indeterminate relief', (
    _label,
    height,
  ) => {
    const result = new WorldEconomyGenerator({
      getHeightAt: () => height,
    }).generate(config, makeStarterOpportunity(config.seed));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: config.seed,
        candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
        facilitiesPlaced: 0,
      },
    });
  });
});
