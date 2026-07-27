/**
 * @jest-environment jsdom
 */
import {
  ENDPOINT_CONNECTION_COST,
  STANDARD_STARTING_CASH,
} from '../../src/config/ConstructionConfig';
import type { WorldGenerationConfigDef } from '../../src/config/WorldData';
import {
  type EconomyGeneratorPort,
  type OpportunityGeneratorPort,
  WorldManager,
} from '../../src/managers/WorldManager';
import { SaveService } from '../../src/services/SaveService';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { applyConstructionTransaction } from '../../src/systems/ConstructionEconomy';
import {
  WorldOpportunityGenerator,
  type OpportunityGenerationResult,
} from '../../src/systems/WorldOpportunityGenerator';
import { GameConfig } from '../../src/config/GameConfig';
import type { StarterOpportunityDef } from '../../src/config/WorldData';
import {
  OPPORTUNITY_CAMERA_PADDING,
  WorldGenerationConfig,
} from '../../src/config/WorldGeneration';
import {
  type EconomyGenerationResult,
  WorldEconomyGenerator,
} from '../../src/economy/WorldEconomyGenerator';
import {
  STARTER_ROUTE_RESERVE,
  FLATBED_TRAIN_PURCHASE_PRICE,
} from '../../src/freight/FreightSetCatalog';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { deriveAutomaticCubic } from '../../src/systems/TrackGeometry';
import {
  analyzePrefabricationExtension,
} from '../../src/economy/PrefabricationOpportunity';
import {
  PREFAB_ACCESS_LINK_ALLOWANCE,
  PREFAB_EXTENSION_OPERATING_RESERVE,
  REGIONAL_DEVELOPMENT_GRANT,
} from '../../src/config/FreightProgression';

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

function findSchemaValidUnaffordablePrefabPosition(
  terrain: TerrainGenerator,
  economy: Extract<EconomyGenerationResult, { ok: true }>['economy'],
): { x: number; y: number } {
  const sawmill = economy.facilities.find(({ id }) => id === 'sawmill')!;
  const otherFacilities = economy.facilities.filter(
    ({ id }) => id !== 'prefabrication-plant',
  );
  const analyzer = new ConstructionAnalyzer(terrain);
  const radius = WorldGenerationConfig.SITE_FOOTPRINT_RADIUS;
  for (let y = -7_500; y <= 7_500; y += 250) {
    for (let x = -7_500; x <= 7_500; x += 250) {
      if (otherFacilities.some((facility) => Math.hypot(
        x - facility.x,
        y - facility.y,
      ) < WorldGenerationConfig.MIN_FACILITY_SEPARATION)) {
        continue;
      }
      const heights = [-radius, 0, radius].flatMap((dx) => (
        [-radius, 0, radius].map((dy) => terrain.getHeightAt(x + dx, y + dy))
      ));
      if (Math.max(...heights) - Math.min(...heights)
        > WorldGenerationConfig.MAX_SITE_RELIEF) {
        continue;
      }
      const proposal = analyzer.analyze(deriveAutomaticCubic({
        start: sawmill.railAccess,
        end: { x, y },
      }));
      if (proposal.valid
        && proposal.costs.total + ENDPOINT_CONNECTION_COST > 194_000) {
        return { x, y };
      }
    }
  }
  throw new Error('test fixture could not find an unaffordable valid Prefab site');
}

function successfulResult(
  seed = 'fixture-seed',
): Extract<OpportunityGenerationResult, { ok: true }> {
  const config: WorldGenerationConfigDef = {
    generationConfigVersion: 1,
    seed,
    biome: 'temperate',
    constructionDifficultyId: 'standard',
  };
  const result = new WorldOpportunityGenerator(
    new TerrainGenerator(seed),
  ).generate(config);
  if (!result.ok) throw new Error('opportunity fixture generation failed');
  return result;
}

function successfulPort(): OpportunityGeneratorPort & {
  generate: jest.Mock<OpportunityGenerationResult, [WorldGenerationConfigDef]>;
} {
  return {
    generate: jest.fn().mockImplementation(
      (config: WorldGenerationConfigDef) => successfulResult(config.seed),
    ),
  };
}

