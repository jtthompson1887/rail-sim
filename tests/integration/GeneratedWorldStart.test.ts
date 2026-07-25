/**
 * @jest-environment jsdom
 */
import { STANDARD_STARTING_CASH } from '../../src/config/ConstructionConfig';
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

const fixtureTerrain = {
  getHeightAt(x: number, y: number): number {
    return 120 + x * 0.008 + Math.sin(x / 420) * 32 + Math.cos(y / 510) * 24;
  },
};

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

  it('persists a schema-4 opportunity before installing an otherwise blank world', () => {
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
    expect(result.world.schemaVersion).toBe(4);
    expect(result.world.company.cash).toBe(STANDARD_STARTING_CASH);
    expect(result.world.starterOpportunity).toEqual(
      successfulResult().opportunity,
    );
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
      expect(Math.min(...result.opportunity.corridors.map(
        (corridor) => corridor.estimatedCost,
      ))).toBeLessThanOrEqual(STANDARD_STARTING_CASH);
    },
  );
});
