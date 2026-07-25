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
  const world = createEmptyWorld(
    'Schema test',
    'schema-seed',
    'alpine',
    undefined as any,
  ) as any;
  world.schemaVersion = 5;
  world.starterOpportunity = {
    opportunityVersion: 1,
    resolvedAttempt: 1,
    sites: [
      { id: 'site-a', label: 'A', x: -500, y: 0, footprintRadius: 192 },
      { id: 'site-b', label: 'B', x: 500, y: 0, footprintRadius: 192 },
    ],
    corridors: [
      {
        id: 'direct',
        waypoints: [{ x: -500, y: 0 }, { x: 500, y: 0 }],
        estimatedCost: 10_000,
        dominantTradeoff: 'short-steep',
        feasibilityWitness: {
          witnessVersion: 1,
          segments: [{
            geometry: {
              geometryVersion: 1,
              p0: { x: -500, y: 0 },
              p1: { x: -167, y: 0 },
              p2: { x: 167, y: 0 },
              p3: { x: 500, y: 0 },
            },
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
            costs: {
              track: 10_000,
              earthworks: 0,
              bridge: 0,
              tunnel: 0,
              total: 10_000,
            },
            topologyCost: 0,
          }],
          totalCost: 10_000,
        },
      },
      {
        id: 'detour',
        waypoints: [{ x: -500, y: 0 }, { x: 0, y: 500 }, { x: 500, y: 0 }],
        estimatedCost: 22_500,
        dominantTradeoff: 'long-flat',
        feasibilityWitness: {
          witnessVersion: 1,
          segments: [
            {
              geometry: {
                geometryVersion: 1,
                p0: { x: -500, y: 0 },
                p1: { x: -333, y: 0 },
                p2: { x: -167, y: 500 },
                p3: { x: 0, y: 500 },
              },
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
              costs: {
                track: 10_000,
                earthworks: 0,
                bridge: 0,
                tunnel: 0,
                total: 10_000,
              },
              topologyCost: 0,
            },
            {
              geometry: {
                geometryVersion: 1,
                p0: { x: 0, y: 500 },
                p1: { x: 167, y: 500 },
                p2: { x: 333, y: 0 },
                p3: { x: 500, y: 0 },
              },
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
              costs: {
                track: 10_000,
                earthworks: 0,
                bridge: 0,
                tunnel: 0,
                total: 10_000,
              },
              topologyCost: 2_500,
            },
          ],
          totalCost: 22_500,
        },
      },
    ],
    recommendedCamera: { x: 0, y: 0, zoom: 0.5 },
  };
  return world;
}

describe('world schema validation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('accepts schema 5 without converting or copying it', () => {
    const world = currentWorld();
    world.revision = 7;
    const result = validateWorldData(world);
    expect(result).toEqual({ compatible: true, world });
    if (result.compatible) expect(result.world).toBe(world);
  });

  it.each([
    ['missing', undefined],
    ['legacy', 1],
    ['engineering-only', 2],
    ['company-only', 3],
    ['opportunity-only', 4],
    ['unsupported', 6],
  ])('rejects a %s world schema with the new-world action', (_label, schemaVersion) => {
    const raw = { ...currentWorld(), schemaVersion };
    const result = validateWorldData(raw);
    expect(result).toEqual(expect.objectContaining({
      compatible: false,
      action: INCOMPATIBLE_WORLD_ACTION,
    }));
  });

  it.each([
    ['missing opportunity', (world: any) => { delete world.starterOpportunity; }],
    ['wrong opportunity version', (world: any) => {
      world.starterOpportunity.opportunityVersion = 2;
    }],
    ['not exactly two sites', (world: any) => {
      world.starterOpportunity.sites.pop();
    }],
    ['not exactly two corridors', (world: any) => {
      world.starterOpportunity.corridors.pop();
    }],
    ['spatially duplicate corridors', (world: any) => {
      world.starterOpportunity.corridors[1].waypoints = JSON.parse(
        JSON.stringify(world.starterOpportunity.corridors[0].waypoints),
      );
      world.starterOpportunity.corridors[1].feasibilityWitness = JSON.parse(
        JSON.stringify(
          world.starterOpportunity.corridors[0].feasibilityWitness,
        ),
      );
      world.starterOpportunity.corridors[1].estimatedCost =
        world.starterOpportunity.corridors[0].estimatedCost;
    }],
    ['out-of-bounds corridor guidance', (world: any) => {
      world.starterOpportunity.corridors[0].waypoints[0].x = 9000;
      world.starterOpportunity.corridors[0]
        .feasibilityWitness.segments[0].geometry.p0.x = 9000;
    }],
    ['estimate mismatch', (world: any) => {
      world.starterOpportunity.corridors[0].estimatedCost += 1;
    }],
    ['charged first-leg topology', (world: any) => {
      world.starterOpportunity.corridors[0]
        .feasibilityWitness.segments[0].topologyCost = 2_500;
    }],
    ['missing chained topology', (world: any) => {
      world.starterOpportunity.corridors[1]
        .feasibilityWitness.segments[1].topologyCost = 0;
    }],
    ['wrong chained topology', (world: any) => {
      world.starterOpportunity.corridors[1]
        .feasibilityWitness.segments[1].topologyCost = 2_501;
    }],
    ['invalid camera', (world: any) => {
      world.starterOpportunity.recommendedCamera.zoom = Number.NaN;
    }],
  ])('rejects schema 5 with %s', (_label, mutate) => {
    const raw = currentWorld();
    mutate(raw);
    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: INCOMPATIBLE_WORLD_ACTION,
    }));
  });

  it.each([
    ['missing company', (world: any) => { delete world.company; }],
    ['fractional cash', (world: any) => { world.company.cash = 1.5; }],
    ['negative cash', (world: any) => { world.company.cash = -1; }],
    ['unsafe cash', (world: any) => { world.company.cash = Number.MAX_SAFE_INTEGER + 1; }],
    ['extra company state', (world: any) => { world.company.ledger = []; }],
  ])('rejects schema 5 with %s', (_label, mutate) => {
    const raw = currentWorld() as any;
    mutate(raw);
    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: INCOMPATIBLE_WORLD_ACTION,
    }));
  });

  it.each([
    ['missing revision', (world: any) => { delete world.revision; }],
    ['negative revision', (world: any) => { world.revision = -1; }],
    ['fractional revision', (world: any) => { world.revision = 1.5; }],
    ['unsafe revision', (world: any) => {
      world.revision = Number.MAX_SAFE_INTEGER + 1;
    }],
  ])('rejects schema 5 with %s', (_label, mutate) => {
    const raw = currentWorld() as any;
    mutate(raw);
    expect(validateWorldData(raw).compatible).toBe(false);
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
  ])('rejects a schema-5 track missing required %s', (field) => {
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
