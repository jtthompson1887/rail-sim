/**
 * @jest-environment jsdom
 */

import { WorldManager } from '../../src/managers/WorldManager';
import { SaveService } from '../../src/services/SaveService';
import { createEmptyWorld } from '../../src/config/WorldData';
import type { TrackDef } from '../../src/config/WorldData';
import { EventBus } from '../../src/services/EventBus';
import { STANDARD_STARTING_CASH } from '../../src/config/ConstructionConfig';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';
import { clonePlainData } from '../../src/utils/PlainData';
import { makeFreightTrainDef } from '../fixtures/FirstFreightRouteFixture';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import {
  analyzePrefabricationExtension,
  resolvePrefabricationExtensionStart,
} from '../../src/economy/PrefabricationOpportunity';
import {
  WorldEconomyGenerator,
  type EconomyGenerationResult,
} from '../../src/economy/WorldEconomyGenerator';
import {
  MAX_ECONOMY_SITE_CANDIDATES,
  MAX_OPPORTUNITY_ATTEMPTS,
  WorldGenerationConfig,
} from '../../src/config/WorldGeneration';

const MAX_JOINT_ECONOMY_EVALUATIONS = MAX_OPPORTUNITY_ATTEMPTS
  * WorldGenerationConfig.MAX_PAIR_EVALUATIONS_PER_ATTEMPT;

function makeTrackDef(
  uuid: string,
  p0 = { x: 0, y: 0 },
  p1 = { x: 1, y: 0 },
  p2 = { x: 2, y: 0 },
  p3 = { x: 3, y: 0 },
): TrackDef {
  return {
    geometryVersion: 1,
    uuid,
    p0,
    p1,
    p2,
    p3,
    verticalProfile: {
      profileVersion: 1,
      knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
    },
    structures: [{
      type: 'surface',
      startT: 0,
      endT: 1,
      startElevation: 0,
      endElevation: 0,
    }],
    paidBuildCost: 0,
  };
}

