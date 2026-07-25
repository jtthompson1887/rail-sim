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
    });

    it('accepts a custom seed', () => {
      const w = WorldManager.createNew('Seeded', 'my-seed-123');
      expect(w.generationConfig.seed).toBe('my-seed-123');
    });

    it('creates schema 4 with deterministic company cash from the authoritative difficulty', () => {
      const w = WorldManager.createNew('Versioned', 'seed-v1', 'alpine');
      expect(w.schemaVersion).toBe(4);
      expect(w.generationConfig).toEqual({
        generationConfigVersion: 1,
        seed: 'seed-v1',
        biome: 'alpine',
        constructionDifficultyId: 'standard',
      });
      expect(w.company).toEqual({ cash: STANDARD_STARTING_CASH });
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
    });

    it('removes a station definition', () => {
      WorldManager.createNew('S', 'real-terrain-alpha');
      WorldManager.addStationDef({ id: 'rm-st', name: 'X', trackUUID: 'abc', trackT: 0, passengerSpawnRate: 0.1 });
      WorldManager.removeStationDef('rm-st');
      expect(WorldManager.world!.stations).toHaveLength(0);
    });
  });

  describe('addTrainDef() / removeTrainDef() / updateTrainDef()', () => {
    it('adds a train definition', () => {
      WorldManager.createNew('Tr', 'real-terrain-alpha');
      WorldManager.addTrainDef({ id: 'train-1', trackUUID: 'abc', trackT: 0, passengers: 0, type: 'locomotive' });
      expect(WorldManager.world!.trains).toHaveLength(1);
    });

    it('removes a train definition', () => {
      WorldManager.createNew('Tr', 'real-terrain-alpha');
      WorldManager.addTrainDef({ id: 'rm-train', trackUUID: 'abc', trackT: 0, passengers: 0, type: 'locomotive' });
      WorldManager.removeTrainDef('rm-train');
      expect(WorldManager.world!.trains).toHaveLength(0);
    });

    it('updates a train definition', () => {
      WorldManager.createNew('Tr', 'real-terrain-alpha');
      WorldManager.addTrainDef({ id: 'upd-train', trackUUID: 'abc', trackT: 0, passengers: 0, type: 'locomotive' });
      WorldManager.updateTrainDef({ id: 'upd-train', passengers: 42 });
      expect(WorldManager.world!.trains[0].passengers).toBe(42);
    });

    it('replaces all train definitions via setTrainDefs', () => {
      WorldManager.createNew('Tr', 'real-terrain-alpha');
      WorldManager.addTrainDef({ id: 'old', trackUUID: 'abc', trackT: 0, passengers: 0, type: 'locomotive' });
      WorldManager.setTrainDefs([
        { id: 'new1', trackUUID: 'x', trackT: 0.5, passengers: 5, type: 'locomotive' },
        { id: 'new2', trackUUID: 'y', trackT: 0.8, passengers: 3, type: 'locomotive' },
      ]);
      expect(WorldManager.world!.trains).toHaveLength(2);
      expect(WorldManager.world!.trains[0].id).toBe('new1');
      expect(WorldManager.world!.trains[1].id).toBe('new2');
    });

    it('setTrainDefs does nothing when no world is loaded', () => {
      WorldManager.reset();
      expect(() => WorldManager.setTrainDefs([{ id: 'x', trackUUID: 'a', trackT: 0, passengers: 0, type: 'locomotive' }])).not.toThrow();
    });
  });

  describe('snapshot() / restore()', () => {
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

    it('restores a snapshot, overwriting current state', () => {
      WorldManager.createNew('Restore', 'real-terrain-alpha');
      const snap = WorldManager.snapshot()!;
      WorldManager.addTrackDef(makeTrackDef('extra'));
      expect(WorldManager.world!.tracks).toHaveLength(1);
      WorldManager.restore(snap);
      expect(WorldManager.world!.tracks).toHaveLength(0);
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
    expect(w.scenarios).toEqual([]);
    expect(w.metadata.createdAt).toBeGreaterThan(0);
    expect(w.metadata.updatedAt).toBeGreaterThan(0);
  });
});
