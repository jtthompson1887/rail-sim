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
import {
  createCompanyState,
  postLedgerEntry,
} from '../../src/economy/FinanceLedger';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

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
  world.schemaVersion = 9;
  world.revision = 0;
  world.constructionRevision = 0;
  world.operationsRevision = 0;
  delete world.economyRevision;
  world.freightProgress = {
    progressVersion: 1,
    profitableLogDeliveryCompleted: false,
    developmentGrantAwarded: false,
    profitableStructuralTimberDeliveryCompleted: false,
    profitableLimestoneDeliveryCompleted: false,
    profitableCementDeliveryCompleted: false,
  };
  delete world.firstRouteProgress;
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

function worldWithTrain() {
  return makeFirstFreightRouteWorld() as any;
}

describe('world schema validation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates the exact empty schema-9 freight progress authority', () => {
    const world = createEmptyWorld(
      'Freight',
      'seed',
      'temperate',
      currentWorld().starterOpportunity,
    ) as any;

    expect(world).toMatchObject({
      schemaVersion: 9,
      revision: 0,
      constructionRevision: 0,
      operationsRevision: 0,
      trains: [],
      freightProgress: {
        progressVersion: 1,
        profitableLogDeliveryCompleted: false,
        developmentGrantAwarded: false,
        profitableStructuralTimberDeliveryCompleted: false,
        profitableLimestoneDeliveryCompleted: false,
        profitableCementDeliveryCompleted: false,
      },
    });
    expect(world.freightProgress).toEqual({
      progressVersion: 1,
      profitableLogDeliveryCompleted: false,
      developmentGrantAwarded: false,
      profitableStructuralTimberDeliveryCompleted: false,
      profitableLimestoneDeliveryCompleted: false,
      profitableCementDeliveryCompleted: false,
    });
    expect(world).not.toHaveProperty('firstRouteProgress');
  });

  it('round-trips schema 9 with exact construction and operations revisions', () => {
    const world = currentWorld();
    world.revision = 7;
    world.constructionRevision = 3;
    world.operationsRevision = 4;
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
    ['schema-six', 6],
    ['schema-seven', 7],
    ['schema-eight', 8],
    ['unsupported', 10],
  ])('rejects a %s world schema with the new-world action', (_label, schemaVersion) => {
    const raw = { ...currentWorld(), schemaVersion };
    const result = validateWorldData(raw);
    expect(result).toEqual(expect.objectContaining({
      compatible: false,
      action: INCOMPATIBLE_WORLD_ACTION,
    }));
  });

  it('rejects an own deprecated economyRevision authority', () => {
    const raw = currentWorld();
    raw.economyRevision = 0;

    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: INCOMPATIBLE_WORLD_ACTION,
    }));
  });

  it('rejects the deprecated firstRouteProgress authority on schema 9', () => {
    const raw = currentWorld();
    raw.firstRouteProgress = {
      objectiveVersion: 1,
      profitableDeliveryCompleted: false,
    };

    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
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
  ])('rejects schema 8 with %s', (_label, mutate) => {
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
    ['missing operations revision', (world: any) => {
      delete world.operationsRevision;
    }],
    ['negative operations revision', (world: any) => {
      world.operationsRevision = -1;
    }],
    ['fractional operations revision', (world: any) => {
      world.operationsRevision = 1.5;
    }],
    ['unsafe operations revision', (world: any) => {
      world.operationsRevision = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['domain revisions below the exact root revision', (world: any) => {
      world.revision = 3;
      world.constructionRevision = 1;
      world.operationsRevision = 1;
    }],
    ['domain revision sum overflowing the root relation', (world: any) => {
      world.revision = Number.MAX_SAFE_INTEGER;
      world.constructionRevision = Number.MAX_SAFE_INTEGER;
      world.operationsRevision = 1;
    }],
  ])('rejects schema 8 with %s', (_label, mutate) => {
    const raw = currentWorld() as any;
    mutate(raw);
    expect(validateWorldData(raw).compatible).toBe(false);
  });

  it('requires the awarded grant latch to have exactly one canonical forward ledger entry', () => {
    const raw = currentWorld();
    raw.freightProgress.profitableLogDeliveryCompleted = true;
    raw.freightProgress.developmentGrantAwarded = true;

    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: 'Start a new world.',
    }));

    const posted = postLedgerEntry(raw.company, {
      category: 'contract-bonus',
      magnitude: 250_000,
      tick: 7,
      referenceId: 'regional-development-grant:v1',
      direction: 'forward',
    });
    if (posted.ok === false) throw new Error(posted.code);
    raw.company = JSON.parse(JSON.stringify(posted.company));

    expect(validateWorldData(raw)).toEqual({ compatible: true, world: raw });

    const reversal = postLedgerEntry(raw.company, {
      category: 'contract-bonus',
      magnitude: 250_000,
      tick: 8,
      referenceId: 'regional-development-grant:v1',
      direction: 'reversal',
      reversalOf: posted.entry.id,
    });
    if (reversal.ok === false) throw new Error(reversal.code);
    raw.company = JSON.parse(JSON.stringify(reversal.company));

    expect(validateWorldData(raw)).toEqual({ compatible: true, world: raw });

    const duplicate = postLedgerEntry(raw.company, {
      category: 'contract-bonus',
      magnitude: 250_000,
      tick: 9,
      referenceId: 'regional-development-grant:v1',
      direction: 'forward',
    });
    if (duplicate.ok === false) throw new Error(duplicate.code);
    raw.company = JSON.parse(JSON.stringify(duplicate.company));

    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: 'Start a new world.',
    }));
  });

  it('rejects a canonical grant entry while the awarded latch is false', () => {
    const raw = currentWorld();
    const posted = postLedgerEntry(raw.company, {
      category: 'contract-bonus',
      magnitude: 250_000,
      tick: 7,
      referenceId: 'regional-development-grant:v1',
      direction: 'forward',
    });
    if (posted.ok === false) throw new Error(posted.code);
    raw.company = JSON.parse(JSON.stringify(posted.company));

    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: 'Start a new world.',
    }));
  });

  it('does not count unrelated contract bonuses as the development grant', () => {
    let company = currentWorld().company;
    for (const request of [
      {
        category: 'contract-bonus' as const,
        magnitude: 249_999,
        referenceId: 'regional-development-grant:v1',
      },
      {
        category: 'contract-bonus' as const,
        magnitude: 250_000,
        referenceId: 'regional-development-grant:v2',
      },
      {
        category: 'contract-bonus' as const,
        magnitude: 250_000,
        referenceId: 'town-contract:v1',
      },
      {
        category: 'delivery-revenue' as const,
        magnitude: 250_000,
        referenceId: 'regional-development-grant:v1',
      },
    ]) {
      const posted = postLedgerEntry(company, {
        tick: 7,
        direction: 'forward',
        ...request,
      });
      if (posted.ok === false) throw new Error(posted.code);
      company = JSON.parse(JSON.stringify(posted.company));
    }
    const raw = currentWorld();
    raw.company = company;

    expect(validateWorldData(raw)).toEqual({ compatible: true, world: raw });
  });

  it.each([
    ['missing progress', (world: any) => { delete world.freightProgress; }],
    ['wrong progress version', (world: any) => {
      world.freightProgress.progressVersion = 2;
    }],
    ['non-boolean log-delivery latch', (world: any) => {
      world.freightProgress.profitableLogDeliveryCompleted = 0;
    }],
    ['non-boolean grant latch', (world: any) => {
      world.freightProgress.developmentGrantAwarded = 0;
    }],
    ['non-boolean structural-timber latch', (world: any) => {
      world.freightProgress.profitableStructuralTimberDeliveryCompleted = 0;
    }],
    ['non-boolean limestone latch', (world: any) => {
      world.freightProgress.profitableLimestoneDeliveryCompleted = 0;
    }],
    ['non-boolean cement latch', (world: any) => {
      world.freightProgress.profitableCementDeliveryCompleted = 0;
    }],
    ['unexpected progress key', (world: any) => {
      world.freightProgress.speculativeProgress = false;
    }],
  ])('rejects schema 9 with %s', (_label, mutate) => {
    const raw = currentWorld() as any;
    mutate(raw);
    expect(validateWorldData(raw)).toEqual(expect.objectContaining({
      compatible: false,
      action: 'Start a new world.',
    }));
  });

  it('accepts a referenced empty freight train without materialising cargo', () => {
    const raw = worldWithTrain();

    expect(validateWorldData(raw)).toEqual({ compatible: true, world: raw });
    expect(raw.trains[0].cargo).toBeNull();
  });

  it('accepts compatible cargo up to the freight set derived capacity', () => {
    const raw = worldWithTrain();
    raw.trains[0].cargo = {
      productId: 'logs',
      units: 60,
      loadedUnits: 60,
      originFacilityId: 'managed-forest',
    };

    expect(validateWorldData(raw)).toEqual({ compatible: true, world: raw });
  });

  it.each([
    ['empty train ID', (world: any) => { world.trains[0].id = '  '; }],
    ['duplicate train ID', (world: any) => {
      world.trains.push(makeFreightTrainDef({ trackT: 0.2 }));
    }],
    ['unknown freight set', (world: any) => {
      world.trains[0].freightSetId = 'missing-set';
    }],
    ['unknown track', (world: any) => {
      world.trains[0].trackUUID = 'missing-track';
    }],
    ['negative track position', (world: any) => {
      world.trains[0].trackT = -0.01;
    }],
    ['track position above one', (world: any) => {
      world.trains[0].trackT = 1.01;
    }],
    ['non-finite track position', (world: any) => {
      world.trains[0].trackT = Number.NaN;
    }],
    ['invalid facing', (world: any) => { world.trains[0].facing = 0; }],
    ['legacy type authority', (world: any) => {
      world.trains[0].type = 'locomotive';
    }],
    ['legacy passengers authority', (world: any) => {
      world.trains[0].passengers = 0;
    }],
  ])('rejects a freight train with %s', (_label, mutate) => {
    const raw = worldWithTrain();
    mutate(raw);
    expect(validateWorldData(raw).compatible).toBe(false);
  });

  it.each([
    ['unknown product', (cargo: any) => { cargo.productId = 'mystery'; }],
    ['incompatible product', (cargo: any) => {
      cargo.productId = 'cement';
    }],
    ['unknown origin facility', (cargo: any) => {
      cargo.originFacilityId = 'missing-facility';
    }],
    ['zero units', (cargo: any) => { cargo.units = 0; }],
    ['negative units', (cargo: any) => { cargo.units = -1; }],
    ['fractional units', (cargo: any) => { cargo.units = 1.5; }],
    ['unsafe units', (cargo: any) => {
      cargo.units = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['units above derived capacity', (cargo: any) => { cargo.units = 61; }],
    ['missing loaded units', (cargo: any) => {
      delete cargo.loadedUnits;
    }],
    ['zero loaded units', (cargo: any) => { cargo.loadedUnits = 0; }],
    ['fractional loaded units', (cargo: any) => {
      cargo.loadedUnits = 1.5;
    }],
    ['unsafe loaded units', (cargo: any) => {
      cargo.loadedUnits = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['loaded units below remaining units', (cargo: any) => {
      cargo.units = 2;
      cargo.loadedUnits = 1;
    }],
    ['loaded units above derived capacity', (cargo: any) => {
      cargo.loadedUnits = 61;
    }],
  ])('rejects freight cargo with %s', (_label, mutate) => {
    const raw = worldWithTrain();
    const cargo = {
      productId: 'logs',
      units: 1,
      loadedUnits: 1,
      originFacilityId: 'managed-forest',
    };
    mutate(cargo);
    raw.trains[0].cargo = cargo;
    expect(validateWorldData(raw).compatible).toBe(false);
  });

  it.each([
    'currentTripRevenue',
    'currentTripRunningCost',
    'lastTripRevenue',
    'lastTripRunningCost',
    'lifetimeDeliveredUnits',
    'lifetimeRevenue',
    'lifetimeRunningCost',
  ])('rejects a negative, fractional, unsafe, or missing %s total', (field) => {
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      const raw = worldWithTrain();
      raw.trains[0].operations[field] = invalid;
      expect(validateWorldData(raw).compatible).toBe(false);
    }
  });

  it.each([
    ['current revenue above lifetime', {
      currentTripRevenue: 2,
      lifetimeRevenue: 1,
    }],
    ['last revenue above lifetime', {
      lastTripRevenue: 2,
      lifetimeRevenue: 1,
    }],
    ['current running cost above lifetime', {
      currentTripRunningCost: 2,
      lifetimeRunningCost: 1,
    }],
    ['last running cost above lifetime', {
      lastTripRunningCost: 2,
      lifetimeRunningCost: 1,
    }],
  ])('rejects operations with %s', (_label, operations) => {
    const raw = worldWithTrain();
    Object.assign(raw.trains[0].operations, operations);
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
    ['duplicate facility definition IDs', (world: any) => {
      const first = makeFacility();
      const second = makeFacility();
      second.id = 'forest-b';
      world.economy.facilities = [first, second];
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
  ])('rejects schema 8 with %s', (_label, mutate) => {
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
  ])('rejects schema 8 company state with %s', (_label, mutate) => {
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

  it('rejects scenarios as removed schema-8 state', () => {
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
  ])('rejects a schema-8 track missing required %s', (field) => {
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
    ['negative paid cost', (track: any) => { track.paidBuildCost = -1; }],
    ['unsafe paid cost', (track: any) => {
      track.paidBuildCost = Number.MAX_SAFE_INTEGER + 1;
    }],
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

  it('accepts the maximum safe integer as a paid build cost', () => {
    const raw = currentWorld() as any;
    raw.tracks.push({
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
      paidBuildCost: Number.MAX_SAFE_INTEGER,
    });

    expect(validateWorldData(raw)).toEqual({ compatible: true, world: raw });
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
    const incompatible = { ...currentWorld(), schemaVersion: 8 };
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
    const incompatible = { ...currentWorld(), schemaVersion: 8 };
    expect(SaveService.importWorld(JSON.stringify(incompatible))).toBeNull();
    expect(SaveService.loadAllWorlds()).toEqual({});
  });
});
