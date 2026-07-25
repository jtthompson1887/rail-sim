/**
 * @jest-environment jsdom
 */
import {
  ENDPOINT_CONNECTION_COST,
  STANDARD_STARTING_CASH,
} from '../../src/config/ConstructionConfig';
import type { WorldGenerationConfigDef } from '../../src/config/WorldData';
import {
  type OpportunityGeneratorPort,
  WorldManager,
} from '../../src/managers/WorldManager';
import { SaveService } from '../../src/services/SaveService';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import {
  WorldOpportunityGenerator,
  type OpportunityGenerationResult,
} from '../../src/systems/WorldOpportunityGenerator';
import { GameConfig } from '../../src/config/GameConfig';
import type { StarterOpportunityDef } from '../../src/config/WorldData';
import { OPPORTUNITY_CAMERA_PADDING } from '../../src/config/WorldGeneration';

const fixtureTerrain = {
  getHeightAt(x: number, y: number): number {
    return 120 + x * 0.008 + Math.sin(x / 420) * 32 + Math.cos(y / 510) * 24;
  },
};

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

function successfulResult(
  seed = 'fixture-seed',
): Extract<OpportunityGenerationResult, { ok: true }> {
  const config: WorldGenerationConfigDef = {
    generationConfigVersion: 1,
    seed,
    biome: 'temperate',
    constructionDifficultyId: 'standard',
  };
  const result = new WorldOpportunityGenerator(fixtureTerrain).generate(config);
  if (!result.ok) throw new Error('opportunity fixture generation failed');
  return result;
}

function successfulPort(): OpportunityGeneratorPort & {
  generate: jest.Mock<OpportunityGenerationResult, [WorldGenerationConfigDef]>;
} {
  return {
    generate: jest.fn().mockReturnValue(successfulResult()),
  };
}

describe('generated blank-world start', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
    jest.restoreAllMocks();
  });

  it('persists a schema-5 opportunity before installing an otherwise blank world', () => {
    const generator = successfulPort();
    const result = WorldManager.tryCreateNew(
      'Generated',
      'atomic-seed',
      'alpine',
      generator,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generator.generate).toHaveBeenCalledWith({
      generationConfigVersion: 1,
      seed: 'atomic-seed',
      biome: 'alpine',
      constructionDifficultyId: 'standard',
    });
    expect(result.world.schemaVersion).toBe(5);
    expect(result.world.revision).toBe(0);
    expect(result.world.company.cash).toBe(STANDARD_STARTING_CASH);
    expect(result.world.starterOpportunity).toEqual(
      successfulResult().opportunity,
    );
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
    expect(WorldManager.world).toBe(result.world);
    expect(SaveService.loadWorld(result.world.id)).toEqual(result.world);
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
    prior.world.company.cash = 765_432;
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
    prior.world.company.cash = 654_321;
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
      ))).toBeLessThanOrEqual(STANDARD_STARTING_CASH);
    },
  );
});
