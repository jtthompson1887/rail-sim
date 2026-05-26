/**
 * @jest-environment jsdom
 */

import { WorldManager } from '../../src/managers/WorldManager';
import { SaveService } from '../../src/services/SaveService';
import { createEmptyWorld } from '../../src/config/WorldData';

describe('WorldManager', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
  });

  describe('createNew()', () => {
    it('creates a world with the given name', () => {
      const world = WorldManager.createNew('Test World');
      expect(world.name).toBe('Test World');
    });

    it('generates a unique id', () => {
      const a = WorldManager.createNew('A');
      WorldManager.reset();
      const b = WorldManager.createNew('B');
      expect(a.id).not.toBe(b.id);
    });

    it('sets loaded = true', () => {
      WorldManager.createNew('W');
      expect(WorldManager.loaded).toBe(true);
    });

    it('initialises with empty tracks, junctions, stations, trains', () => {
      const w = WorldManager.createNew('Empty');
      expect(w.tracks).toHaveLength(0);
      expect(w.junctions).toHaveLength(0);
      expect(w.stations).toHaveLength(0);
      expect(w.trains).toHaveLength(0);
    });

    it('accepts a custom seed', () => {
      const w = WorldManager.createNew('Seeded', 'my-seed-123');
      expect(w.seed).toBe('my-seed-123');
    });
  });

  describe('reset()', () => {
    it('unloads the current world', () => {
      WorldManager.createNew('X');
      WorldManager.reset();
      expect(WorldManager.loaded).toBe(false);
      expect(WorldManager.world).toBeNull();
    });

    it('currentWorldId becomes null after reset', () => {
      WorldManager.createNew('X');
      WorldManager.reset();
      expect(WorldManager.currentWorldId).toBeNull();
    });
  });

  describe('save() / load()', () => {
    it('saves and reloads the world', () => {
      const created = WorldManager.createNew('Persist');
      WorldManager.save();
      WorldManager.reset();
      const loaded = WorldManager.load(created.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('Persist');
    });

    it('returns null for unknown id', () => {
      expect(WorldManager.load('no-such-id')).toBeNull();
    });

    it('sets currentWorldId after loading', () => {
      const w = WorldManager.createNew('W2');
      WorldManager.save();
      WorldManager.reset();
      WorldManager.load(w.id);
      expect(WorldManager.currentWorldId).toBe(w.id);
    });
  });

  describe('addTrackDef() / removeTrackDef()', () => {
    it('adds a track definition', () => {
      WorldManager.createNew('T');
      WorldManager.addTrackDef({ uuid: 'abc', p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 2, y: 0 }, p3: { x: 3, y: 0 } });
      expect(WorldManager.world!.tracks).toHaveLength(1);
    });

    it('removes a track definition by uuid', () => {
      WorldManager.createNew('T');
      WorldManager.addTrackDef({ uuid: 'rm-me', p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 2, y: 0 }, p3: { x: 3, y: 0 } });
      WorldManager.removeTrackDef('rm-me');
      expect(WorldManager.world!.tracks).toHaveLength(0);
    });

    it('does nothing when no world is loaded', () => {
      expect(() => WorldManager.addTrackDef({ uuid: 'x', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } })).not.toThrow();
    });
  });

  describe('addJunctionDef() / removeJunctionDef()', () => {
    it('adds a junction definition', () => {
      WorldManager.createNew('J');
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
      WorldManager.createNew('J');
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
      WorldManager.createNew('S');
      WorldManager.addStationDef({ id: 'st-1', name: 'Central', trackUUID: 'abc', trackT: 0.5, passengerSpawnRate: 0.5 });
      expect(WorldManager.world!.stations).toHaveLength(1);
    });

    it('removes a station definition', () => {
      WorldManager.createNew('S');
      WorldManager.addStationDef({ id: 'rm-st', name: 'X', trackUUID: 'abc', trackT: 0, passengerSpawnRate: 0.1 });
      WorldManager.removeStationDef('rm-st');
      expect(WorldManager.world!.stations).toHaveLength(0);
    });
  });

  describe('addTrainDef() / removeTrainDef() / updateTrainDef()', () => {
    it('adds a train definition', () => {
      WorldManager.createNew('Tr');
      WorldManager.addTrainDef({ id: 'train-1', trackUUID: 'abc', trackT: 0, passengers: 0 });
      expect(WorldManager.world!.trains).toHaveLength(1);
    });

    it('removes a train definition', () => {
      WorldManager.createNew('Tr');
      WorldManager.addTrainDef({ id: 'rm-train', trackUUID: 'abc', trackT: 0, passengers: 0 });
      WorldManager.removeTrainDef('rm-train');
      expect(WorldManager.world!.trains).toHaveLength(0);
    });

    it('updates a train definition', () => {
      WorldManager.createNew('Tr');
      WorldManager.addTrainDef({ id: 'upd-train', trackUUID: 'abc', trackT: 0, passengers: 0 });
      WorldManager.updateTrainDef({ id: 'upd-train', passengers: 42 });
      expect(WorldManager.world!.trains[0].passengers).toBe(42);
    });
  });

  describe('snapshot() / restore()', () => {
    it('captures a deep copy of current state', () => {
      WorldManager.createNew('Snap');
      WorldManager.addTrackDef({ uuid: 'snap-track', p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 2, y: 0 }, p3: { x: 3, y: 0 } });
      const snap = WorldManager.snapshot();
      expect(snap).not.toBeNull();
      expect(snap!.tracks).toHaveLength(1);
    });

    it('returns null when no world is loaded', () => {
      expect(WorldManager.snapshot()).toBeNull();
    });

    it('restores a snapshot, overwriting current state', () => {
      WorldManager.createNew('Restore');
      const snap = WorldManager.snapshot()!;
      WorldManager.addTrackDef({ uuid: 'extra', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } });
      expect(WorldManager.world!.tracks).toHaveLength(1);
      WorldManager.restore(snap);
      expect(WorldManager.world!.tracks).toHaveLength(0);
    });

    it('is a deep copy (mutation does not affect snapshot)', () => {
      WorldManager.createNew('Deep');
      const snap = WorldManager.snapshot()!;
      WorldManager.addTrackDef({ uuid: 'new', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } });
      expect(snap.tracks).toHaveLength(0);
    });
  });

  describe('updateTrackDef()', () => {
    it('updates matching track in-place', () => {
      WorldManager.createNew('U');
      WorldManager.addTrackDef({ uuid: 'upd', p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 2, y: 0 }, p3: { x: 3, y: 0 } });
      WorldManager.updateTrackDef({ uuid: 'upd', p0: { x: 99, y: 99 }, p1: { x: 1, y: 0 }, p2: { x: 2, y: 0 }, p3: { x: 3, y: 0 } });
      expect(WorldManager.world!.tracks[0].p0.x).toBe(99);
    });

    it('does nothing for unknown uuid', () => {
      WorldManager.createNew('U');
      expect(() => WorldManager.updateTrackDef({ uuid: 'ghost', p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } })).not.toThrow();
    });
  });
});

describe('createEmptyWorld()', () => {
  it('creates world with required fields', () => {
    const w = createEmptyWorld('Mine');
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