describe('WorldManager', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
  });

  describe('createNew()', () => {
    it('continues default opportunity search and persists the exact accepted economy', () => {
      const originalGenerate = WorldEconomyGenerator.prototype.generate;
      const accepted: Array<{
        opportunity: Parameters<typeof originalGenerate>[1];
        result: Extract<EconomyGenerationResult, { ok: true }>;
      }> = [];
      let calls = 0;
      const generate = jest.spyOn(
        WorldEconomyGenerator.prototype,
        'generate',
      ).mockImplementation(function generateForAcceptedOpportunity(
        generationConfig,
        opportunity,
      ) {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            error: {
              code: 'economy-exhausted',
              seed: generationConfig.seed,
              candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
              prefabAnalyses: 0,
              mineralPairAnalyses: 0,
              facilitiesPlaced: 0,
            },
          };
        }
        const result = originalGenerate.call(
          this,
          generationConfig,
          opportunity,
        );
        if (result.ok) {
          accepted.push({
            opportunity: clonePlainData(opportunity),
            result: clonePlainData(result),
          });
        }
        return result;
      });

      const result = WorldManager.tryCreateNew(
        'Retried default generation',
        'real-terrain-alpha',
      );

      const generateCalls = generate.mock.calls.length;
      generate.mockRestore();
      expect(result.ok).toBe(true);
      expect(generateCalls).toBeGreaterThan(1);
      expect(generateCalls).toBeLessThanOrEqual(
        MAX_JOINT_ECONOMY_EVALUATIONS,
      );
      expect(accepted).toHaveLength(1);
      if (!result.ok) return;
      expect(result.world.starterOpportunity).toEqual(
        accepted[0].opportunity,
      );
      expect(result.world.economy).toEqual(accepted[0].result.economy);
    });

    it.each([
      ['thrown', () => {
        throw new Error('default economy failure');
      }],
      ['malformed', () => ({ ok: true })],
    ] as const)(
      'aborts default joint generation on a %s economy result',
      (_label, implementation) => {
        const generate = jest.spyOn(
          WorldEconomyGenerator.prototype,
          'generate',
        ).mockImplementation(implementation as any);
        const save = jest.spyOn(SaveService, 'saveWorld');

        const result = WorldManager.tryCreateNew(
          'Invalid default economy',
          'default-economy-fatal',
        );

        const generateCalls = generate.mock.calls.length;
        const saveCalls = save.mock.calls.length;
        generate.mockRestore();
        save.mockRestore();
        expect(result).toEqual({
          ok: false,
          error: {
            code: 'world-validation-failed',
            seed: 'default-economy-fatal',
          },
        });
        expect(generateCalls).toBe(1);
        expect(saveCalls).toBe(0);
        expect(WorldManager.world).toBeNull();
      },
    );

    it('aborts default joint generation on an independently invalid economy', () => {
      const originalGenerate = WorldEconomyGenerator.prototype.generate;
      let invalidEconomies = 0;
      const generate = jest.spyOn(
        WorldEconomyGenerator.prototype,
        'generate',
      ).mockImplementation(function generateInvalidEconomy(
        generationConfig,
        opportunity,
      ) {
        const result = originalGenerate.call(
          this,
          generationConfig,
          opportunity,
        );
        if (!result.ok) return result;
        invalidEconomies += 1;
        const invalid = clonePlainData(result);
        const prefab = invalid.economy.facilities.find(
          ({ id }) => id === 'prefabrication-plant',
        )!;
        prefab.x = 7_000;
        prefab.y = 7_000;
        prefab.railAccess.x = 7_000;
        prefab.railAccess.y = 7_000;
        return invalid;
      });
      const save = jest.spyOn(SaveService, 'saveWorld');

      const result = WorldManager.tryCreateNew(
        'Invalid default economy',
        'real-terrain-alpha',
      );

      const generateCalls = generate.mock.calls.length;
      const saveCalls = save.mock.calls.length;
      generate.mockRestore();
      save.mockRestore();
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'world-validation-failed',
          seed: 'real-terrain-alpha',
        },
      });
      expect(generateCalls).toBeGreaterThanOrEqual(invalidEconomies);
      expect(generateCalls).toBeLessThanOrEqual(
        MAX_JOINT_ECONOMY_EVALUATIONS,
      );
      expect(invalidEconomies).toBe(1);
      expect(saveCalls).toBe(0);
      expect(WorldManager.world).toBeNull();
    });

    it('creates a world with the given name', () => {
      const world = WorldManager.createNew('Test World', 'real-terrain-alpha');
      expect(world.name).toBe('Test World');
    });

    it('generates a unique id', () => {
      const a = WorldManager.createNew('A', 'real-terrain-alpha');
      WorldManager.reset();
      const b = WorldManager.createNew('B', 'real-terrain-alpha');
      expect(a.id).not.toBe(b.id);
    });

    it('sets loaded = true', () => {
      WorldManager.createNew('W', 'real-terrain-alpha');
      expect(WorldManager.loaded).toBe(true);
    });

    it('initialises with empty tracks, junctions, stations, trains', () => {
      const w = WorldManager.createNew('Empty', 'real-terrain-alpha');
      expect(w.tracks).toHaveLength(0);
      expect(w.junctions).toHaveLength(0);
      expect(w.stations).toHaveLength(0);
      expect(w.trains).toHaveLength(0);
      expect(w).not.toHaveProperty('services');
    });

    it('installs only a world with a recomputable affordable Prefab extension', () => {
      const seed = 'real-terrain-alpha';
      const world = WorldManager.createNew('Affordable', seed);
      const sawmill = world.economy.facilities.find(
        ({ id }) => id === 'sawmill',
      )!;
      const prefab = world.economy.facilities.find(
        ({ id }) => id === 'prefabrication-plant',
      )!;
      const start = resolvePrefabricationExtensionStart(
        world.starterOpportunity,
      );

      const witness = analyzePrefabricationExtension(
        new ConstructionAnalyzer(new TerrainGenerator(seed)),
        start!,
        prefab.railAccess,
      );

      expect(start).not.toBeNull();
      expect(start?.point).toEqual({
        x: sawmill.railAccess.x,
        y: sawmill.railAccess.y,
      });
      expect(witness).not.toBeNull();
      expect(witness!.totalCost).toBeLessThanOrEqual(194_000);
    });

    it('accepts a custom seed', () => {
      const w = WorldManager.createNew('Seeded', 'my-seed-123');
      expect(w.generationConfig.seed).toBe('my-seed-123');
    });

    it('creates schema 9 with a generated economy and conserved opening balance', () => {
      const w: any = WorldManager.createNew('Versioned', 'seed-v1', 'alpine');
      expect(w.schemaVersion).toBe(9);
      expect(w.revision).toBe(0);
      expect(w.constructionRevision).toBe(0);
      expect(w.operationsRevision).toBe(0);
      expect(w.freightProgress).toEqual({
        progressVersion: 1,
        profitableLogDeliveryCompleted: false,
        developmentGrantAwarded: false,
        profitableStructuralTimberDeliveryCompleted: false,
        profitableLimestoneDeliveryCompleted: false,
        profitableCementDeliveryCompleted: false,
      });
      expect(w).not.toHaveProperty('firstRouteProgress');
      expect(w.generationConfig).toEqual({
        generationConfigVersion: 1,
        seed: 'seed-v1',
        biome: 'alpine',
        constructionDifficultyId: 'standard',
      });
      expect(w.company).toEqual({
        cash: STANDARD_STARTING_CASH,
        nextLedgerId: 2,
        ledger: [{
          id: 1,
          tick: 0,
          category: 'opening-balance',
          ledgerClass: 'opening',
          amount: STANDARD_STARTING_CASH,
          referenceId: 'opening-balance',
        }],
      });
      expect(w.economy.economyVersion).toBe(1);
      expect(w.economy.tick).toBe(0);
      expect(w.economy.facilities.map(
        (facility: any) => facility.id,
      )).toEqual([
        'managed-forest',
        'sawmill',
        'quarry',
        'cement-works',
        'port-interchange',
        'prefabrication-plant',
        'town-construction-market',
      ]);
      expect(w.economy.market.constructionIndexBps).toBe(10_000);
      expect(Object.keys(
        w.economy.market.regionalDemandBpsByProduct,
      ).sort()).toEqual([
        'building-modules',
        'cement',
        'limestone-aggregate',
        'logs',
        'steel',
        'structural-timber',
      ]);
      Object.values(
        w.economy.market.regionalDemandBpsByProduct,
      ).forEach((factor: any) => {
        expect(factor).toBeGreaterThanOrEqual(8_000);
        expect(factor).toBeLessThanOrEqual(12_000);
      });
      expect(w).not.toHaveProperty('scenarios');
      expect(w).not.toHaveProperty('seed');
      expect(w).not.toHaveProperty('terrainSeed');
      expect(w).not.toHaveProperty('biome');
    });
  });

  describe('reset()', () => {
    it('unloads the current world', () => {
      WorldManager.createNew('X', 'real-terrain-alpha');
      WorldManager.reset();
      expect(WorldManager.loaded).toBe(false);
      expect(WorldManager.world).toBeNull();
    });

    it('currentWorldId becomes null after reset', () => {
      WorldManager.createNew('X', 'real-terrain-alpha');
      WorldManager.reset();
      expect(WorldManager.currentWorldId).toBeNull();
    });
  });

  describe('save() / load()', () => {
    it('saves and reloads the world', () => {
      const created = WorldManager.createNew('Persist', 'real-terrain-alpha');
      WorldManager.save();
      WorldManager.reset();
      const loaded = WorldManager.load(created.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('Persist');
    });

    it('returns null for unknown id', () => {
      expect(WorldManager.load('no-such-id')).toBeNull();
    });

    it('returns false and does not emit world:saved when persistence rejects the save', () => {
      WorldManager.createNew('Rejected', 'real-terrain-alpha');
      const saveSpy = jest.spyOn(SaveService, 'saveWorld').mockReturnValue(false);
      const emitSpy = jest.spyOn(EventBus, 'emit');

      const result = WorldManager.save();
      const emittedSaved = emitSpy.mock.calls.some(([event]) => event === 'world:saved');
      emitSpy.mockRestore();
      saveSpy.mockRestore();

      expect(result).toBe(false);
      expect(emittedSaved).toBe(false);
    });

    it('clears a stale active world when the requested save is incompatible', () => {
      const incompatible = {
        ...createEmptyWorld(
          'Old',
          'old-seed',
          'temperate',
          makeStarterOpportunity('old-seed'),
        ),
        schemaVersion: 2,
      };
      localStorage.setItem(
        'rail-sim-worlds',
        JSON.stringify({ [incompatible.id]: incompatible }),
      );
      WorldManager.createNew('Stale', 'real-terrain-alpha');

      expect(WorldManager.load(incompatible.id)).toBeNull();
      expect(WorldManager.world).toBeNull();
    });

    it('sets currentWorldId after loading', () => {
      const w = WorldManager.createNew('W2', 'real-terrain-alpha');
      WorldManager.save();
      WorldManager.reset();
      WorldManager.load(w.id);
      expect(WorldManager.currentWorldId).toBe(w.id);
    });
  });

  describe('addTrackDef() / removeTrackDef()', () => {
    it('adds a track definition', () => {
      WorldManager.createNew('T', 'real-terrain-alpha');
      WorldManager.addTrackDef(makeTrackDef('abc'));
      expect(WorldManager.world!.tracks).toHaveLength(1);
    });

    it('removes a track definition by uuid', () => {
      WorldManager.createNew('T', 'real-terrain-alpha');
      WorldManager.addTrackDef(makeTrackDef('rm-me'));
      WorldManager.removeTrackDef('rm-me');
      expect(WorldManager.world!.tracks).toHaveLength(0);
    });

    it('does nothing when no world is loaded', () => {
      expect(() => WorldManager.addTrackDef(makeTrackDef('x'))).not.toThrow();
    });

    it('advances once only for an actual mutation and rejects overflow', () => {
      WorldManager.createNew('Revision', 'real-terrain-alpha');
      expect(WorldManager.addTrackDef(makeTrackDef('one'))).toBe(true);
      expect(WorldManager.world!.revision).toBe(1);
      expect(WorldManager.addTrackDef(makeTrackDef('one'))).toBe(false);
      expect(WorldManager.world!.revision).toBe(1);
      WorldManager.world!.revision = Number.MAX_SAFE_INTEGER;
      expect(WorldManager.addTrackDef(makeTrackDef('two'))).toBe(false);
      expect(WorldManager.world!.tracks.map((track) => track.uuid)).toEqual(['one']);
    });

    it('does not expose a no-revision mutation bypass', () => {
      WorldManager.createNew('No bypass', 'real-terrain-alpha');
      expect((WorldManager.addTrackDef as any)(makeTrackDef('one'), false)).toBe(true);
      expect(WorldManager.world!.revision).toBe(1);
    });

    it('advances only construction and root revisions for a construction batch', () => {
      const world: any = WorldManager.createNew(
        'Construction cursor',
        'real-terrain-alpha',
      );

      expect(WorldManager.applyConstructionBatch(
        world.constructionRevision,
        (draft) => draft.addTrack(makeTrackDef('cursor-track')),
      )).toBe(true);
      expect(world.revision).toBe(1);
      expect(world.constructionRevision).toBe(1);
      expect(world.operationsRevision).toBe(0);
    });

    it('advances only operations and root revisions for an operations batch', () => {
      const world: any = WorldManager.createNew(
        'Operations cursor',
        'real-terrain-alpha',
      );

      expect(WorldManager.applyOperationsBatch(
        world.revision,
        (draft) => {
          draft.economy.tick += 1;
          return true;
        },
      )).toBe(true);
      expect(world.revision).toBe(1);
      expect(world.constructionRevision).toBe(0);
      expect(world.operationsRevision).toBe(1);
      expect(world.economy.tick).toBe(1);
    });

    it('keeps a current construction cursor usable after an economy-only batch', () => {
      const world: any = WorldManager.createNew(
        'Independent cursors',
        'real-terrain-alpha',
      );
      const constructionCursor = world.constructionRevision;

      expect(WorldManager.applyOperationsBatch(
        world.revision,
        (draft) => {
          draft.economy.tick += 1;
          return true;
        },
      )).toBe(true);
      expect(WorldManager.applyConstructionBatch(
        constructionCursor,
        (draft) => draft.addTrack(makeTrackDef('after-economy')),
      )).toBe(true);
      expect(world.revision).toBe(2);
      expect(world.constructionRevision).toBe(1);
      expect(world.operationsRevision).toBe(1);
      expect(world.tracks.map(({ uuid }) => uuid)).toEqual(['after-economy']);
    });

    it.each([
      ['negative root revision', (world: any) => { world.revision = -1; }],
      ['negative construction revision', (world: any) => {
        world.constructionRevision = -1;
      }],
      ['maximum construction revision', (world: any) => {
        world.revision = Number.MAX_SAFE_INTEGER;
        world.constructionRevision = Number.MAX_SAFE_INTEGER;
      }],
    ])('rejects construction when the world has %s', (_label, corrupt) => {
      const world: any = WorldManager.createNew(
        'Invalid construction cursor',
        'real-terrain-alpha',
      );
      corrupt(world);
      const before = JSON.stringify(world);
      expect(WorldManager.applyConstructionBatch(
        world.constructionRevision,
        (draft) => draft.addTrack(makeTrackDef('never-added')),
      )).toBe(false);
      expect(JSON.stringify(world)).toBe(before);
    });

    it.each([
      ['negative root revision', (world: any) => { world.revision = -1; }],
      ['negative operations revision', (world: any) => {
        world.operationsRevision = -1;
      }],
      ['maximum operations revision', (world: any) => {
        world.revision = Number.MAX_SAFE_INTEGER;
        world.operationsRevision = Number.MAX_SAFE_INTEGER;
      }],
    ])('rejects operations when the world has %s', (_label, corrupt) => {
      const world: any = WorldManager.createNew(
        'Invalid operations cursor',
        'real-terrain-alpha',
      );
      corrupt(world);
      const before = JSON.stringify(world);
      expect(WorldManager.applyOperationsBatch(
        world.revision,
        (draft) => {
          draft.economy.tick += 1;
          return true;
        },
      )).toBe(false);
      expect(JSON.stringify(world)).toBe(before);
    });

    it('rejects nested same-domain and cross-domain batches without side effects', () => {
      const world = WorldManager.createNew(
        'Nested batches',
        'real-terrain-alpha',
      );
      const before = clonePlainData(world);
      let nestedConstruction: boolean | null = null;
      let nestedOperations: boolean | null = null;

      const outer = WorldManager.applyConstructionBatch(
        world.constructionRevision,
        (draft) => {
          nestedConstruction = WorldManager.applyConstructionBatch(
            world.constructionRevision,
            (nestedDraft) => nestedDraft.addTrack(makeTrackDef('nested-track')),
          );
          nestedOperations = WorldManager.applyOperationsBatch(
            world.revision,
            (operationsDraft: any) => {
              operationsDraft.economy.tick += 1;
              return true;
            },
          );
          return draft.addTrack(makeTrackDef('outer-track')) && false;
        },
      );

      expect(outer).toBe(false);
      expect(nestedConstruction).toBe(false);
      expect(nestedOperations).toBe(false);
      expect(world).toEqual(before);
    });

    it.each(['false', 'throw'] as const)(
      'rolls back direct live-world mutation when a construction callback returns %s',
      (outcome) => {
        const world = WorldManager.createNew(
          'Direct mutation rollback',
          'real-terrain-alpha',
        );
        const before = clonePlainData(world);

        const result = WorldManager.applyConstructionBatch(
          world.constructionRevision,
          (draft) => {
            world.name = 'escaped mutation';
            world.scenery.push({
              id: 'escaped',
              type: 'tree_oak',
              x: 0,
              y: 0,
              rotation: 0,
              scale: 1,
              variant: 0,
            });
            draft.addTrack(makeTrackDef('draft-track'));
            if (outcome === 'throw') throw new Error('rollback');
            return false;
          },
        );

        expect(result).toBe(false);
        expect(world).toEqual(before);
      },
    );

    it('rejects and rolls back a direct live mutation even when the callback returns true', () => {
      const world = WorldManager.createNew(
        'Successful escape',
        'real-terrain-alpha',
      );
      const before = clonePlainData(world);

      expect(WorldManager.applyOperationsBatch(
        world.revision,
        (draft) => {
          draft.economy.tick += 1;
          world.name = 'mutated behind the draft';
          return true;
        },
      )).toBe(false);
      expect(world).toEqual(before);
    });

    it('rejects an invalid candidate and does not expose an escaped draft', () => {
      const world = WorldManager.createNew(
        'Candidate isolation',
        'real-terrain-alpha',
      );
      const before = clonePlainData(world);
      let escaped: any = null;
      expect(WorldManager.applyConstructionBatch(
        world.constructionRevision,
        (draft) => {
          escaped = draft;
          draft.company = { cash: 0, nextLedgerId: 2, ledger: [] };
          return draft.addTrack(makeTrackDef('invalid-company'));
        },
      )).toBe(false);
      expect(world).toEqual(before);

      escaped.addTrack(makeTrackDef('late-escape'));
      escaped.company.cash = 123;
      expect(world).toEqual(before);
    });

    it('blocks persistence and lifecycle reentrancy while a batch callback is active', () => {
      const world = WorldManager.createNew(
        'Reentrant lifecycle',
        'real-terrain-alpha',
      );
      const before = clonePlainData(world);
      const saveWorld = jest.spyOn(SaveService, 'saveWorld');

      const result = WorldManager.applyConstructionBatch(
        world.constructionRevision,
        () => {
          world.name = 'transient name';
          expect(WorldManager.save()).toBe(false);
          expect(WorldManager.load('other-world')).toBeNull();
          expect(WorldManager.tryCreateNew(
            'Nested world',
            'nested-seed',
          )).toEqual({
            ok: false,
            error: {
              code: 'world-save-failed',
              seed: 'nested-seed',
            },
          });
          expect(() => WorldManager.createNew(
            'Nested throwing world',
            'nested-throw-seed',
          )).toThrow('World creation failed: world-save-failed');
          WorldManager.reset();
          expect(WorldManager.world).toBe(world);
          return false;
        },
      );

      expect(result).toBe(false);
      expect(saveWorld).not.toHaveBeenCalled();
      expect(WorldManager.world).toBe(world);
      expect(world).toEqual(before);
      saveWorld.mockRestore();
    });

    it('commits all four operations domains atomically and detaches the installed state', () => {
      const world = WorldManager.createNew(
        'Atomic operations',
        'real-terrain-alpha',
      );
      expect(WorldManager.addTrackDef(
        makeTrackDef('forest-sawmill-track'),
      )).toBe(true);
      const rootBefore = world.revision;
      const constructionBefore = world.constructionRevision;
      const operationsBefore = world.operationsRevision;
      const cashBefore = world.company.cash;
      let escaped: any = null;

      expect(WorldManager.applyOperationsBatch(
        rootBefore,
        (draft) => {
          escaped = draft;
          draft.company.cash -= 100;
          draft.company.ledger.push({
            id: draft.company.nextLedgerId,
            tick: draft.economy.tick,
            category: 'vehicle-capex',
            ledgerClass: 'capital-expenditure',
            amount: -100,
            referenceId: 'train-1',
          });
          draft.company.nextLedgerId += 1;
          draft.economy.facilities[0].name += ' upgraded';
          draft.trains.push(makeFreightTrainDef());
          draft.freightProgress.profitableLogDeliveryCompleted = true;
          draft.freightProgress.profitableLimestoneDeliveryCompleted = true;
          draft.freightProgress.profitableCementDeliveryCompleted = true;
          return true;
        },
      )).toBe(true);

      expect(world.company.cash).toBe(cashBefore - 100);
      expect(world.company.ledger.at(-1)).toEqual(expect.objectContaining({
        category: 'vehicle-capex',
        amount: -100,
        referenceId: 'train-1',
      }));
      expect(world.economy.facilities[0].name).toContain('upgraded');
      expect(world.trains).toEqual([makeFreightTrainDef()]);
      expect(world.freightProgress.profitableLogDeliveryCompleted).toBe(true);
      expect(world.freightProgress.profitableLimestoneDeliveryCompleted)
        .toBe(true);
      expect(world.freightProgress.profitableCementDeliveryCompleted)
        .toBe(true);
      expect(world.revision).toBe(rootBefore + 1);
      expect(world.constructionRevision).toBe(constructionBefore);
      expect(world.operationsRevision).toBe(operationsBefore + 1);
      expect(world.revision).toBe(
        world.constructionRevision + world.operationsRevision,
      );

      const installed = JSON.stringify(world);
      escaped.company.cash = 0;
      escaped.economy.tick += 1;
      escaped.trains[0].trackT = 0.9;
      escaped.freightProgress.profitableLogDeliveryCompleted = false;
      escaped.freightProgress.profitableLimestoneDeliveryCompleted = false;
      escaped.freightProgress.profitableCementDeliveryCompleted = false;
      expect(JSON.stringify(world)).toBe(installed);
    });

    it.each([
      ['stale root', -1, true, true],
      ['mutator rejection', 0, true, false],
      ['true no-op', 0, false, true],
    ] as const)(
      'preserves exact world bytes for %s',
      (_label, revisionOffset, mutateDraft, accepted) => {
      const world = WorldManager.createNew(
        'Rejected operations',
        'real-terrain-alpha',
      );
      const before = JSON.stringify(world);
      expect(WorldManager.applyOperationsBatch(
        world.revision + revisionOffset,
        (draft) => {
          if (mutateDraft) draft.economy.tick += 1;
          return accepted;
        },
      )).toBe(false);
      expect(JSON.stringify(WorldManager.world)).toBe(before);
      },
    );

    it('preserves exact world bytes when an operations mutator throws', () => {
      const world = WorldManager.createNew(
        'Thrown operations',
        'real-terrain-alpha',
      );
      const before = JSON.stringify(world);
      expect(WorldManager.applyOperationsBatch(
        world.revision,
        (draft) => {
          draft.economy.tick += 1;
          throw new Error('rollback');
        },
      )).toBe(false);
      expect(WorldManager.world).toBe(world);
      expect(JSON.stringify(WorldManager.world)).toBe(before);
    });

    it('preserves exact world bytes for an invalid operations candidate', () => {
      const world = WorldManager.createNew(
        'Invalid operations candidate',
        'real-terrain-alpha',
      );
      const before = JSON.stringify(world);
      expect(WorldManager.applyOperationsBatch(
        world.revision,
        (draft) => {
          draft.company.cash = -1;
          return true;
        },
      )).toBe(false);
      expect(WorldManager.world).toBe(world);
      expect(JSON.stringify(WorldManager.world)).toBe(before);
    });

    it.each([
      'profitableLimestoneDeliveryCompleted',
      'profitableCementDeliveryCompleted',
    ] as const)('rejects a draft missing %s with exact rollback', (field) => {
      const world = WorldManager.createNew(
        'Invalid mineral progress',
        'real-terrain-alpha',
      );
      const before = JSON.stringify(world);

      expect(WorldManager.applyOperationsBatch(
        world.revision,
        (draft) => {
          delete (draft.freightProgress as any)[field];
          return true;
        },
      )).toBe(false);
      expect(WorldManager.world).toBe(world);
      expect(JSON.stringify(WorldManager.world)).toBe(before);
    });

    it('rejects nested operations and construction batches with exact rollback', () => {
      const world = WorldManager.createNew(
        'Nested operations',
        'real-terrain-alpha',
      );
      const before = JSON.stringify(world);
      let nestedOperations: boolean | null = null;
      let nestedConstruction: boolean | null = null;

      expect(WorldManager.applyOperationsBatch(
        world.revision,
        (draft) => {
          draft.economy.tick += 1;
          nestedOperations = WorldManager.applyOperationsBatch(
            world.revision,
            () => true,
          );
          nestedConstruction = WorldManager.applyConstructionBatch(
            world.constructionRevision,
            () => true,
          );
          return false;
        },
      )).toBe(false);
      expect(nestedOperations).toBe(false);
      expect(nestedConstruction).toBe(false);
      expect(JSON.stringify(WorldManager.world)).toBe(before);
    });

    it('restores every operations domain and revision when installation throws', () => {
      const world = WorldManager.createNew(
        'Install failure',
        'real-terrain-alpha',
      );
      const before = JSON.stringify(world);
      Object.defineProperty(world, 'trains', {
        configurable: true,
        writable: false,
        value: world.trains,
      });

      expect(WorldManager.applyOperationsBatch(
        world.revision,
        (draft) => {
          draft.company.cash -= 1;
          draft.company.ledger.push({
            id: draft.company.nextLedgerId,
            tick: draft.economy.tick,
            category: 'vehicle-capex',
            ledgerClass: 'capital-expenditure',
            amount: -1,
            referenceId: 'install-failure',
          });
          draft.company.nextLedgerId += 1;
          draft.economy.tick += 1;
          draft.freightProgress.profitableLogDeliveryCompleted = true;
          return true;
        },
      )).toBe(false);
      expect(WorldManager.world).toBe(world);
      expect(JSON.stringify(WorldManager.world)).toBe(before);
    });
  });

  describe('addJunctionDef() / removeJunctionDef()', () => {
    it('adds a junction definition', () => {
      WorldManager.createNew('J', 'real-terrain-alpha');
      WorldManager.addJunctionDef({
        uuid: 'jct-1',
        mainTrackUUID: 'main',
        leftTrackUUID: 'left',
        rightTrackUUID: 'right',
        position: 0.5,
        branchState: 'right',
      });
      expect(WorldManager.world!.junctions).toHaveLength(1);
    });

    it('removes a junction definition by uuid', () => {
      WorldManager.createNew('J', 'real-terrain-alpha');
      WorldManager.addJunctionDef({
        uuid: 'del-jct',
        mainTrackUUID: 'main',
        leftTrackUUID: 'left',
        rightTrackUUID: 'right',
        position: 0.5,
        branchState: 'left',
      });
      WorldManager.removeJunctionDef('del-jct');
      expect(WorldManager.world!.junctions).toHaveLength(0);
    });
  });

  describe('addStationDef() / removeStationDef()', () => {
    it('adds a station definition', () => {
      WorldManager.createNew('S', 'real-terrain-alpha');
      WorldManager.addStationDef({ id: 'st-1', name: 'Central', trackUUID: 'abc', trackT: 0.5, passengerSpawnRate: 0.5 });
      expect(WorldManager.world!.stations).toHaveLength(1);
      expect(WorldManager.world!.constructionRevision).toBe(1);
      expect(WorldManager.world!.operationsRevision).toBe(0);
      expect(WorldManager.world!.revision).toBe(
        WorldManager.world!.constructionRevision
          + WorldManager.world!.operationsRevision,
      );
    });

    it('removes a station definition', () => {
      WorldManager.createNew('S', 'real-terrain-alpha');
      WorldManager.addStationDef({ id: 'rm-st', name: 'X', trackUUID: 'abc', trackT: 0, passengerSpawnRate: 0.1 });
      WorldManager.removeStationDef('rm-st');
      expect(WorldManager.world!.stations).toHaveLength(0);
      expect(WorldManager.world!.revision).toBe(2);
      expect(WorldManager.world!.constructionRevision).toBe(2);
      expect(WorldManager.world!.operationsRevision).toBe(0);
      expect(WorldManager.world!.revision).toBe(
        WorldManager.world!.constructionRevision
          + WorldManager.world!.operationsRevision,
      );
    });

    it('does not mutate when the construction cursor cannot advance', () => {
      const world = WorldManager.createNew('S', 'real-terrain-alpha');
      world.constructionRevision = Number.MAX_SAFE_INTEGER;
      const before = JSON.stringify(world);

      expect(WorldManager.addStationDef({
        id: 'blocked',
        name: 'Blocked',
        trackUUID: 'abc',
        trackT: 0.5,
        passengerSpawnRate: 0.5,
      })).toBe(false);
      expect(JSON.stringify(world)).toBe(before);
    });
  });

  describe('addSceneryDef() / removeSceneryDef()', () => {
    it('advances root and construction together for add and remove', () => {
      const world = WorldManager.createNew('Scenery', 'real-terrain-alpha');
      expect(WorldManager.addSceneryDef({
        id: 'tree',
        type: 'tree_oak',
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1,
        variant: 0,
      })).toBe(true);
      expect(world.revision).toBe(1);
      expect(world.constructionRevision).toBe(1);
      expect(world.operationsRevision).toBe(0);
      expect(WorldManager.removeSceneryDef('tree')).toBe(true);
      expect(world.revision).toBe(2);
      expect(world.constructionRevision).toBe(2);
      expect(world.operationsRevision).toBe(0);
      expect(world.revision).toBe(
        world.constructionRevision + world.operationsRevision,
      );
    });
  });

  describe('train authority', () => {
    it('removes the public train mutation helpers', () => {
      expect(WorldManager).not.toHaveProperty('addTrainDef');
      expect(WorldManager).not.toHaveProperty('removeTrainDef');
      expect(WorldManager).not.toHaveProperty('updateTrainDef');
      expect(WorldManager).not.toHaveProperty('setTrainDefs');
    });

    it('changes trains only through the operations root and preserves the invariant', () => {
      const world = WorldManager.createNew('Tr', 'real-terrain-alpha');
      expect(WorldManager.addTrackDef(
        makeTrackDef('forest-sawmill-track'),
      )).toBe(true);
      const rootBefore = world.revision;

      expect(WorldManager.applyOperationsBatch(
        rootBefore,
        (draft) => {
          draft.trains.push(makeFreightTrainDef());
          return true;
        },
      )).toBe(true);
      expect(world.trains).toEqual([makeFreightTrainDef()]);
      expect(world.revision).toBe(rootBefore + 1);
      expect(world.operationsRevision).toBe(1);
      expect(world.revision).toBe(
        world.constructionRevision + world.operationsRevision,
      );
    });
  });

  describe('snapshot()', () => {
    it('captures a deep copy of current state', () => {
      WorldManager.createNew('Snap', 'real-terrain-alpha');
      WorldManager.addTrackDef(makeTrackDef('snap-track'));
      const snap = WorldManager.snapshot();
      expect(snap).not.toBeNull();
      expect(snap!.tracks).toHaveLength(1);
    });

    it('returns null when no world is loaded', () => {
      expect(WorldManager.snapshot()).toBeNull();
    });

    it('does not expose a revision-rewinding restore operation', () => {
      expect((WorldManager as any).restore).toBeUndefined();
    });

    it('is a deep copy (mutation does not affect snapshot)', () => {
      WorldManager.createNew('Deep', 'real-terrain-alpha');
      const snap = WorldManager.snapshot()!;
      WorldManager.addTrackDef(makeTrackDef('new'));
      expect(snap.tracks).toHaveLength(0);
    });
  });

  describe('updateTrackDef()', () => {
    it('updates matching track in-place', () => {
      WorldManager.createNew('U', 'real-terrain-alpha');
      WorldManager.addTrackDef(makeTrackDef('upd'));
      WorldManager.updateTrackDef(makeTrackDef('upd', { x: 99, y: 99 }));
      expect(WorldManager.world!.tracks[0].p0.x).toBe(99);
    });

    it('does nothing for unknown uuid', () => {
      WorldManager.createNew('U', 'real-terrain-alpha');
      expect(() => WorldManager.updateTrackDef(makeTrackDef('ghost'))).not.toThrow();
    });
  });
});