function successfulEconomyResult(
  seed = 'fixture-seed',
): Extract<EconomyGenerationResult, { ok: true }> {
  const config: WorldGenerationConfigDef = {
    generationConfigVersion: 1,
    seed,
    biome: 'temperate',
    constructionDifficultyId: 'standard',
  };
  const result = new WorldEconomyGenerator(
    new TerrainGenerator(seed),
  ).generate(
    config,
    successfulResult(seed).opportunity,
  );
  if (!result.ok) throw new Error('economy fixture generation failed');
  return result;
}

function successfulEconomyPort(): EconomyGeneratorPort & {
  generate: jest.Mock<
    EconomyGenerationResult,
    [WorldGenerationConfigDef, StarterOpportunityDef]
  >;
} {
  return {
    generate: jest.fn().mockImplementation((
      config: WorldGenerationConfigDef,
      opportunity: StarterOpportunityDef,
    ) => new WorldEconomyGenerator(
      new TerrainGenerator(config.seed),
    ).generate(config, opportunity)),
  };
}

function economyPortWith(
  mutate: (
    result: Extract<EconomyGenerationResult, { ok: true }>,
  ) => void,
): EconomyGeneratorPort {
  return {
    generate: jest.fn().mockImplementation((
      config: WorldGenerationConfigDef,
      opportunity: StarterOpportunityDef,
    ) => {
      const generated = new WorldEconomyGenerator(
        new TerrainGenerator(config.seed),
      ).generate(config, opportunity);
      if (!generated.ok) throw new Error('economy fixture generation failed');
      const result = JSON.parse(JSON.stringify(
        generated,
      )) as Extract<EconomyGenerationResult, { ok: true }>;
      mutate(result);
      return result;
    }),
  };
}

function spendCompanyCashTo(targetCash: number): void {
  const world = WorldManager.world!;
  expect(WorldManager.applyConstructionBatch(
    world.constructionRevision,
    (draft) => {
      const transaction = applyConstructionTransaction(draft.company, {
        kind: 'purchase',
        magnitude: draft.company.cash - targetCash,
        referenceId: `test-cash-${targetCash}`,
        direction: 'forward',
      }, draft.economyTick);
      if (!transaction.ok) return false;
      draft.company = transaction.company;
      return true;
    },
  )).toBe(true);
}

const TASK_7_JOINT_GENERATION_SWEEP_SEEDS = [
  'economy-alpha',
  'economy-beta',
  'real-terrain-alpha',
  'real-terrain-beta',
  'playtest-753',
  'economy-accumulator',
  'replacement-economy-failed',
  'economy-tick-catchup',
  ...Array.from(
    { length: 25 },
    (_, index) => `neutral-generator-audit-${String(index).padStart(3, '0')}`,
  ),
];

