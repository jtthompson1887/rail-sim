import { buildFacilityInspection } from '../../src/economy/FacilityPresentation';
import { WorldManager } from '../../src/managers/WorldManager';

describe('FacilityPresentation', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
  });

  it('explains the active cement recipe, full hopper conversion, and input quote', () => {
    const created = WorldManager.tryCreateNew(
      'Cement presentation',
      'cement-presentation-seed',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const cementWorks = created.world.economy.facilities.find(
      ({ id }) => id === 'cement-works',
    );
    if (!cementWorks) throw new Error('cement works missing');
    cementWorks.recipeProgressTicks = 2;
    cementWorks.inventories['limestone-aggregate'].quantity = 120;
    created.world.economy.market.constructionIndexBps = 10_000;
    created.world.economy.market.regionalDemandBpsByProduct[
      'limestone-aggregate'
    ] = 10_000;

    const dto = buildFacilityInspection(
      created.world,
      'cement-works',
      true,
    );

    expect(dto).toMatchObject({
      status: { code: 'working', label: 'Working 2 / 4 ticks' },
      activeRecipe: {
        id: 'cement-kiln',
        displayName: 'Cement kiln',
        cycleTicks: 4,
        progressTicks: 2,
        inputs: [{
          productId: 'limestone-aggregate',
          displayName: 'Limestone Aggregate',
          unitLabel: 'tonne',
          quantity: 12,
        }],
        outputs: [{
          productId: 'cement',
          displayName: 'Cement',
          unitLabel: 'tonne',
          quantity: 8,
        }],
        fullLoad: {
          freightSetId: 'aggregate-hopper-set',
          freightSetDisplayName: 'Aggregate Hopper Set',
          inputQuantity: 120,
          outputQuantity: 80,
          cycles: 10,
        },
      },
      quotes: [{
        productId: 'limestone-aggregate',
        displayName: 'Limestone Aggregate',
        unitLabel: 'tonne',
        unitPrice: 45,
        fullLoadQuantity: 120,
        fullLoadGross: 5_400,
        factors: [
          { id: 'global-construction', basisPoints: 10_000 },
          { id: 'regional-demand', basisPoints: 10_000 },
          { id: 'inventory-pressure', basisPoints: 10_000 },
        ],
      }],
    });
    expect(Object.isFrozen(dto)).toBe(true);
    expect(Object.isFrozen(dto?.activeRecipe)).toBe(true);
    expect(Object.isFrozen(dto?.activeRecipe?.inputs)).toBe(true);
    expect(Object.isFrozen(dto?.activeRecipe?.fullLoad)).toBe(true);
    expect(Object.isFrozen(dto?.quotes[0])).toBe(true);
  });

  it('does not invent a recipe for an idle interchange and keeps prefab units', () => {
    const created = WorldManager.tryCreateNew(
      'Idle presentation',
      'idle-presentation-seed',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(buildFacilityInspection(
      created.world,
      'port-interchange',
      true,
    )).toMatchObject({
      activeRecipe: null,
      quotes: [],
    });
    expect(buildFacilityInspection(
      created.world,
      'prefabrication-plant',
      true,
    )?.activeRecipe).toMatchObject({
      displayName: 'Module assembly',
      inputs: [
        { displayName: 'Structural Timber', unitLabel: 'tonne', quantity: 8 },
        { displayName: 'Cement', unitLabel: 'tonne', quantity: 8 },
        { displayName: 'Steel', unitLabel: 'tonne', quantity: 6 },
      ],
      outputs: [{
        displayName: 'Building Modules',
        unitLabel: 'module',
        quantity: 4,
      }],
      fullLoad: null,
    });
  });

  it('presents finite Port supply and Town demand as immutable boundary trade', () => {
    const created = WorldManager.tryCreateNew(
      'Boundary presentation',
      'boundary-presentation-seed',
      'temperate',
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const port = created.world.economy.facilities.find(
      ({ id }) => id === 'port-interchange',
    );
    const town = created.world.economy.facilities.find(
      ({ id }) => id === 'town-construction-market',
    );
    if (!port || !town) throw new Error('boundary facilities missing');
    created.world.economy.market.constructionIndexBps = 10_000;
    created.world.economy.market.regionalDemandBpsByProduct[
      'building-modules'
    ] = 10_000;

    const portDto = buildFacilityInspection(
      created.world,
      port.id,
      true,
    );
    const townDto = buildFacilityInspection(
      created.world,
      town.id,
      true,
    );

    expect(portDto).toMatchObject({
      status: { code: 'idle', label: 'Imported steel available' },
      boundaryTrade: {
        kind: 'import-source',
        productId: 'steel',
        label: 'Offers Steel',
      },
      activeRecipe: null,
      quotes: [],
    });
    expect(townDto).toMatchObject({
      status: { code: 'idle', label: 'Buying Building Modules' },
      boundaryTrade: {
        kind: 'consumer-sink',
        productId: 'building-modules',
        label: 'Buys Building Modules',
      },
      activeRecipe: null,
      quotes: [{
        productId: 'building-modules',
        displayName: 'Building Modules',
        unitLabel: 'module',
        fullLoadQuantity: 4,
        fullLoadGross: expect.any(Number),
      }],
    });
    expect(Object.isFrozen(portDto?.boundaryTrade)).toBe(true);
    expect(Object.isFrozen(townDto?.boundaryTrade)).toBe(true);

    port.inventories.steel.quantity = 0;
    town.inventories['building-modules'].quantity =
      town.inventories['building-modules'].capacity;
    expect(buildFacilityInspection(created.world, port.id, true)?.status)
      .toEqual({ code: 'idle', label: 'Steel import stock depleted' });
    expect(buildFacilityInspection(created.world, town.id, true)?.status)
      .toEqual({ code: 'idle', label: 'Construction market supplied' });
  });
});
