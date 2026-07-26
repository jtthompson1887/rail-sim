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
import { createCompanyState } from '../../src/economy/FinanceLedger';

const NEUTRAL_MARKET = {
  constructionIndexBps: 10_000,
  regionalDemandBpsByProduct: {
    logs: 10_000,
    'structural-timber': 10_000,
    'limestone-aggregate': 10_000,
    cement: 10_000,
    steel: 10_000,
    'building-modules': 10_000,
  },
};

function makeFacility() {
  return {
    id: 'forest-a',
    definitionId: 'managed-forest',
    name: 'North Managed Forest',
    x: -125.5,
    y: 48.25,
    railAccess: { x: -100.5, y: 48.25, radius: 32.5 },
    inventories: {
      logs: {
        productId: 'logs',
        quantity: 60,
        reservedQuantity: 0,
        capacity: 240,
        recentInflow: 0,
        recentOutflow: 0,
        targetStock: 120,
      },
    },
    activeRecipeId: 'forest-harvest',
    recipeProgressTicks: 0,
  };
}

function currentWorld() {
  const world = createEmptyWorld(
    'Schema test',
    'schema-seed',
    'alpine',
    undefined as any,
  ) as any;
  world.schemaVersion = 6;
  world.revision = 0;
  world.constructionRevision = 0;
  world.economyRevision = 0;
  world.company = JSON.parse(JSON.stringify(createCompanyState(1_000_000)));
  world.economy = {
    economyVersion: 1,
    tick: 0,
    facilities: [],
    market: JSON.parse(JSON.stringify(NEUTRAL_MARKET)),
  };
  delete world.scenarios;
  world.starterOpportunity = {
    opportunityVersion: 1,
    resolvedAttempt: 1,
    sites: [
      {
        id: 'managed-forest',
        label: 'Managed Forest',
        x: -500,
        y: 0,
        footprintRadius: 192,
      },
      {
        id: 'sawmill',
        label: 'Sawmill',
        x: 500,
        y: 0,
        footprintRadius: 192,
      },
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

  it('round-trips schema 6 with an empty valid economy without converting or copying it', () => {
    const world = currentWorld();
    world.revision = 7;
    world.constructionRevision = 3;
    world.economyRevision = 4;
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
    ['schema-five', 5],
    ['unsupported', 7],
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
  ])('rejects schema 6 with %s', (_label, mutate) => {
    const raw = currentWorld();
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
    ['missing construction revision', (world: any) => {
      delete world.constructionRevision;
    }],
    ['negative construction revision', (world: any) => {
      world.constructionRevision = -1;
    }],
    ['fractional construction revision', (world: any) => {
      world.constructionRevision = 1.5;
    }],
    ['unsafe construction revision', (world: any) => {
      world.constructionRevision = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['missing economy revision', (world: any) => {
      delete world.economyRevision;
    }],
    ['negative economy revision', (world: any) => {
      world.economyRevision = -1;
    }],
    ['fractional economy revision', (world: any) => {
      world.economyRevision = 1.5;
    }],
    ['unsafe economy revision', (world: any) => {
      world.economyRevision = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['domain revisions ahead of root revision', (world: any) => {
      world.revision = 1;
      world.constructionRevision = 1;
      world.economyRevision = 1;
    }],
    ['domain revision sum overflowing the root relation', (world: any) => {
      world.revision = Number.MAX_SAFE_INTEGER;
      world.constructionRevision = Number.MAX_SAFE_INTEGER;
      world.economyRevision = 1;
    }],
  ])('rejects schema 6 with %s', (_label, mutate) => {
    const raw = currentWorld() as any;
    mutate(raw);
    expect(validateWorldData(raw).compatible).toBe(false);
  });

  it.each([
    ['missing economy', (world: any) => { delete world.economy; }],
    ['wrong economy version', (world: any) => {
      world.economy.economyVersion = 2;
    }],
    ['negative tick', (world: any) => { world.economy.tick = -1; }],
    ['fractional tick', (world: any) => { world.economy.tick = 0.5; }],
    ['unsafe tick', (world: any) => {
      world.economy.tick = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['duplicate facility IDs', (world: any) => {
      world.economy.facilities = [makeFacility(), makeFacility()];
    }],
    ['unknown facility definition', (world: any) => {
      const facility = makeFacility();
      facility.definitionId = 'unknown-definition';
      world.economy.facilities = [facility];
    }],
    ['unknown inventory product', (world: any) => {
      const facility: any = makeFacility();
      facility.inventories.mystery = {
        ...facility.inventories.logs,
        productId: 'mystery',
      };
      world.economy.facilities = [facility];
    }],
    ['inventory key/product mismatch', (world: any) => {
      const facility = makeFacility();
      facility.inventories.logs.productId = 'steel';
      world.economy.facilities = [facility];
    }],
    ['unsafe inventory quantity', (world: any) => {
      const facility = makeFacility();
      facility.inventories.logs.quantity = Number.MAX_SAFE_INTEGER + 1;
      world.economy.facilities = [facility];
    }],
    ['reserved stock above quantity', (world: any) => {
      const facility = makeFacility();
      facility.inventories.logs.reservedQuantity = 61;
      world.economy.facilities = [facility];
    }],
    ['stock above capacity', (world: any) => {
      const facility = makeFacility();
      facility.inventories.logs.quantity = 241;
      world.economy.facilities = [facility];
    }],
    ['target stock above capacity', (world: any) => {
      const facility = makeFacility();
      facility.inventories.logs.targetStock = 241;
      world.economy.facilities = [facility];
    }],
    ['invalid rail access coordinate', (world: any) => {
      const facility = makeFacility();
      facility.railAccess.x = Number.NaN;
      world.economy.facilities = [facility];
    }],
    ['non-positive rail access radius', (world: any) => {
      const facility = makeFacility();
      facility.railAccess.radius = 0;
      world.economy.facilities = [facility];
    }],
    ['recipe incompatible with facility definition', (world: any) => {
      const facility = makeFacility();
      facility.activeRecipeId = 'cement-kiln';
      world.economy.facilities = [facility];
    }],
    ['progress outside active recipe bounds', (world: any) => {
      const facility = makeFacility();
      facility.recipeProgressTicks = 4;
      world.economy.facilities = [facility];
    }],
    ['idle facility with non-zero progress', (world: any) => {
      const facility = makeFacility();
      facility.activeRecipeId = null;
      facility.recipeProgressTicks = 1;
      world.economy.facilities = [facility];
    }],
    ['market missing a product factor', (world: any) => {
      delete world.economy.market.regionalDemandBpsByProduct.logs;
    }],
    ['market has an extra product factor', (world: any) => {
      world.economy.market.regionalDemandBpsByProduct.mystery = 10_000;
    }],
    ['construction index below its bound', (world: any) => {
      world.economy.market.constructionIndexBps = 8_499;
    }],
    ['regional factor above its bound', (world: any) => {
      world.economy.market.regionalDemandBpsByProduct.logs = 12_001;
    }],
  ])('rejects schema 6 with %s', (_label, mutate) => {
    const raw = currentWorld() as any;
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
    ['unsafe cash', (world: any) => {
      world.company.cash = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['non-sequential ledger id', (world: any) => {
      world.company.ledger[0].id = 2;
    }],
    ['invalid next ledger id', (world: any) => {
      world.company.nextLedgerId = 3;
    }],
    ['wrong category class', (world: any) => {
      world.company.ledger[0].ledgerClass = 'revenue';
    }],
    ['wrong forward sign', (world: any) => {
      world.company.ledger.push({
        id: 2,
        tick: 0,
        category: 'construction-capex',
        ledgerClass: 'capital-expenditure',
        amount: 1,
        referenceId: 'track-a',
      });
      world.company.nextLedgerId = 3;
      world.company.cash += 1;
    }],
    ['invalid reversal policy', (world: any) => {
      world.company.ledger.push({
        id: 2,
        tick: 0,
        category: 'construction-capex',
        ledgerClass: 'capital-expenditure',
        amount: -100,
        referenceId: 'track-a',
      }, {
        id: 3,
        tick: 0,
        category: 'construction-capex',
        ledgerClass: 'capital-expenditure',
        amount: 99,
        referenceId: 'track-a',
        reversalOf: 2,
      });
      world.company.nextLedgerId = 4;
      world.company.cash -= 1;
    }],
    ['ledger cash mismatch', (world: any) => {
      world.company.cash -= 1;
    }],
  ])('rejects schema 6 company state with %s', (_label, mutate) => {
    const raw = currentWorld() as any;
    mutate(raw);
    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: INCOMPATIBLE_WORLD_ACTION,
    }));
  });

  it('accepts finite decimal facility and rail-access geometry', () => {
    const raw = currentWorld() as any;
    raw.economy.facilities = [makeFacility()];
    expect(validateWorldData(raw)).toEqual({ compatible: true, world: raw });
  });

  it('rejects scenarios as removed schema-6 state', () => {
    const raw = currentWorld() as any;
    raw.scenarios = [];
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
  ])('rejects a schema-6 track missing required %s', (field) => {
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