describe('generated blank-world start', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
    jest.restoreAllMocks();
  });

  it('persists a schema-8 opportunity before installing an otherwise blank world', () => {
    const generator = successfulPort();
    const economyGenerator = successfulEconomyPort();
    const saveSpy = jest.spyOn(SaveService, 'saveWorld');
    const result = WorldManager.tryCreateNew(
      'Generated',
      'atomic-seed',
      'alpine',
      generator,
      economyGenerator,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generator.generate).toHaveBeenCalledWith({
      generationConfigVersion: 1,
      seed: 'atomic-seed',
      biome: 'alpine',
      constructionDifficultyId: 'standard',
    });
    expect(economyGenerator.generate).toHaveBeenCalledWith(
      {
        generationConfigVersion: 1,
        seed: 'atomic-seed',
        biome: 'alpine',
        constructionDifficultyId: 'standard',
      },
      successfulResult('atomic-seed').opportunity,
    );
    expect(result.world.schemaVersion).toBe(8);
    expect(result.world.revision).toBe(0);
    expect(result.world.company.cash).toBe(STANDARD_STARTING_CASH);
    expect(result.world.starterOpportunity).toEqual(
      successfulResult('atomic-seed').opportunity,
    );
    expect(result.world.economy)
      .toEqual(successfulEconomyResult('atomic-seed').economy);
    const detour = result.world.starterOpportunity.corridors.find(
      (corridor) => corridor.dominantTradeoff === 'long-flat',
    )!;
    expect(detour.feasibilityWitness.segments.map(
      (segment) => segment.topologyCost,
    )).toEqual([0, ENDPOINT_CONNECTION_COST]);
    expect(detour.estimatedCost).toBe(detour.feasibilityWitness.segments.reduce(
      (total, segment) => total + segment.costs.total + segment.topologyCost,
      0,
    ));
    expect(result.world.tracks).toEqual([]);
    expect(result.world.junctions).toEqual([]);
    expect(result.world.stations).toEqual([]);
    expect(result.world.trains).toEqual([]);
    expect(result.world).not.toHaveProperty('services');
    expect('scenarios' in result.world).toBe(false);
    const sawmill = result.world.economy.facilities.find(
      ({ id }) => id === 'sawmill',
    )!;
    const prefab = result.world.economy.facilities.find(
      ({ id }) => id === 'prefabrication-plant',
    )!;
    const witness = analyzePrefabricationExtension(
      new ConstructionAnalyzer(new TerrainGenerator('atomic-seed')),
      sawmill.railAccess,
      prefab.railAccess,
    );
    expect(witness).not.toBeNull();
    expect(
      witness!.totalCost
        + PREFAB_ACCESS_LINK_ALLOWANCE
        + PREFAB_EXTENSION_OPERATING_RESERVE,
    ).toBeLessThanOrEqual(REGIONAL_DEVELOPMENT_GRANT);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(WorldManager.world).toBe(result.world);
    expect(SaveService.loadWorld(result.world.id)).toEqual(result.world);
  });

  it('persists no partial world when bounded economy placement exhausts', () => {
    const economyGenerator: EconomyGeneratorPort = {
      generate: jest.fn().mockReturnValue({
        ok: false,
        error: {
          code: 'economy-exhausted',
          seed: 'economy-failed-seed',
          candidatesEvaluated: 256,
          facilitiesPlaced: 2,
        },
      }),
    };
    const saveSpy = jest.spyOn(SaveService, 'saveWorld');

    const result = WorldManager.tryCreateNew(
      'Economy failed',
      'economy-failed-seed',
      'temperate',
      successfulPort(),
      economyGenerator,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'economy-exhausted',
        seed: 'economy-failed-seed',
        candidatesEvaluated: 256,
        facilitiesPlaced: 2,
      },
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(WorldManager.world).toBeNull();
    expect(SaveService.listWorlds()).toEqual([]);
  });

  it('leaves the active world and storage byte-for-byte unchanged on economy exhaustion', () => {
    const prior = WorldManager.tryCreateNew(
      'Prior economy',
      'prior-economy-seed',
      'temperate',
      successfulPort(),
      successfulEconomyPort(),
    );
    expect(prior.ok).toBe(true);
    if (!prior.ok) return;
    const storageBefore = localStorage.getItem(
      GameConfig.WORLD.WORLDS_SAVE_KEY,
    );
    const economyGenerator: EconomyGeneratorPort = {
      generate: jest.fn().mockReturnValue({
        ok: false,
        error: {
          code: 'economy-exhausted',
          seed: 'replacement-economy-failed',
          candidatesEvaluated: 256,
          facilitiesPlaced: 4,
        },
      }),
    };

    const result = WorldManager.tryCreateNew(
      'Failed economy replacement',
      'replacement-economy-failed',
      'alpine',
      successfulPort(),
      economyGenerator,
    );

    expect(result.ok).toBe(false);
    expect(WorldManager.world).toBe(prior.world);
    expect(localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY))
      .toBe(storageBefore);
    expect(SaveService.listWorlds().map((world) => world.id))
      .toEqual([prior.world.id]);
  });

  it('validates the detached generated world before attempting its single save', () => {
    const invalidEconomyGenerator: EconomyGeneratorPort = {
      generate: jest.fn().mockReturnValue({
        ok: true,
        economy: {
          ...successfulEconomyResult().economy,
          facilities: [],
          market: {
            constructionIndexBps: 10_000,
            regionalDemandBpsByProduct: {},
          },
        },
        diagnostics: { candidatesEvaluated: 5 },
      }),
    };
    const saveSpy = jest.spyOn(SaveService, 'saveWorld');

    const result = WorldManager.tryCreateNew(
      'Invalid economy',
      'invalid-economy-seed',
      'temperate',
      successfulPort(),
      invalidEconomyGenerator,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'world-validation-failed',
        seed: 'invalid-economy-seed',
      },
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(WorldManager.world).toBeNull();
    expect(SaveService.listWorlds()).toEqual([]);
  });

  it('atomically rejects a hostile economy port with an unaffordable Prefab site', () => {
    const prior = WorldManager.tryCreateNew(
      'Prior valid world',
      'real-terrain-alpha',
      'temperate',
      successfulPort(),
      successfulEconomyPort(),
    );
    expect(prior.ok).toBe(true);
    if (!prior.ok) return;
    const storageBefore = localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY);
    const seed = 'real-terrain-beta';
    const economyGenerator: EconomyGeneratorPort = {
      generate: jest.fn().mockImplementation((
        generationConfig: WorldGenerationConfigDef,
        opportunity: StarterOpportunityDef,
      ) => {
        const terrain = new TerrainGenerator(generationConfig.seed);
        const generated = new WorldEconomyGenerator(terrain).generate(
          generationConfig,
          opportunity,
        );
        if (!generated.ok) return generated;
        const economy = JSON.parse(JSON.stringify(generated.economy));
        const hostilePosition = findSchemaValidUnaffordablePrefabPosition(
          terrain,
          economy,
        );
        const prefab = economy.facilities.find(
          ({ id }: { id: string }) => id === 'prefabrication-plant',
        );
        prefab.x = hostilePosition.x;
        prefab.y = hostilePosition.y;
        prefab.railAccess.x = hostilePosition.x;
        prefab.railAccess.y = hostilePosition.y;
        return {
          ok: true as const,
          economy,
          diagnostics: generated.diagnostics,
        };
      }),
    };
    const saveSpy = jest.spyOn(SaveService, 'saveWorld');

    const result = WorldManager.tryCreateNew(
      'Hostile replacement',
      seed,
      'temperate',
      successfulPort(),
      economyGenerator,
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'world-validation-failed', seed },
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(WorldManager.world).toBe(prior.world);
    expect(localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY))
      .toBe(storageBefore);
  });

  it.each([
    ['generic opportunity labels', (opportunity: any) => {
      opportunity.sites[0].id = 'site-a';
      opportunity.sites[0].label = 'Planning Site A';
      opportunity.sites[1].id = 'site-b';
      opportunity.sites[1].label = 'Planning Site B';
    }],
    ['an empty sites array', (opportunity: any) => {
      opportunity.sites = [];
    }],
  ])('rejects %s before invoking economy generation', (_label, mutate) => {
    const opportunity = successfulResult().opportunity as any;
    mutate(opportunity);
    const opportunityGenerator = {
      generate: jest.fn().mockReturnValue({
        ok: true,
        opportunity,
        diagnostics: {
          attemptsEvaluated: 1,
          maxSiteCandidatesEvaluated: 256,
        },
      }),
    } as OpportunityGeneratorPort;
    const economyGenerator = successfulEconomyPort();
    const saveSpy = jest.spyOn(SaveService, 'saveWorld');

    const result = WorldManager.tryCreateNew(
      'Invalid opportunity',
      'invalid-opportunity-seed',
      'temperate',
      opportunityGenerator,
      economyGenerator,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'world-validation-failed',
        seed: 'invalid-opportunity-seed',
      },
    });
    expect(economyGenerator.generate).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(WorldManager.world).toBeNull();
  });

  it.each([
    ['an empty facility graph with an otherwise valid market', (result: any) => {
      result.economy.facilities = [];
    }],
    ['a changed stable facility id', (result: any) => {
      result.economy.facilities[2].id = 'renamed-quarry';
    }],
    ['a mismatched facility definition', (result: any) => {
      result.economy.facilities[2].definitionId = 'cement-works';
    }],
    ['a forest away from its opportunity endpoint', (result: any) => {
      result.economy.facilities[0].x += 1;
      result.economy.facilities[0].railAccess.x += 1;
    }],
    ['a sawmill away from its opportunity endpoint', (result: any) => {
      result.economy.facilities[1].y += 1;
      result.economy.facilities[1].railAccess.y += 1;
    }],
    ['non-finite facility geometry', (result: any) => {
      result.economy.facilities[2].x = Number.NaN;
      result.economy.facilities[2].railAccess.x = Number.NaN;
    }],
    ['an off-centre rail access point', (result: any) => {
      result.economy.facilities[2].railAccess.x += 1;
    }],
    ['an unsupported rail access radius', (result: any) => {
      result.economy.facilities[2].railAccess.radius += 1;
    }],
    ['facilities below the configured separation', (result: any) => {
      const quarry = result.economy.facilities[2];
      const cementWorks = result.economy.facilities[3];
      cementWorks.x = quarry.x;
      cementWorks.y = quarry.y;
      cementWorks.railAccess.x = quarry.x;
      cementWorks.railAccess.y = quarry.y;
    }],
    ['invalid initial inventory', (result: any) => {
      result.economy.facilities[0].inventories.logs.quantity = 241;
    }],
    ['invalid generated market state', (result: any) => {
      result.economy.market.regionalDemandBpsByProduct.logs = 12_001;
    }],
  ])('rejects %s before saving or installing', (_label, mutate) => {
    const economyGenerator = economyPortWith(mutate);
    const saveSpy = jest.spyOn(SaveService, 'saveWorld');

    const result = WorldManager.tryCreateNew(
      'Invalid generated graph',
      'invalid-graph-seed',
      'temperate',
      successfulPort(),
      economyGenerator,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'world-validation-failed',
        seed: 'invalid-graph-seed',
      },
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(WorldManager.world).toBeNull();
    expect(SaveService.listWorlds()).toEqual([]);
  });

  it.each([
    ['relabels opportunity sites', (opportunity: any) => {
      opportunity.sites[0].id = 'site-a';
      opportunity.sites[0].label = 'Planning Site A';
      opportunity.sites[1].id = 'site-b';
      opportunity.sites[1].label = 'Planning Site B';
    }],
    ['removes opportunity sites', (opportunity: any) => {
      opportunity.sites = [];
    }],
  ])('rejects an economy port that %s without exposing its mutation', (
    _label,
    mutate,
  ) => {
    const seed = 'mutating-economy-port-seed';
    const sourceResult = successfulResult(seed);
    const sourceOpportunity = sourceResult.opportunity;
    const sourceSnapshot = JSON.parse(JSON.stringify(sourceOpportunity));
    const opportunityGenerator: OpportunityGeneratorPort = {
      generate: jest.fn().mockReturnValue(sourceResult),
    };
    let economyPortOpportunity: StarterOpportunityDef | undefined;
    const economyGenerator: EconomyGeneratorPort = {
      generate: jest.fn().mockImplementation((
        config: WorldGenerationConfigDef,
        opportunity: StarterOpportunityDef,
      ) => {
        economyPortOpportunity = opportunity;
        const stableOpportunity = JSON.parse(JSON.stringify(opportunity));
        const generated = new WorldEconomyGenerator(
          new TerrainGenerator(config.seed),
        ).generate(config, stableOpportunity);
        mutate(opportunity);
        return generated;
      }),
    };
    const saveSpy = jest.spyOn(SaveService, 'saveWorld');

    const result = WorldManager.tryCreateNew(
      'Mutating economy port',
      seed,
      'temperate',
      opportunityGenerator,
      economyGenerator,
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'world-validation-failed', seed },
    });
    expect(economyPortOpportunity).not.toBe(sourceOpportunity);
    expect(sourceOpportunity).toEqual(sourceSnapshot);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(WorldManager.world).toBeNull();
    expect(SaveService.listWorlds()).toEqual([]);
  });

  it.each([
    ['malformed opportunity output', {
      opportunityGenerator: {
        generate: jest.fn().mockReturnValue(null),
      },
      economyGenerator: successfulEconomyPort(),
    }],
    ['an opportunity generator exception', {
      opportunityGenerator: {
        generate: jest.fn().mockImplementation(() => {
          throw new Error('opportunity port failed');
        }),
      },
      economyGenerator: successfulEconomyPort(),
    }],
    ['missing opportunity diagnostics', {
      opportunityGenerator: {
        generate: jest.fn().mockImplementation((
          config: WorldGenerationConfigDef,
        ) => ({
          ok: true,
          opportunity: successfulResult(config.seed).opportunity,
        })),
      },
      economyGenerator: successfulEconomyPort(),
    }],
    ['malformed economy output', {
      opportunityGenerator: successfulPort(),
      economyGenerator: {
        generate: jest.fn().mockReturnValue(null),
      },
    }],
    ['an economy generator exception', {
      opportunityGenerator: successfulPort(),
      economyGenerator: {
        generate: jest.fn().mockImplementation(() => {
          throw new Error('economy port failed');
        }),
      },
    }],
    ['missing economy diagnostics', {
      opportunityGenerator: successfulPort(),
      economyGenerator: {
        generate: jest.fn().mockImplementation((
          config: WorldGenerationConfigDef,
          opportunity: StarterOpportunityDef,
        ) => {
          const result = new WorldEconomyGenerator(
            new TerrainGenerator(config.seed),
          ).generate(config, opportunity) as any;
          delete result.diagnostics;
          return result;
        }),
      },
    }],
  ])('bounds %s as validation failure', (_label, ports) => {
    const saveSpy = jest.spyOn(SaveService, 'saveWorld');

    const result = WorldManager.tryCreateNew(
      'Malformed generation',
      'malformed-generation-seed',
      'temperate',
      ports.opportunityGenerator as OpportunityGeneratorPort,
      ports.economyGenerator as EconomyGeneratorPort,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'world-validation-failed',
        seed: 'malformed-generation-seed',
      },
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(WorldManager.world).toBeNull();
    expect(SaveService.listWorlds()).toEqual([]);
  });

  it('reloads the persisted opportunity without invoking generation again', () => {
    const generator = successfulPort();
    const created = WorldManager.tryCreateNew(
      'Replay',
      'replay-seed',
      'temperate',
      generator,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const persistedOpportunity = JSON.parse(JSON.stringify(
      created.world.starterOpportunity,
    ));

    WorldManager.reset();
    const loaded = WorldManager.load(created.world.id);

    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(loaded?.starterOpportunity).toEqual(persistedOpportunity);
  });

  it('leaves no active or persisted world when generation exhausts', () => {
    const generator: OpportunityGeneratorPort = {
      generate: jest.fn().mockReturnValue({
        ok: false,
        error: {
          code: 'opportunity-exhausted',
          seed: 'failed-seed',
          attemptsEvaluated: 12,
          maxSiteCandidatesEvaluated: 256,
        },
      }),
    };
    const saveSpy = jest.spyOn(SaveService, 'saveWorld');

    const result = WorldManager.tryCreateNew(
      'Failed',
      'failed-seed',
      'temperate',
      generator,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'opportunity-exhausted',
        seed: 'failed-seed',
        attemptsEvaluated: 12,
        maxSiteCandidatesEvaluated: 256,
      },
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(WorldManager.world).toBeNull();
    expect(SaveService.listWorlds()).toEqual([]);
  });

  it('does not install a detached world when persistence fails', () => {
    const saveSpy = jest.spyOn(SaveService, 'saveWorld').mockReturnValue(false);

    const result = WorldManager.tryCreateNew(
      'Unsaved',
      'save-failure-seed',
      'temperate',
      successfulPort(),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'world-save-failed', seed: 'save-failure-seed' },
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(WorldManager.world).toBeNull();
  });

  it('preserves the exact active world when replacement generation exhausts', () => {
    const prior = WorldManager.tryCreateNew(
      'Prior',
      'prior-seed',
      'temperate',
      successfulPort(),
    );
    expect(prior.ok).toBe(true);
    if (!prior.ok) return;
    spendCompanyCashTo(765_432);
    const failingGenerator: OpportunityGeneratorPort = {
      generate: jest.fn().mockReturnValue({
        ok: false,
        error: {
          code: 'opportunity-exhausted',
          seed: 'replacement-failed',
          attemptsEvaluated: 12,
          maxSiteCandidatesEvaluated: 256,
        },
      }),
    };

    const result = WorldManager.tryCreateNew(
      'Replacement',
      'replacement-failed',
      'temperate',
      failingGenerator,
    );

    expect(result.ok).toBe(false);
    expect(WorldManager.world).toBe(prior.world);
    expect(WorldManager.world?.company.cash).toBe(765_432);
    expect(SaveService.listWorlds().map((world) => world.id))
      .toEqual([prior.world.id]);
  });

  it('preserves the exact active world when replacement persistence fails', () => {
    const prior = WorldManager.tryCreateNew(
      'Prior',
      'prior-save-seed',
      'temperate',
      successfulPort(),
    );
    expect(prior.ok).toBe(true);
    if (!prior.ok) return;
    spendCompanyCashTo(654_321);
    jest.spyOn(SaveService, 'saveWorld').mockReturnValue(false);

    const result = WorldManager.tryCreateNew(
      'Unsaved replacement',
      'replacement-save-failed',
      'temperate',
      successfulPort(),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'world-save-failed',
        seed: 'replacement-save-failed',
      },
    });
    expect(WorldManager.world).toBe(prior.world);
    expect(WorldManager.world?.company.cash).toBe(654_321);
    expect(SaveService.listWorlds().map((world) => world.id))
      .toEqual([prior.world.id]);
  });

  it('replaces an active world only after successful persistence', () => {
    const prior = WorldManager.tryCreateNew(
      'Prior',
      'prior-success-seed',
      'temperate',
      successfulPort(),
    );
    expect(prior.ok).toBe(true);
    if (!prior.ok) return;

    const replacement = WorldManager.tryCreateNew(
      'Replacement',
      'replacement-success-seed',
      'alpine',
      successfulPort(),
    );

    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(WorldManager.world).toBe(replacement.world);
    expect(WorldManager.world).not.toBe(prior.world);
    expect(SaveService.loadWorld(replacement.world.id)).toEqual(
      replacement.world,
    );
  });

  it.each(['real-terrain-alpha', 'real-terrain-beta'])(
    'finds an affordable opportunity for fixed real terrain seed %s',
    (seed) => {
      const result = new WorldOpportunityGenerator(
        new TerrainGenerator(seed),
      ).generate({
        generationConfigVersion: 1,
        seed,
        biome: 'temperate',
        constructionDifficultyId: 'standard',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expectSurveyFitsRecommendedCamera(result.opportunity);
      expect(Math.min(...result.opportunity.corridors.map(
        (corridor) => corridor.estimatedCost,
      ))).toBeLessThanOrEqual(
        STANDARD_STARTING_CASH
        - FLATBED_TRAIN_PURCHASE_PRICE
        - STARTER_ROUTE_RESERVE,
      );
    },
  );

  it.each(['real-terrain-alpha', 'real-terrain-beta', 'playtest-753'])(
    'creates an affordable blank Prefab opportunity on representative real-world seed %s',
    (seed) => {
      const result = WorldManager.tryCreateNew(
        `Generated ${seed}`,
        seed,
        'temperate',
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const sawmill = result.world.economy.facilities.find(
        ({ id }) => id === 'sawmill',
      )!;
      const prefab = result.world.economy.facilities.find(
        ({ id }) => id === 'prefabrication-plant',
      )!;
      const witness = analyzePrefabricationExtension(
        new ConstructionAnalyzer(new TerrainGenerator(seed)),
        sawmill.railAccess,
        prefab.railAccess,
      );
      expect(witness).not.toBeNull();
      expect(witness!.totalCost).toBeLessThanOrEqual(194_000);
      expect(result.world.tracks).toEqual([]);
      expect(result.world.junctions).toEqual([]);
      expect(result.world.stations).toEqual([]);
      expect(result.world.trains).toEqual([]);
      expect(result.world).not.toHaveProperty('services');
    },
  );

  it('jointly resolves an affordable blank start across the named Task 7 seed sweep', () => {
    for (const seed of TASK_7_JOINT_GENERATION_SWEEP_SEEDS) {
      const result = WorldManager.tryCreateNew(`Task 7 ${seed}`, seed);
      if (result.ok === false) {
        throw new Error(`${seed} failed with ${result.error.code}`);
      }
      const sawmill = result.world.economy.facilities.find(
        ({ id }) => id === 'sawmill',
      )!;
      const prefab = result.world.economy.facilities.find(
        ({ id }) => id === 'prefabrication-plant',
      )!;
      const witness = analyzePrefabricationExtension(
        new ConstructionAnalyzer(new TerrainGenerator(seed)),
        sawmill.railAccess,
        prefab.railAccess,
      );
      expect(witness).not.toBeNull();
      expect(witness!.totalCost).toBeLessThanOrEqual(194_000);
      expect(result.world.tracks).toEqual([]);
      expect(result.world.junctions).toEqual([]);
      expect(result.world.stations).toEqual([]);
      expect(result.world.trains).toEqual([]);
      expect(result.world).not.toHaveProperty('services');
    }
  }, 30_000);
});
