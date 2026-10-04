import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { LANDSCAPE_PRESET_IDS, shapeLandscapeHeight } from '../../src/config/WorldGeneration';
import { prepareNewRegionalWorld } from '../../src/region/NewRegionalWorld';
import { createEmptyWorld, validateWorldData } from '../../src/config/WorldData';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';
import { INITIAL_FACILITY_DEFINITIONS, INITIAL_PRODUCTS } from '../../src/economy/InitialEconomyContent';
import { validateRegionState } from '../../src/region/RegionalProjects';

describe('landscape heightfields', () => {
  it('keeps the legacy heightfield unchanged when no preset is supplied', () => {
    const original = new TerrainGenerator('unchanged-seed');
    const explicit = new TerrainGenerator('unchanged-seed', undefined);
    for (let x = 0; x < original.samplesX; x += 8) {
      for (let y = 0; y < original.samplesY; y += 8) expect(explicit.getHeightAtGrid(x, y)).toBe(original.getHeightAtGrid(x, y));
    }
    expect(shapeLandscapeHeight(undefined, 10, 20, 34)).toBe(34);
  });
  it.each(LANDSCAPE_PRESET_IDS)('replays %s deterministically and changes real heights', preset => {
    const first = new TerrainGenerator('landscape-test', preset);
    const again = new TerrainGenerator('landscape-test', preset);
    const legacy = new TerrainGenerator('landscape-test');
    const points = [[-6_000, 0], [0, 0], [4_000, 2_000], [7_000, -3_000]];
    expect(points.map(([x, y]) => first.getHeightAt(x, y))).toEqual(points.map(([x, y]) => again.getHeightAt(x, y)));
    expect(points.map(([x, y]) => first.getHeightAt(x, y))).not.toEqual(points.map(([x, y]) => legacy.getHeightAt(x, y)));
  });
  it('makes lowland hills gentler, a real coastal sea, and highland ridges materially higher', () => {
    const lowlands = new TerrainGenerator('landscape-test', 'lowlands');
    const coastal = new TerrainGenerator('landscape-test', 'coastal');
    const mountains = new TerrainGenerator('landscape-test', 'mountains');
    const samples = (terrain: TerrainGenerator) => Array.from({ length: 15 }, (_, i) => terrain.getHeightAt(-7_000 + i * 1_000, 0));
    const low = samples(lowlands);
    const high = samples(mountains);
    expect(Math.max(...high) - Math.min(...high)).toBeGreaterThan((Math.max(...low) - Math.min(...low)) * 2);
    expect(Math.max(...high)).toBeGreaterThan(300);
    expect(coastal.getBandAt(-7_000, 0)).toBe('WATER');
    expect(coastal.getHeightAt(7_000, 0)).toBeGreaterThan(0);
  });
});

describe('atomic new regional world preparation', () => {
  const base = () => createEmptyWorld('Test Region', 'new-region', 'temperate', makeStarterOpportunity(), {
    economyVersion: 1, tick: 0,
    market: { constructionIndexBps: 10_000, regionalDemandBpsByProduct: Object.fromEntries(INITIAL_PRODUCTS.map(p => [p.id, 10_000])) },
    facilities: INITIAL_FACILITY_DEFINITIONS.map((definition, i) => ({
      id: definition.id, definitionId: definition.id, name: definition.displayName,
      x: i * 700 - 2_000, y: 0, railAccess: { x: i * 700 - 2_000, y: 0, radius: 320 },
      inventories: Object.fromEntries(definition.inventory.map(slot => [slot.productId, { productId: slot.productId, quantity: slot.initialQuantity, capacity: slot.capacity, targetStock: slot.targetStock, recentInflow: 0, recentOutflow: 0, reservedQuantity: 0 }])),
      activeRecipeId: definition.recipeIds[0] ?? null, recipeProgressTicks: 0,
    })),
  });
  it.each([['standard', 1_000_000], ['expert', 750_000], ['sandbox', 1_000_000_000]] as const)('initializes %s before the first save', (difficulty, cash) => {
    const source = base();
    const prepared = prepareNewRegionalWorld(source, { getHeightAt: () => 40 }, difficulty);
    expect(prepared.management?.speed).toBe(0);
    expect(prepared.region?.projects).toHaveLength(5);
    expect(validateRegionState(prepared.region)).toBe(true);
    expect(prepared.economy.facilities).toHaveLength(13);
    expect(Object.keys(prepared.economy.market.regionalDemandBpsByProduct)).toHaveLength(10);
    expect(prepared.company.cash).toBe(cash);
    expect(prepared.company.ledger[0].amount).toBe(cash);
    expect(prepared.generationConfig.gameDifficulty).toBe(difficulty);
    expect(validateWorldData(prepared).compatible).toBe(true);
    expect(source.management).toBeUndefined();
    expect(source.economy.facilities).toHaveLength(7);
  });
  it('leaves the source untouched when a secondary site cannot be placed', () => {
    const source = base();
    const before = JSON.stringify(source);
    expect(() => prepareNewRegionalWorld(source, { getHeightAt: () => -100 })).toThrow('No safe secondary site');
    expect(JSON.stringify(source)).toBe(before);
  });
  it('does not reset an existing operating company', () => {
    const source = base();
    source.revision = 1;
    expect(() => prepareNewRegionalWorld(source, { getHeightAt: () => 40 })).toThrow('untouched world');
  });
});