describe('createEmptyWorld()', () => {
  it('creates world with required fields', () => {
    const w = createEmptyWorld(
      'Mine',
      'mine-seed',
      'temperate',
      makeStarterOpportunity('mine-seed'),
    );
    expect(w.id).toBeTruthy();
    expect(w.name).toBe('Mine');
    expect(w.tracks).toEqual([]);
    expect(w.junctions).toEqual([]);
    expect(w.stations).toEqual([]);
    expect(w.trains).toEqual([]);
    expect(w).not.toHaveProperty('scenarios');
    expect(w.metadata.createdAt).toBeGreaterThan(0);
    expect(w.metadata.updatedAt).toBeGreaterThan(0);
  });

  it('deep-clones an injected economy so caller aliases cannot mutate the world', () => {
    const economy: any = {
      economyVersion: 1,
      tick: 0,
      facilities: [],
      market: {
        constructionIndexBps: 10_000,
        regionalDemandBpsByProduct: {
          logs: 10_000,
          'structural-timber': 10_000,
          'limestone-aggregate': 10_000,
          cement: 10_000,
          steel: 10_000,
          'building-modules': 10_000,
        },
      },
    };
    const world = createEmptyWorld(
      'Aliased',
      'alias-seed',
      'temperate',
      makeStarterOpportunity('alias-seed'),
      economy,
    );

    expect(world.economy).not.toBe(economy);
    expect(world.economy.market).not.toBe(economy.market);
    expect(world.economy.market.regionalDemandBpsByProduct).not.toBe(
      economy.market.regionalDemandBpsByProduct,
    );
    economy.tick = 9;
    economy.market.regionalDemandBpsByProduct.logs = 8_000;
    expect(world.economy.tick).toBe(0);
    expect(world.economy.market.regionalDemandBpsByProduct.logs).toBe(10_000);
  });

  it('deep-clones the starter opportunity so caller aliases cannot mutate the world', () => {
    const opportunity = makeStarterOpportunity('opportunity-alias-seed');
    const world = createEmptyWorld(
      'Opportunity alias',
      'opportunity-alias-seed',
      'temperate',
      opportunity,
    );
    const originalSiteX = world.starterOpportunity.sites[0].x;
    const originalWaypointX =
      world.starterOpportunity.corridors[0].waypoints[0].x;

    expect(world.starterOpportunity).not.toBe(opportunity);
    expect(world.starterOpportunity.sites).not.toBe(opportunity.sites);
    expect(world.starterOpportunity.corridors)
      .not.toBe(opportunity.corridors);
    opportunity.sites[0].x += 100;
    opportunity.corridors[0].waypoints[0].x += 100;

    expect(world.starterOpportunity.sites[0].x).toBe(originalSiteX);
    expect(world.starterOpportunity.corridors[0].waypoints[0].x)
      .toBe(originalWaypointX);
  });
});
