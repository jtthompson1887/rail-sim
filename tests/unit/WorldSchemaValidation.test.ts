/**
 * @jest-environment jsdom
 */
import * as WorldDataModule from '../../src/config/WorldData';
import {
  createEmptyWorld,
  INCOMPATIBLE_WORLD_ACTION,
  validateWorldData,
} from '../../src/config/WorldData';
import { GameConfig } from '../../src/config/GameConfig';
import { SaveService } from '../../src/services/SaveService';

function currentWorld() {
  return createEmptyWorld('Schema test', 'schema-seed', 'alpine');
}

describe('world schema validation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('accepts schema 2 without converting or copying it', () => {
    const world = currentWorld();
    const result = validateWorldData(world);
    expect(result).toEqual({ compatible: true, world });
    if (result.compatible) expect(result.world).toBe(world);
  });

  it.each([
    ['missing', undefined],
    ['legacy', 1],
    ['unsupported', 3],
  ])('rejects a %s world schema with the new-world action', (_label, schemaVersion) => {
    const raw = { ...currentWorld(), schemaVersion };
    const result = validateWorldData(raw);
    expect(result).toEqual(expect.objectContaining({
      compatible: false,
      action: INCOMPATIBLE_WORLD_ACTION,
    }));
  });

  it.each([
    ['missing', undefined],
    ['unsupported', 2],
  ])('rejects a track with a %s geometry schema', (_label, geometryVersion) => {
    const raw = currentWorld() as any;
    raw.tracks.push({
      geometryVersion,
      uuid: 'track-1',
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 0 },
      p2: { x: 200, y: 0 },
      p3: { x: 300, y: 0 },
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
      paidBuildCost: 100,
    });
    const result = validateWorldData(raw);
    expect(result).toEqual(expect.objectContaining({
      compatible: false,
      action: 'Start a new world.',
    }));
  });

  it.each([
    ['verticalProfile'],
    ['structures'],
    ['paidBuildCost'],
  ])('rejects a schema-2 track missing required %s', (field) => {
    const raw = currentWorld() as any;
    const track: any = {
      geometryVersion: 1,
      uuid: 'track-1',
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 0 },
      p2: { x: 200, y: 0 },
      p3: { x: 300, y: 0 },
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
      paidBuildCost: 100,
    };
    delete track[field];
    raw.tracks.push(track);

    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: 'Start a new world.',
    }));
  });

  it.each([
    ['fractional paid cost', (track: any) => { track.paidBuildCost = 100.5; }],
    ['profile-inconsistent structure elevation', (track: any) => {
      track.structures[0].endElevation = 5;
    }],
  ])('rejects a track with %s', (_label, mutate) => {
    const raw = currentWorld() as any;
    const track: any = {
      geometryVersion: 1,
      uuid: 'track-1',
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 0 },
      p2: { x: 200, y: 0 },
      p3: { x: 300, y: 0 },
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
      paidBuildCost: 100,
    };
    mutate(track);
    raw.tracks.push(track);

    expect(validateWorldData(raw).compatible).toBe(false);
  });

  it('rejects unsupported generation configuration versions', () => {
    const raw = currentWorld() as any;
    raw.generationConfig.generationConfigVersion = 2;
    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: 'Start a new world.',
    }));
  });

  it('rejects legacy root generation authorities', () => {
    const raw = { ...currentWorld(), seed: 'duplicate-authority' };
    expect(validateWorldData(raw).compatible).toBe(false);
  });

  it('does not expose a migration or conversion function', () => {
    expect((WorldDataModule as any).migrateWorld).toBeUndefined();
  });

  it('preserves incompatible saves as structured picker results without loading them', () => {
    const incompatible = { ...currentWorld(), schemaVersion: 9 };
    localStorage.setItem(
      GameConfig.WORLD.WORLDS_SAVE_KEY,
      JSON.stringify({ [incompatible.id]: incompatible }),
    );

    expect(SaveService.loadWorld(incompatible.id)).toBeNull();
    expect(SaveService.loadWorldResult(incompatible.id)).toEqual(expect.objectContaining({
      compatible: false,
      action: 'Start a new world.',
    }));
    expect(SaveService.listWorldResults()).toEqual([
      expect.objectContaining({
        compatible: false,
        action: 'Start a new world.',
      }),
    ]);
  });

  it('rejects a valid world stored under a key that differs from its embedded id', () => {
    const world = currentWorld();
    const storageId = 'actual-storage-key';
    localStorage.setItem(
      GameConfig.WORLD.WORLDS_SAVE_KEY,
      JSON.stringify({ [storageId]: world }),
    );

    expect(SaveService.loadWorld(storageId)).toBeNull();
    expect(SaveService.loadWorld(world.id)).toBeNull();
    expect(SaveService.listWorlds()).toEqual([]);
    expect(SaveService.listWorldResults()).toEqual([
      expect.objectContaining({
        compatible: false,
        id: world.id,
        storageId,
        action: 'Start a new world.',
      }),
    ]);
  });

  it('refuses to import or persist incompatible input', () => {
    const incompatible = { ...currentWorld(), schemaVersion: 9 };
    expect(SaveService.importWorld(JSON.stringify(incompatible))).toBeNull();
    expect(SaveService.loadAllWorlds()).toEqual({});
  });
});
