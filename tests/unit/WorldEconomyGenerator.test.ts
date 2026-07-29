import {
  MAX_ECONOMY_SITE_CANDIDATES,
  REGIONAL_ENDPOINT_MAX_CHORD,
  REGIONAL_ENDPOINT_MIN_CHORD,
  WorldGenerationConfig,
} from '../../src/config/WorldGeneration';
import type {
  StarterOpportunityDef,
  WorldGenerationConfigDef,
} from '../../src/config/WorldData';
import {
  buildRegionalEndpointOffsets,
  MAX_CEMENT_SUPPLY_PAIR_ANALYSES,
  WorldEconomyGenerator,
  validateGeneratedEconomy,
} from '../../src/economy/WorldEconomyGenerator';
import { INITIAL_PRODUCTS } from '../../src/economy/InitialEconomyContent';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';
import {
  analyzePrefabricationExtension,
  resolvePrefabricationExtensionStart,
} from '../../src/economy/PrefabricationOpportunity';
import {
  PREFAB_ACCESS_LINK_ALLOWANCE,
  PREFAB_EXTENSION_OPERATING_RESERVE,
  REGIONAL_DEVELOPMENT_GRANT,
} from '../../src/config/FreightProgression';
import {
  ConstructionAnalyzer,
} from '../../src/systems/ConstructionAnalyzer';
import { canonicalizeConstructionGridPoint } from '../../src/systems/ConstructionGrid';
import { GameConfig } from '../../src/config/GameConfig';
import {
  analyzeCementSupplyOpportunity,
} from '../../src/economy/CementSupplyOpportunity';
import * as CementSupplyOpportunity
  from '../../src/economy/CementSupplyOpportunity';
import {
  MAX_CEMENT_SUPPLY_LINK_COST,
  MAX_MODULE_REFERENCE_ACTIVE_TICKS,
  MAX_REGIONAL_CONSTRUCTION_LINK_COST,
  MAX_REGIONAL_PAIR_ANALYSES,
  MAX_STEEL_REFERENCE_ACTIVE_TICKS,
} from '../../src/config/FreightProgression';
import {
  createRegionalConstructionOpportunityAnalyzer,
} from '../../src/economy/RegionalConstructionOpportunity';
import * as RegionalConstructionOpportunity
  from '../../src/economy/RegionalConstructionOpportunity';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
} from '../../src/systems/TrackGeometry';
import * as TrackGeometry from '../../src/systems/TrackGeometry';
import {
  ConstructionConfig,
  ENDPOINT_CONNECTION_COST,
} from '../../src/config/ConstructionConfig';

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
  seed: 'playtest-633',
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

function expectAffordablePrefab(
  result: ReturnType<typeof generate>,
  opportunity: StarterOpportunityDef,
  sourceTerrain = terrain,
): number {
  expect(result.ok).toBe(true);
  if (!result.ok) return Number.NaN;
  const sawmill = result.economy.facilities.find(
    ({ id }) => id === 'sawmill',
  )!;
  const prefab = result.economy.facilities.find(
    ({ id }) => id === 'prefabrication-plant',
  )!;
  const start = resolvePrefabricationExtensionStart(opportunity);
  expect(start).not.toBeNull();
  const witness = analyzePrefabricationExtension(
    new ConstructionAnalyzer(sourceTerrain),
    start!,
    prefab.railAccess,
  );
  expect(witness).not.toBeNull();
  expect(witness!.totalCost).toBeLessThanOrEqual(194_000);
  expect(
    witness!.totalCost
      + PREFAB_ACCESS_LINK_ALLOWANCE
      + PREFAB_EXTENSION_OPERATING_RESERVE,
  ).toBeLessThanOrEqual(REGIONAL_DEVELOPMENT_GRANT);
  return witness!.totalCost;
}

function expectAffordableCementSupply(
  result: ReturnType<typeof generate>,
  opportunity: StarterOpportunityDef,
  sourceTerrain = terrain,
): number {
  expect(result.ok).toBe(true);
  if (!result.ok) return Number.NaN;
  const facility = (id: string) => result.economy.facilities.find(
    (candidate) => candidate.id === id,
  )!;
  const extensionStart = resolvePrefabricationExtensionStart(opportunity);
  const analyzer = new ConstructionAnalyzer(sourceTerrain);
  const prefabWitness = analyzePrefabricationExtension(
    analyzer,
    extensionStart!,
    facility('prefabrication-plant').railAccess,
  );
  expect(prefabWitness).not.toBeNull();
  const witness = analyzeCementSupplyOpportunity(
    analyzer,
    opportunity,
    prefabWitness!,
    {
      quarry: facility('quarry').railAccess,
      cementWorks: facility('cement-works').railAccess,
      prefabricationPlant: facility('prefabrication-plant').railAccess,
    },
  );
  expect(witness).not.toBeNull();
  expect(witness!.totalCost).toBeLessThanOrEqual(
    MAX_CEMENT_SUPPLY_LINK_COST,
  );
  expect(result.diagnostics.mineralPairAnalyses)
    .toBeLessThanOrEqual(MAX_CEMENT_SUPPLY_PAIR_ANALYSES);
  return witness!.totalCost;
}

function expectRegionalConstructionSupply(
  result: ReturnType<typeof generate>,
  opportunity: StarterOpportunityDef,
  sourceTerrain = terrain,
) {
  expect(result.ok).toBe(true);
  if (!result.ok) return null;
  const facility = (id: string) => result.economy.facilities.find(
    (candidate) => candidate.id === id,
  )!;
  const analyzer = new ConstructionAnalyzer(sourceTerrain);
  const extensionStart = resolvePrefabricationExtensionStart(opportunity);
  const prefabWitness = extensionStart
    ? analyzePrefabricationExtension(
      analyzer,
      extensionStart,
      facility('prefabrication-plant').railAccess,
    )
    : null;
  const cementWitness = prefabWitness
    ? analyzeCementSupplyOpportunity(
      analyzer,
      opportunity,
      prefabWitness,
      {
        quarry: facility('quarry').railAccess,
        cementWorks: facility('cement-works').railAccess,
        prefabricationPlant: facility('prefabrication-plant').railAccess,
      },
    )
    : null;
  const regionalAnalyzer = prefabWitness && cementWitness
    ? createRegionalConstructionOpportunityAnalyzer(
      analyzer,
      opportunity,
      prefabWitness,
      cementWitness,
    )
    : null;
  const witness = regionalAnalyzer?.({
    portInterchange: facility('port-interchange').railAccess,
    townConstructionMarket:
      facility('town-construction-market').railAccess,
  }) ?? null;

  expect(witness).not.toBeNull();
  if (!witness) return null;
  expect(witness.totalCost).toBeLessThanOrEqual(
    MAX_REGIONAL_CONSTRUCTION_LINK_COST,
  );
  expect(witness.steelReferenceActiveTicks).toBeLessThanOrEqual(
    MAX_STEEL_REFERENCE_ACTIVE_TICKS,
  );
  expect(witness.moduleReferenceActiveTicks).toBeLessThanOrEqual(
    MAX_MODULE_REFERENCE_ACTIVE_TICKS,
  );
  expect(witness.minimumSteelMargin).toBeGreaterThan(0);
  expect(witness.minimumModuleMargin).toBeGreaterThan(0);
  expect(result.diagnostics).toEqual(expect.objectContaining({
    regionalPairAnalyses: expect.any(Number),
    regionalTotalCost: witness.totalCost,
    regionalSteelPathLength: witness.steelPathLength,
    regionalModulePathLength: witness.modulePathLength,
    regionalSteelReferenceActiveTicks: witness.steelReferenceActiveTicks,
    regionalModuleReferenceActiveTicks: witness.moduleReferenceActiveTicks,
    regionalMinimumSteelMargin: witness.minimumSteelMargin,
    regionalMinimumModuleMargin: witness.minimumModuleMargin,
  }));
  expect((result.diagnostics as any).regionalPairAnalyses)
    .toBeLessThanOrEqual(MAX_REGIONAL_PAIR_ANALYSES);
  return witness;
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

  it.each(['playtest-633', 'playtest-602'])(
    'places an affordable terrain-valid Prefab extension for representative seed %s',
    (seed) => {
      const generationConfig = { ...config, seed };
      const opportunity = makeStarterOpportunity(seed);
      const result = generate(generationConfig, opportunity);

      expectAffordablePrefab(result, opportunity);
    },
  );

  it('places a bounded terrain-valid cement supply pair for a representative seed', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const result = generate(config, opportunity);

    expectAffordableCementSupply(result, opportunity);
  });

  it('constructs mineral curves only after cheap pair bounds pass', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const extensionStart = resolvePrefabricationExtensionStart(opportunity)!;
    const derive = jest.spyOn(TrackGeometry, 'deriveAutomaticCubic');

    const result = generate(config, opportunity);
    const calls = derive.mock.calls.map(([options]) => options);
    derive.mockRestore();

    let activePrefab: { x: number; y: number } | null = null;
    let rejectedPairCurves = 0;
    for (let callIndex = 0; callIndex < calls.length; callIndex++) {
      const options = calls[callIndex];
      if (options.start.x === extensionStart.point.x
        && options.start.y === extensionStart.point.y
        && options.startOutward) {
        activePrefab = options.end;
        continue;
      }
      if (options.startOutward || options.endOutward || !activePrefab) continue;
      const continuation = calls[callIndex + 1];
      if (!continuation?.startOutward
        || continuation.start.x !== options.end.x
        || continuation.start.y !== options.end.y
        || continuation.end.x !== activePrefab.x
        || continuation.end.y !== activePrefab.y) {
        continue;
      }
      const firstDirection = {
        x: options.end.x - options.start.x,
        y: options.end.y - options.start.y,
      };
      const secondDirection = {
        x: activePrefab.x - options.end.x,
        y: activePrefab.y - options.end.y,
      };
      const firstDistance = Math.hypot(
        firstDirection.x,
        firstDirection.y,
      );
      const secondDistance = Math.hypot(
        secondDirection.x,
        secondDirection.y,
      );
      const alignment = (
        firstDirection.x * secondDirection.x
          + firstDirection.y * secondDirection.y
      ) / (firstDistance * secondDistance);
      const minimumEngineeringCost = Math.round(
        firstDistance * ConstructionConfig.TRACK_COST_PER_UNIT,
      ) + Math.round(
        secondDistance * ConstructionConfig.TRACK_COST_PER_UNIT,
      ) + ENDPOINT_CONNECTION_COST * 2;
      if (alignment <= 0
        || minimumEngineeringCost > MAX_CEMENT_SUPPLY_LINK_COST) {
        rejectedPairCurves += 1;
      }
    }

    expect(result.ok).toBe(true);
    expect(rejectedPairCurves).toBe(0);
  });

  it('rounds each mineral leg before applying the engineering-cost cap', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const extensionStart = resolvePrefabricationExtensionStart(opportunity)!;
    const baselineDerive = jest.spyOn(
      TrackGeometry,
      'deriveAutomaticCubic',
    );
    generate(config, opportunity);
    const baselineCalls = baselineDerive.mock.calls.map(([options]) => options);
    baselineDerive.mockRestore();

    let activePrefab: { x: number; y: number } | null = null;
    let boundaryPair: {
      quarry: { x: number; y: number };
      cement: { x: number; y: number };
      prefab: { x: number; y: number };
      firstDirection: { x: number; y: number };
      secondDirection: { x: number; y: number };
    } | null = null;
    for (let index = 0; index < baselineCalls.length - 1; index++) {
      const current = baselineCalls[index];
      if (current.start.x === extensionStart.point.x
        && current.start.y === extensionStart.point.y
        && current.startOutward) {
        activePrefab = current.end;
        continue;
      }
      const continuation = baselineCalls[index + 1];
      if (!current.startOutward
        && !current.endOutward
        && activePrefab
        && continuation.startOutward
        && continuation.start.x === current.end.x
        && continuation.start.y === current.end.y
        && continuation.end.x === activePrefab.x
        && continuation.end.y === activePrefab.y) {
        boundaryPair = {
          quarry: current.start,
          cement: current.end,
          prefab: activePrefab,
          firstDirection: {
            x: current.end.x - current.start.x,
            y: current.end.y - current.start.y,
          },
          secondDirection: {
            x: activePrefab.x - current.end.x,
            y: activePrefab.y - current.end.y,
          },
        };
        break;
      }
    }
    expect(boundaryPair).not.toBeNull();
    if (!boundaryPair) return;

    const boundaryDistance = 8_750.04;
    const rawCombinedCost = boundaryDistance * 2
      * ConstructionConfig.TRACK_COST_PER_UNIT
      + ENDPOINT_CONNECTION_COST * 2;
    expect(rawCombinedCost).toBeGreaterThan(MAX_CEMENT_SUPPLY_LINK_COST);
    expect(
      Math.round(
        boundaryDistance * ConstructionConfig.TRACK_COST_PER_UNIT,
      ) * 2 + ENDPOINT_CONNECTION_COST * 2,
    ).toBe(MAX_CEMENT_SUPPLY_LINK_COST);

    const realHypot = Math.hypot.bind(Math);
    const hypot = jest.spyOn(Math, 'hypot').mockImplementation(
      (...values: number[]) => {
        if (values.length === 2
          && (
            (
              values[0] === boundaryPair.firstDirection.x
              && values[1] === boundaryPair.firstDirection.y
            )
            || (
              values[0] === boundaryPair.secondDirection.x
              && values[1] === boundaryPair.secondDirection.y
            )
          )) {
          return boundaryDistance;
        }
        return realHypot(...values);
      },
    );
    const derive = jest.spyOn(TrackGeometry, 'deriveAutomaticCubic');
    try {
      generate(config, opportunity);
    } finally {
      hypot.mockRestore();
    }
    const calls = derive.mock.calls.map(([options]) => options);
    derive.mockRestore();

    expect(calls.some((options, index) => {
      const continuation = calls[index + 1];
      return options.start.x === boundaryPair.quarry.x
        && options.start.y === boundaryPair.quarry.y
        && options.end.x === boundaryPair.cement.x
        && options.end.y === boundaryPair.cement.y
        && continuation?.start.x === boundaryPair.cement.x
        && continuation.start.y === boundaryPair.cement.y
        && continuation.end.x === boundaryPair.prefab.x
        && continuation.end.y === boundaryPair.prefab.y
        && continuation.startOutward !== undefined;
    })).toBe(true);
  });

  it('defers ordinary Town endpoint analysis until a mineral pair resolves', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const forest = opportunity.sites[0];
    const analyzeDetailed = jest.spyOn(
      ConstructionAnalyzer.prototype,
      'analyzeDetailed',
    );
    const getHeightAt = jest.spyOn(terrain, 'getHeightAt');
    const createCement = jest.spyOn(
      CementSupplyOpportunity,
      'createCementSupplyOpportunityAnalyzer',
    ).mockReturnValue(null);

    const result = generate(config, opportunity);
    const townEndpointAnalyses = analyzeDetailed.mock.calls.filter(
      ([geometry]) => {
        const chord = Math.hypot(
          geometry.p3.x - geometry.p0.x,
          geometry.p3.y - geometry.p0.y,
        );
        return geometry.p0.x === forest.x
          && geometry.p0.y === forest.y
          && chord >= 1_024
          && chord <= 2_048;
      },
    );
    const knownTownFootprintSamples = new Set([
      '-3092:-1542', '-3092:-1350', '-3092:-1158',
      '-2900:-1542', '-2900:-1350', '-2900:-1158',
      '-2708:-1542', '-2708:-1350', '-2708:-1158',
    ]);
    const townFootprintCalls = getHeightAt.mock.calls.filter(
      ([x, y]) => knownTownFootprintSamples.has(`${x}:${y}`),
    );

    analyzeDetailed.mockRestore();
    getHeightAt.mockRestore();
    createCement.mockRestore();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: config.seed,
        candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
        prefabAnalyses: expect.any(Number),
        mineralPairAnalyses: 0,
        regionalPairAnalyses: 0,
        facilitiesPlaced: 1,
      },
    });
    expect(townEndpointAnalyses).toHaveLength(0);
    expect(townFootprintCalls).toHaveLength(0);
  });

  it('skips Port relief and exact work when every Town exceeds its necessary bound', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const forest = opportunity.sites[0];
    const forbiddenPortReliefSamples = new Set<string>();
    let portReliefCalls = 0;
    const guardedTerrain = {
      getHeightAt(x: number, y: number): number {
        if (forbiddenPortReliefSamples.has(`${x}:${y}`)) {
          portReliefCalls += 1;
        }
        return terrain.getHeightAt(x, y);
      },
    };
    const minimumPortTrackCost = REGIONAL_ENDPOINT_MIN_CHORD * 10;
    const maximumViableTownCost = MAX_REGIONAL_CONSTRUCTION_LINK_COST
      - ENDPOINT_CONNECTION_COST * 2
      - minimumPortTrackCost;
    const realAnalyzeDetailed =
      ConstructionAnalyzer.prototype.analyzeDetailed;
    const portContexts: Array<{
      source: { x: number; y: number };
      analysisCallOffset: number;
    }> = [];
    const analyzeDetailed = jest.spyOn(
      ConstructionAnalyzer.prototype,
      'analyzeDetailed',
    ).mockImplementation(function makeTownsUnaffordable(
      geometry,
      options,
    ) {
      const detail = realAnalyzeDetailed.call(this, geometry, options);
      const chord = Math.hypot(
        geometry.p3.x - geometry.p0.x,
        geometry.p3.y - geometry.p0.y,
      );
      if (geometry.p0.x !== forest.x
        || geometry.p0.y !== forest.y
        || chord < REGIONAL_ENDPOINT_MIN_CHORD
        || chord > REGIONAL_ENDPOINT_MAX_CHORD) {
        return detail;
      }
      return {
        ...detail,
        proposal: {
          ...detail.proposal,
          costs: {
            ...detail.proposal.costs,
            total: maximumViableTownCost + 1,
          },
        },
      };
    });
    const realCreateRegional =
      createRegionalConstructionOpportunityAnalyzer;
    const createRegional = jest.spyOn(
      RegionalConstructionOpportunity,
      'createRegionalConstructionOpportunityAnalyzer',
    ).mockImplementation((...args) => {
      const mineral = args[3];
      const quarry =
        mineral.quarryToCement.proposal.geometry.p0;
      const outward = deriveTrackEndpointOutward(
        mineral.quarryToCement.proposal.geometry,
        'start',
      );
      const excluded = [
        ...args[1].sites,
        quarry,
        mineral.quarryToCement.proposal.geometry.p3,
        mineral.cementToPrefabrication.proposal.geometry.p3,
      ];
      portContexts.push({
        source: quarry,
        analysisCallOffset: analyzeDetailed.mock.calls.length,
      });
      const step = GameConfig.WORLD.SNAP_GRID_SIZE;
      for (
        let x = Math.ceil((quarry.x - REGIONAL_ENDPOINT_MAX_CHORD) / step)
          * step;
        x <= Math.floor((quarry.x + REGIONAL_ENDPOINT_MAX_CHORD) / step)
          * step;
        x += step
      ) {
        for (
          let y = Math.ceil((quarry.y - REGIONAL_ENDPOINT_MAX_CHORD) / step)
            * step;
          y <= Math.floor((quarry.y + REGIONAL_ENDPOINT_MAX_CHORD) / step)
            * step;
          y += step
        ) {
          const dx = x - quarry.x;
          const dy = y - quarry.y;
          const chord = Math.hypot(dx, dy);
          if (chord < REGIONAL_ENDPOINT_MIN_CHORD
            || chord > REGIONAL_ENDPOINT_MAX_CHORD
            || dx * outward.x + dy * outward.y < 0
            || Math.abs(x) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
              > WorldGenerationConfig.WORLD_HALF_WIDTH
            || Math.abs(y) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
              > WorldGenerationConfig.WORLD_HALF_HEIGHT
            || excluded.some((position) => Math.hypot(
              x - position.x,
              y - position.y,
            ) < WorldGenerationConfig.MIN_FACILITY_SEPARATION)) {
            continue;
          }
          const radius = WorldGenerationConfig.SITE_FOOTPRINT_RADIUS;
          for (const sampleX of [x - radius, x, x + radius]) {
            for (const sampleY of [y - radius, y, y + radius]) {
              forbiddenPortReliefSamples.add(`${sampleX}:${sampleY}`);
            }
          }
        }
      }
      return realCreateRegional(...args);
    });
    const realCreateCement =
      CementSupplyOpportunity.createCementSupplyOpportunityAnalyzer;
    let mineralWitnessProduced = false;
    const createCement = jest.spyOn(
      CementSupplyOpportunity,
      'createCementSupplyOpportunityAnalyzer',
    ).mockImplementation((...args) => {
      const analyze = realCreateCement(...args);
      if (!analyze) return null;
      return (sites) => {
        if (mineralWitnessProduced) return null;
        const witness = analyze(sites);
        if (witness) mineralWitnessProduced = true;
        return witness;
      };
    });

    const result = new WorldEconomyGenerator(guardedTerrain).generate(
      config,
      opportunity,
    );
    const portExactCalls = analyzeDetailed.mock.calls.filter(
      ([geometry], index) => portContexts.some((context) => (
        index >= context.analysisCallOffset
          && geometry.p0.x === context.source.x
          && geometry.p0.y === context.source.y
      )),
    );
    createCement.mockRestore();
    createRegional.mockRestore();
    analyzeDetailed.mockRestore();

    expect(result.ok).toBe(false);
    expect(portContexts).toHaveLength(1);
    expect(portReliefCalls).toBe(0);
    expect(portExactCalls).toHaveLength(0);
  });

  it('places bounded Port and Town extensions and publishes exact replay diagnostics', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const result = generate(config, opportunity);

    expectRegionalConstructionSupply(result, opportunity);
  });

  it('derives outer sites from the first 48 physical endpoint-lattice sites', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const result = generate(config, opportunity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facility = (id: string) => result.economy.facilities.find(
      (candidate) => candidate.id === id,
    )!;
    const analyzer = new ConstructionAnalyzer(terrain);
    const prefabWitness = analyzePrefabricationExtension(
      analyzer,
      resolvePrefabricationExtensionStart(opportunity)!,
      facility('prefabrication-plant').railAccess,
    )!;
    const cementWitness = analyzeCementSupplyOpportunity(
      analyzer,
      opportunity,
      prefabWitness,
      {
        quarry: facility('quarry').railAccess,
        cementWorks: facility('cement-works').railAccess,
        prefabricationPlant: facility('prefabrication-plant').railAccess,
      },
    )!;
    const starter = [...opportunity.corridors].sort(
      (left, right) => left.estimatedCost - right.estimatedCost
        || left.id.localeCompare(right.id),
    )[0];
    const cases = [
      {
        source: facility('quarry'),
        target: facility('port-interchange'),
        outward: deriveTrackEndpointOutward(
          cementWitness.quarryToCement.proposal.geometry,
          'start',
        ),
      },
      {
        source: facility('managed-forest'),
        target: facility('town-construction-market'),
        outward: deriveTrackEndpointOutward(
          starter.feasibilityWitness.segments[0].geometry,
          'start',
        ),
      },
    ];
    const accepted = [
      facility('managed-forest'),
      facility('sawmill'),
      facility('quarry'),
      facility('cement-works'),
      facility('prefabrication-plant'),
    ];
    for (const value of cases) {
      const step = GameConfig.WORLD.SNAP_GRID_SIZE;
      const physical: Array<{ x: number; y: number; chord: number }> = [];
      for (
        let x = Math.ceil((value.source.x - 2_048) / step) * step;
        x <= Math.floor((value.source.x + 2_048) / step) * step;
        x += step
      ) {
        for (
          let y = Math.ceil((value.source.y - 2_048) / step) * step;
          y <= Math.floor((value.source.y + 2_048) / step) * step;
          y += step
        ) {
          const dx = x - value.source.x;
          const dy = y - value.source.y;
          const chord = Math.hypot(dx, dy);
          if (chord < 1_024
            || chord > 2_048
            || dx * value.outward.x + dy * value.outward.y < 0
            || Math.abs(x) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
              > WorldGenerationConfig.WORLD_HALF_WIDTH
            || Math.abs(y) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
              > WorldGenerationConfig.WORLD_HALF_HEIGHT
            || accepted.some((position) => Math.hypot(
              x - position.x,
              y - position.y,
            ) < WorldGenerationConfig.MIN_FACILITY_SEPARATION)
            || reliefAt(x, y) > WorldGenerationConfig.MAX_SITE_RELIEF) {
            continue;
          }
          physical.push({ x, y, chord });
        }
      }
      physical.sort((left, right) => left.chord - right.chord
        || left.x - right.x || left.y - right.y);
      const analyzedLattice = new Set(
        physical.slice(0, 48).map(({ x, y }) => `${x}:${y}`),
      );
      expect(analyzedLattice.has(`${value.target.x}:${value.target.y}`))
        .toBe(true);
    }
  });

  it('does not sample a 49th viable Town lattice footprint', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const getHeightAt = jest.spyOn(terrain, 'getHeightAt');
    const result = generate(config, opportunity);
    const sampledKeys = getHeightAt.mock.calls.map(
      ([x, y]) => `${x}:${y}`,
    );
    getHeightAt.mockRestore();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facility = (id: string) => result.economy.facilities.find(
      (candidate) => candidate.id === id,
    )!;
    const source = opportunity.sites[0];
    const starter = [...opportunity.corridors].sort(
      (left, right) => left.estimatedCost - right.estimatedCost
        || left.id.localeCompare(right.id),
    )[0];
    const outward = deriveTrackEndpointOutward(
      starter.feasibilityWitness.segments[0].geometry,
      'start',
    );
    const excluded = [
      ...opportunity.sites,
      facility('quarry'),
      facility('cement-works'),
      facility('prefabrication-plant'),
    ];
    const step = GameConfig.WORLD.SNAP_GRID_SIZE;
    const viable: Array<{ x: number; y: number; chord: number }> = [];
    const minX = Math.ceil((source.x - 2_048) / step) * step;
    const maxX = Math.floor((source.x + 2_048) / step) * step;
    const minY = Math.ceil((source.y - 2_048) / step) * step;
    const maxY = Math.floor((source.y + 2_048) / step) * step;
    for (let x = minX; x <= maxX; x += step) {
      for (let y = minY; y <= maxY; y += step) {
        const dx = x - source.x;
        const dy = y - source.y;
        const chord = Math.hypot(dx, dy);
        const candidate = { x, y };
        if (chord < 1_024
          || chord > 2_048
          || dx * outward.x + dy * outward.y < 0
          || Math.abs(candidate.x) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
            > WorldGenerationConfig.WORLD_HALF_WIDTH
          || Math.abs(candidate.y) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
            > WorldGenerationConfig.WORLD_HALF_HEIGHT
          || excluded.some((position) => Math.hypot(
            candidate.x - position.x,
            candidate.y - position.y,
          ) < WorldGenerationConfig.MIN_FACILITY_SEPARATION)
          || reliefAt(candidate.x, candidate.y)
            > WorldGenerationConfig.MAX_SITE_RELIEF) {
          continue;
        }
        viable.push({ ...candidate, chord });
      }
    }
    viable.sort((left, right) => left.chord - right.chord
      || left.x - right.x || left.y - right.y);
    expect(viable.length).toBeGreaterThan(48);
    const distant = viable[48];
    const radius = WorldGenerationConfig.SITE_FOOTPRINT_RADIUS;
    const distantSamples = new Set(
      [-radius, 0, radius].flatMap((dx) => (
        [-radius, 0, radius].map(
          (dy) => `${distant.x + dx}:${distant.y + dy}`,
        )
      )),
    );
    expect(sampledKeys.filter((key) => distantSamples.has(key))).toHaveLength(0);
  });

  it('preserves the absolute endpoint lattice for a non-grid source', () => {
    const source = { x: 17, y: 23 };
    const step = GameConfig.WORLD.SNAP_GRID_SIZE;
    const expected: Array<{
      x: number;
      y: number;
      dx: number;
      dy: number;
      chord: number;
    }> = [];
    for (
      let x = Math.ceil((source.x - REGIONAL_ENDPOINT_MAX_CHORD) / step)
        * step;
      x <= Math.floor((source.x + REGIONAL_ENDPOINT_MAX_CHORD) / step)
        * step;
      x += step
    ) {
      for (
        let y = Math.ceil((source.y - REGIONAL_ENDPOINT_MAX_CHORD) / step)
          * step;
        y <= Math.floor((source.y + REGIONAL_ENDPOINT_MAX_CHORD) / step)
          * step;
        y += step
      ) {
        const dx = x - source.x;
        const dy = y - source.y;
        const chord = Math.hypot(dx, dy);
        if (chord >= REGIONAL_ENDPOINT_MIN_CHORD
          && chord <= REGIONAL_ENDPOINT_MAX_CHORD) {
          expected.push({
            x,
            y,
            dx,
            dy,
            chord,
          });
        }
      }
    }
    expected.sort((left, right) => left.chord - right.chord
      || left.x - right.x || left.y - right.y);

    expect(buildRegionalEndpointOffsets(source)).toEqual(expected);
    expect(expected.every(({ x, y }) => x % step === 0 && y % step === 0))
      .toBe(true);
  });

  it('caps exact regional leg preanalysis at 48 sites per endpoint', () => {
    const realCreate = createRegionalConstructionOpportunityAnalyzer;
    const realAnalyzeDetailed =
      ConstructionAnalyzer.prototype.analyzeDetailed;
    let sources: Array<{ x: number; y: number }> = [];
    const analyzedEndpoints: Array<{
      source: string;
      target: string;
    }> = [];
    const analyzeDetailed = jest.spyOn(
      ConstructionAnalyzer.prototype,
      'analyzeDetailed',
    ).mockImplementation(function recordRegionalLeg(
      geometry,
      options,
    ) {
      if (sources.some((source) => (
        geometry.p0.x === source.x && geometry.p0.y === source.y
      ))) {
        analyzedEndpoints.push({
          source: `${geometry.p0.x}:${geometry.p0.y}`,
          target: `${geometry.p3.x}:${geometry.p3.y}`,
        });
      }
      return realAnalyzeDetailed.call(this, geometry, options);
    });
    const createRegional = jest.spyOn(
      RegionalConstructionOpportunity,
      'createRegionalConstructionOpportunityAnalyzer',
    ).mockImplementation((...args) => {
      const analyze = realCreate(...args);
      if (analyze) {
        sources = [
          args[3].quarryToCement.proposal.geometry.p0,
          args[1].sites[0],
        ];
      }
      return analyze;
    });

    const result = generate();

    createRegional.mockRestore();
    analyzeDetailed.mockRestore();
    expect(result.ok).toBe(true);
    const counts = sources.map((source) => new Set(
      analyzedEndpoints.filter(
        ({ source: key }) => key === `${source.x}:${source.y}`,
      ).map(({ target }) => target),
    ).size);
    expect(counts).toEqual([48, 48]);
  });

  it('screens invalid or over-budget legs before they consume a regional pair call', () => {
    const realCreate = createRegionalConstructionOpportunityAnalyzer;
    const analyzed: Array<{
      sites: {
        portInterchange: { x: number; y: number };
        townConstructionMarket: { x: number; y: number };
      };
      opportunity: StarterOpportunityDef;
      quarry: { x: number; y: number };
      quarryOutward: { x: number; y: number };
      forest: { x: number; y: number };
      forestOutward: { x: number; y: number };
    }> = [];
    const createRegional = jest.spyOn(
      RegionalConstructionOpportunity,
      'createRegionalConstructionOpportunityAnalyzer',
    ).mockImplementation((...args) => {
      const analyze = realCreate(...args);
      if (!analyze) return null;
      const selectedStarter = [...args[1].corridors].sort(
        (left, right) => left.estimatedCost - right.estimatedCost
          || left.id.localeCompare(right.id),
      )[0];
      return (sites) => {
        analyzed.push({
          sites: JSON.parse(JSON.stringify(sites)),
          opportunity: args[1],
          quarry: args[3].quarryToCement.proposal.geometry.p0,
          quarryOutward: deriveTrackEndpointOutward(
            args[3].quarryToCement.proposal.geometry,
            'start',
          ),
          forest: args[1].sites[0],
          forestOutward: deriveTrackEndpointOutward(
            selectedStarter.feasibilityWitness.segments[0].geometry,
            'start',
          ),
        });
        return analyze(sites);
      };
    });
    const generationConfig = config;
    const opportunity = makeStarterOpportunity(generationConfig.seed);

    const result = generate(generationConfig, opportunity);

    createRegional.mockRestore();
    expect(result.ok).toBe(true);
    expect(analyzed.length).toBeGreaterThan(0);
    for (const attempt of analyzed) {
      const analyzer = new ConstructionAnalyzer(terrain);
      const port = analyzer.analyzeDetailed(deriveAutomaticCubic({
        start: attempt.quarry,
        end: attempt.sites.portInterchange,
        startOutward: attempt.quarryOutward,
      })).proposal;
      const town = analyzer.analyzeDetailed(deriveAutomaticCubic({
        start: attempt.forest,
        end: attempt.sites.townConstructionMarket,
        startOutward: attempt.forestOutward,
      })).proposal;

      expect(port.valid).toBe(true);
      expect(town.valid).toBe(true);
      expect(port.costs.total + town.costs.total + 5_000)
        .toBeLessThanOrEqual(MAX_REGIONAL_CONSTRUCTION_LINK_COST);
    }
  });

  it('orders regional pairs by endpoint chord and reuses prior analyses', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const realCreate = createRegionalConstructionOpportunityAnalyzer;
    const realAnalyzeDetailed =
      ConstructionAnalyzer.prototype.analyzeDetailed;
    const analyzedSites: Array<{
      portInterchange: { x: number; y: number };
      townConstructionMarket: { x: number; y: number };
      lowerBound: number;
    }> = [];
    const productionAnalysisKeys: string[] = [];
    const analyzeDetailed = jest.spyOn(
      ConstructionAnalyzer.prototype,
      'analyzeDetailed',
    ).mockImplementation(function recordProductionAnalysis(
      geometry,
      options,
    ) {
      productionAnalysisKeys.push(JSON.stringify([geometry, options ?? {}]));
      return realAnalyzeDetailed.call(this, geometry, options);
    });
    const createRegional = jest.spyOn(
      RegionalConstructionOpportunity,
      'createRegionalConstructionOpportunityAnalyzer',
    ).mockImplementation((...args) => {
      const analyze = realCreate(...args);
      if (!analyze) return null;
      return (sites) => {
        const quarry = args[3].quarryToCement.proposal.geometry.p0;
        const forest = args[1].sites[0];
        analyzedSites.push({
          ...JSON.parse(JSON.stringify(sites)),
          lowerBound: Math.hypot(
            sites.portInterchange.x - quarry.x,
            sites.portInterchange.y - quarry.y,
          ) + Math.hypot(
            sites.townConstructionMarket.x - forest.x,
            sites.townConstructionMarket.y - forest.y,
          ),
        });
        return analyze(sites);
      };
    });
    const result = generate(config, opportunity);

    createRegional.mockRestore();
    analyzeDetailed.mockRestore();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(analyzedSites.length).toBeGreaterThanOrEqual(1);
    const facility = (id: string) => result.economy.facilities.find(
      (candidate) => candidate.id === id,
    )!;
    const lowerBounds = analyzedSites.map(({ lowerBound }) => lowerBound);
    expect(lowerBounds).toEqual([...lowerBounds].sort(
      (left, right) => left - right,
    ));
    expect(facility('port-interchange').railAccess).toEqual(
      expect.objectContaining(analyzedSites.at(-1)!.portInterchange),
    );
    expect(facility('town-construction-market').railAccess).toEqual(
      expect.objectContaining(
        analyzedSites.at(-1)!.townConstructionMarket,
      ),
    );
    expect(new Set(productionAnalysisKeys).size)
      .toBe(productionAnalysisKeys.length);
    expect((result.diagnostics as any).regionalPairAnalyses)
      .toBe(analyzedSites.length);
  });

  it('fails closed after exactly 32 rejected regional pairs', () => {
    const realCreate = createRegionalConstructionOpportunityAnalyzer;
    const createRegional = jest.spyOn(
      RegionalConstructionOpportunity,
      'createRegionalConstructionOpportunityAnalyzer',
    ).mockImplementation((...args) => (
      realCreate(...args) ? () => null : null
    ));

    const result = generate();

    createRegional.mockRestore();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: config.seed,
        candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
        prefabAnalyses: expect.any(Number),
        mineralPairAnalyses: expect.any(Number),
        regionalPairAnalyses: MAX_REGIONAL_PAIR_ANALYSES,
        facilitiesPlaced: 3,
      },
    });
    expect('economy' in result).toBe(false);
  });

  it('offers a new mineral context before draining an earlier regional cursor', () => {
    const realCreate = createRegionalConstructionOpportunityAnalyzer;
    let contextsCreated = 0;
    const analyzedContextOrdinals: number[] = [];
    const createRegional = jest.spyOn(
      RegionalConstructionOpportunity,
      'createRegionalConstructionOpportunityAnalyzer',
    ).mockImplementation((...args) => {
      const analyze = realCreate(...args);
      if (!analyze) return null;
      const contextOrdinal = contextsCreated;
      contextsCreated += 1;
      return (...analysisArgs) => {
        analyzedContextOrdinals.push(contextOrdinal);
        return contextOrdinal === 0 ? null : analyze(...analysisArgs);
      };
    });

    const result = generate();

    createRegional.mockRestore();
    expect(result.ok).toBe(true);
    expect(contextsCreated).toBeGreaterThan(1);
    expect(analyzedContextOrdinals.slice(0, 2)).toEqual([0, 1]);
    expect(analyzedContextOrdinals.at(-1)).toBeGreaterThan(0);
    if (!result.ok) return;
    expect(result.diagnostics.regionalPairAnalyses)
      .toBe(analyzedContextOrdinals.length);
    expect(result.diagnostics.regionalPairAnalyses)
      .toBeLessThanOrEqual(MAX_REGIONAL_PAIR_ANALYSES);
  });

  it('alternates new mineral contexts with queued regional cursors', () => {
    const realCreate = createRegionalConstructionOpportunityAnalyzer;
    let contextsCreated = 0;
    const analyzedContextOrdinals: number[] = [];
    const createRegional = jest.spyOn(
      RegionalConstructionOpportunity,
      'createRegionalConstructionOpportunityAnalyzer',
    ).mockImplementation((...args) => {
      const analyze = realCreate(...args);
      if (!analyze) return null;
      const contextOrdinal = contextsCreated;
      contextsCreated += 1;
      return () => {
        analyzedContextOrdinals.push(contextOrdinal);
        return null;
      };
    });

    const result = generate();

    createRegional.mockRestore();
    expect(result.ok).toBe(false);
    expect(contextsCreated).toBeGreaterThan(2);
    expect(analyzedContextOrdinals.slice(0, 5)).toEqual([0, 1, 0, 2, 1]);
    if (result.ok !== false) return;
    expect(result.error.regionalPairAnalyses)
      .toBe(analyzedContextOrdinals.length);
    expect(result.error.regionalPairAnalyses)
      .toBe(MAX_REGIONAL_PAIR_ANALYSES);
  });

  it('never exceeds the exact mineral-analysis cap while regional screening continues', () => {
    const realCreate = createRegionalConstructionOpportunityAnalyzer;
    const createRegional = jest.spyOn(
      RegionalConstructionOpportunity,
      'createRegionalConstructionOpportunityAnalyzer',
    ).mockImplementation((...args) => (
      realCreate(...args) ? null : null
    ));
    const generationConfig = { ...config, seed: 'economy-beta' };
    const result = generate(
      generationConfig,
      makeStarterOpportunity(generationConfig.seed),
    );

    createRegional.mockRestore();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: generationConfig.seed,
        candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
        prefabAnalyses: expect.any(Number),
        mineralPairAnalyses: MAX_CEMENT_SUPPLY_PAIR_ANALYSES,
        regionalPairAnalyses: 0,
        facilitiesPlaced: 3,
      },
    });
  });

  it('keeps a separately named 25-seed prefab affordability sweep deterministic and bounded', () => {
    const seeds = Array.from(
      { length: 25 },
      (_, index) => `prefab-affordability-sweep-${index + 1}`,
    );

    for (const seed of seeds) {
      const generationConfig = { ...config, seed };
      const opportunity = makeStarterOpportunity(seed);
      const first = generate(generationConfig, opportunity);
      const replay = generate(generationConfig, opportunity);

      expect(replay).toEqual(first);
      if (first.ok === false) {
        expect(first.error.regionalPairAnalyses)
          .toBeLessThanOrEqual(MAX_REGIONAL_PAIR_ANALYSES);
        expect(first.error.facilitiesPlaced).toBeLessThan(5);
        continue;
      }
      const firstWitnessCost = expectAffordablePrefab(first, opportunity);
      const replayWitnessCost = expectAffordablePrefab(replay, opportunity);
      expect(replayWitnessCost).toBe(firstWitnessCost);
      expect(first.diagnostics.candidatesEvaluated)
        .toBeLessThanOrEqual(MAX_ECONOMY_SITE_CANDIDATES);
      for (const facility of first.economy.facilities.slice(2)) {
        expect(canonicalizeConstructionGridPoint(
          facility.x,
          facility.y,
          GameConfig.WORLD.SNAP_GRID_SIZE,
        )).toEqual({
          x: facility.x,
          y: facility.y,
          snapped: Number.isInteger(
            facility.x / GameConfig.WORLD.SNAP_GRID_SIZE,
          ) && Number.isInteger(
            facility.y / GameConfig.WORLD.SNAP_GRID_SIZE,
          ),
        });
      }
    }
  });

  it('independently rejects an otherwise valid generated economy with an unaffordable Prefab', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const result = generate(config, opportunity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hostile = JSON.parse(JSON.stringify(result.economy));
    const prefab = hostile.facilities.find(
      ({ id }: { id: string }) => id === 'prefabrication-plant',
    );
    prefab.x = 7_000;
    prefab.y = 7_000;
    prefab.railAccess.x = 7_000;
    prefab.railAccess.y = 7_000;

    expect(validateGeneratedEconomy(hostile, opportunity, terrain)).toBe(false);
  });

  it('replays mineral clearance and rejects position tampering that remains schema-valid', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const result = generate(config, opportunity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hostile = JSON.parse(JSON.stringify(result.economy));
    const quarry = hostile.facilities.find(
      ({ id }: { id: string }) => id === 'quarry',
    );
    const port = hostile.facilities.find(
      ({ id }: { id: string }) => id === 'port-interchange',
    );
    const quarryPosition = { x: quarry.x, y: quarry.y };
    quarry.x = port.x;
    quarry.y = port.y;
    quarry.railAccess.x = port.x;
    quarry.railAccess.y = port.y;
    port.x = quarryPosition.x;
    port.y = quarryPosition.y;
    port.railAccess.x = quarryPosition.x;
    port.railAccess.y = quarryPosition.y;

    expect(validateGeneratedEconomy(hostile, opportunity, terrain)).toBe(false);
  });

  it.each([
    ['moved Port', (hostile: any) => {
      const port = hostile.facilities.find(
        ({ id }: { id: string }) => id === 'port-interchange',
      );
      port.x = 7_600;
      port.y = -7_600;
      port.railAccess.x = port.x;
      port.railAccess.y = port.y;
    }],
    ['swapped Port and Town', (hostile: any) => {
      const port = hostile.facilities.find(
        ({ id }: { id: string }) => id === 'port-interchange',
      );
      const town = hostile.facilities.find(
        ({ id }: { id: string }) => id === 'town-construction-market',
      );
      const portPosition = { x: port.x, y: port.y };
      port.x = town.x;
      port.y = town.y;
      port.railAccess.x = town.x;
      port.railAccess.y = town.y;
      town.x = portPosition.x;
      town.y = portPosition.y;
      town.railAccess.x = portPosition.x;
      town.railAccess.y = portPosition.y;
    }],
    ['crossing Town', (hostile: any, opportunity: StarterOpportunityDef) => {
      const town = hostile.facilities.find(
        ({ id }: { id: string }) => id === 'town-construction-market',
      );
      town.x = (opportunity.sites[0].x + opportunity.sites[1].x) / 2;
      town.y = (opportunity.sites[0].y + opportunity.sites[1].y) / 2;
      town.railAccess.x = town.x;
      town.railAccess.y = town.y;
    }],
    ['forged Port access', (hostile: any) => {
      const port = hostile.facilities.find(
        ({ id }: { id: string }) => id === 'port-interchange',
      );
      port.railAccess.radius += 1;
    }],
  ])('independently rejects a schema-valid economy with a %s site', (
    _label,
    mutate,
  ) => {
    const opportunity = makeStarterOpportunity(config.seed);
    const result = generate(config, opportunity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateGeneratedEconomy(
      result.economy,
      opportunity,
      terrain,
    )).toBe(true);
    const hostile = JSON.parse(JSON.stringify(result.economy));
    mutate(hostile, opportunity);

    expect(validateGeneratedEconomy(hostile, opportunity, terrain)).toBe(false);
  });

  it('keeps every regional demand factor bounded and varies generated state by seed', () => {
    const first = generate(config);
    const differentConfig = { ...config, seed: 'playtest-602' };
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
    expect(different.economy.facilities.slice(2).map(
      ({ id, x, y }) => ({ id, x, y }),
    )).not.toEqual(first.economy.facilities.slice(2).map(
      ({ id, x, y }) => ({ id, x, y }),
    ));
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
        prefabAnalyses: 0,
        mineralPairAnalyses: 0,
        regionalPairAnalyses: 0,
        facilitiesPlaced: 0,
      },
    });
    expect('economy' in result).toBe(false);
  });

  it('fails closed before candidate evaluation when the Sawmill site is absent', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    (opportunity as any).sites = [opportunity.sites[0]];

    expect(new WorldEconomyGenerator(terrain).generate(
      config,
      opportunity,
    )).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: config.seed,
        candidatesEvaluated: 0,
        prefabAnalyses: 0,
        mineralPairAnalyses: 0,
        regionalPairAnalyses: 0,
        facilitiesPlaced: 0,
      },
    });
  });

  it('does not accept a lone Prefab before the mineral pair resolves', () => {
    const plateauTerrain = {
      getHeightAt(x: number, y: number): number {
        if (x >= -7_200 && x <= -5_500 && y >= -7_300 && y <= -6_700) {
          return 0;
        }
        return x;
      },
    };
    const opportunity = makeStarterOpportunity(config.seed);
    opportunity.sites[0].x = -4_800;
    opportunity.sites[0].y = -6_950;
    opportunity.sites[1].x = -5_800;
    opportunity.sites[1].y = -6_950;
    for (const corridor of opportunity.corridors) {
      corridor.waypoints[corridor.waypoints.length - 1] = {
        x: -5_800,
        y: -6_950,
      };
      const terminal = corridor.feasibilityWitness.segments[
        corridor.feasibilityWitness.segments.length - 1
      ].geometry;
      terminal.p2 = { x: -5_400, y: -6_950 };
      terminal.p3 = { x: -5_800, y: -6_950 };
    }

    const result = new WorldEconomyGenerator(plateauTerrain).generate(
      config,
      opportunity,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: config.seed,
        candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
        prefabAnalyses: 0,
        mineralPairAnalyses: 0,
        regionalPairAnalyses: 0,
        facilitiesPlaced: 0,
      },
    });
    expect('economy' in result).toBe(false);
  });

  it('rejects an impossible Prefab endpoint grade before exact analysis', () => {
    const opportunity = makeStarterOpportunity(config.seed);
    const extensionStart = resolvePrefabricationExtensionStart(opportunity)!;
    const impossibleGradeTerrain = {
      getHeightAt(x: number, y: number): number {
        if (x === extensionStart.point.x && y === extensionStart.point.y) {
          return terrain.getHeightAt(x, y) + 1_000_000;
        }
        return terrain.getHeightAt(x, y);
      },
    };

    const result = new WorldEconomyGenerator(impossibleGradeTerrain).generate(
      config,
      opportunity,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: config.seed,
        candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
        prefabAnalyses: 0,
        mineralPairAnalyses: 0,
        regionalPairAnalyses: 0,
        facilitiesPlaced: 0,
      },
    });
  });

  it('fails closed without market state when regional replay rejects another terrain', () => {
    const flatTerrain = { getHeightAt: () => 0 };
    const flatResult = new WorldEconomyGenerator(flatTerrain).generate(
      config,
      makeStarterOpportunity(config.seed),
    );
    const variedResult = generate();

    expect(flatResult).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: config.seed,
        candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
        prefabAnalyses: expect.any(Number),
        mineralPairAnalyses: expect.any(Number),
        regionalPairAnalyses: 0,
        facilitiesPlaced: 3,
      },
    });
    expect(variedResult.ok).toBe(true);
    expect('economy' in flatResult).toBe(false);
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
          prefabAnalyses: 0,
          mineralPairAnalyses: 0,
          regionalPairAnalyses: 0,
          facilitiesPlaced: 0,
      },
    });
  });
});
