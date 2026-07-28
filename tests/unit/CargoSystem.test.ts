import type {
  EconomyStateDef,
  TrainDef,
} from '../../src/config/WorldData';
import type {
  CompanyStateDef,
  FacilityDefinition,
  FacilityEconomyDef,
  RecipeDefinition,
} from '../../src/economy/EconomyData';
import { advanceFacilityRecipe } from '../../src/economy/IndustrySystem';
import { quoteLocalProduct } from '../../src/economy/MarketSystem';
import * as ProductCatalog from '../../src/economy/ProductCatalog';
import {
  createCompanyState,
  postLedgerEntry,
} from '../../src/economy/FinanceLedger';
import {
  proposeCargoTick,
  type CargoTickProposal,
} from '../../src/freight/CargoSystem';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

type ExpectedCargoBlockerCode =
  | 'not-operating'
  | 'derailed'
  | 'train-moving'
  | 'unknown-freight-set'
  | 'incompatible-product'
  | 'outside-eligible-facility'
  | 'source-empty'
  | 'train-full'
  | 'destination-full'
  | 'product-not-accepted'
  | 'insufficient-running-cash';

const makeRuntime = (
  trainId = 'train-1',
  overrides: Partial<TrainRuntimeSnapshot> = {},
): TrainRuntimeSnapshot => ({
  trainId,
  trackUUID: 'forest-sawmill-track',
  trackT: 0.1,
  facing: 1,
  x: -500,
  y: 0,
  speedWorldUnitsPerSecond: 0,
  throttle: 0,
  derailed: false,
  ...overrides,
});

const makeInput = (
  overrides: Partial<{
    operating: boolean;
    company: CompanyStateDef;
    economy: EconomyStateDef;
    trains: readonly TrainDef[];
    freightProgress: {
      progressVersion: 1;
      profitableLogDeliveryCompleted: boolean;
      developmentGrantAwarded: boolean;
      profitableStructuralTimberDeliveryCompleted: boolean;
    };
    runtime: readonly TrainRuntimeSnapshot[];
  }> = {},
) => {
  const world = makeFirstFreightRouteWorld();
  return {
    operating: true,
    company: world.company,
    economy: world.economy,
    trains: world.trains,
    freightProgress: world.freightProgress,
    runtime: [makeRuntime()],
    ...overrides,
  };
};

const propose = (
  overrides: Parameters<typeof makeInput>[0] = {},
): CargoTickProposal => proposeCargoTick(makeInput(overrides));

const facility = (
  economy: EconomyStateDef,
  definitionId: 'managed-forest' | 'sawmill' | 'prefabrication-plant',
): FacilityEconomyDef => {
  const found = economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!found) throw new Error(`Missing ${definitionId} fixture`);
  return found;
};

const makeFacility = (
  definition: FacilityDefinition,
  x: number,
): FacilityEconomyDef => ({
  id: definition.id,
  definitionId: definition.id,
  name: definition.displayName,
  x,
  y: 0,
  railAccess: { x, y: 0, radius: 32.5 },
  inventories: Object.fromEntries(definition.inventory.map((template) => [
    template.productId,
    {
      productId: template.productId,
      quantity: template.initialQuantity,
      reservedQuantity: 0,
      capacity: template.capacity,
      recentInflow: 0,
      recentOutflow: 0,
      targetStock: template.targetStock,
    },
  ])),
  activeRecipeId: definition.recipeIds[0] ?? null,
  recipeProgressTicks: 0,
});

const expectSingleBlocked = (
  proposal: CargoTickProposal,
  blocker: ExpectedCargoBlockerCode,
): void => {
  expect(proposal.changed).toBe(false);
  expect(proposal.statuses).toHaveLength(1);
  expect(proposal.statuses[0]).toEqual(expect.objectContaining({
    trainId: 'train-1',
    kind: 'blocked',
    blocker,
    batchUnits: 0,
    batchRevenue: 0,
  }));
};

const deepFreezeCheck = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    deepFreezeCheck,
  );
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('proposeCargoTick eligibility and facility resolution', () => {
  it('keeps the train idle outside Operate mode', () => {
    const result = propose({ operating: false });

    expect(result.changed).toBe(false);
    expect(result.statuses).toEqual([{
      trainId: 'train-1',
      facilityId: null,
      productId: null,
      kind: 'idle',
      blocker: 'not-operating',
      batchUnits: 0,
      cargoUnits: 0,
      capacityUnits: 0,
      batchRevenue: 0,
    }]);
  });

  it('prioritizes not-operating over derailment and movement', () => {
    const derailed = propose({
      operating: false,
      runtime: [makeRuntime('train-1', {
        derailed: true,
        throttle: 1,
        speedWorldUnitsPerSecond: 3,
      })],
    });
    const moving = propose({
      operating: false,
      runtime: [makeRuntime('train-1', {
        speedWorldUnitsPerSecond: 2.000001,
      })],
    });

    expect(derailed.statuses[0]).toEqual(expect.objectContaining({
      kind: 'idle',
      blocker: 'not-operating',
    }));
    expect(moving.statuses[0]).toEqual(expect.objectContaining({
      kind: 'idle',
      blocker: 'not-operating',
    }));
  });

  it.each([
    {
      name: 'derailed with zero throttle',
      runtime: { derailed: true },
    },
    {
      name: 'derailed while moving and throttling',
      runtime: {
        derailed: true,
        speedWorldUnitsPerSecond: 20,
        throttle: 1 as const,
      },
    },
    {
      name: 'detached from track authority',
      runtime: { trackUUID: null, trackT: null },
    },
  ])('requires re-railing when $name', ({ runtime }) => {
    const result = propose({ runtime: [makeRuntime('train-1', runtime)] });

    expectSingleBlocked(result, 'derailed');
  });

  it.each([
    {
      name: 'forward throttle at rest',
      runtime: { throttle: 1 as const },
    },
    {
      name: 'reverse throttle at rest',
      runtime: { throttle: -1 as const },
    },
    {
      name: 'speed just above the limit',
      runtime: { speedWorldUnitsPerSecond: 2.000001 },
    },
  ])('requires stopping for $name', ({ runtime }) => {
    const result = propose({ runtime: [makeRuntime('train-1', runtime)] });

    expectSingleBlocked(result, 'train-moving');
  });

  it.each([0, 2])(
    'allows a zero-throttle train at speed %p to load',
    (speedWorldUnitsPerSecond) => {
      const result = propose({
        runtime: [makeRuntime('train-1', { speedWorldUnitsPerSecond })],
      });

      expect(result.statuses[0]).toEqual(expect.objectContaining({
        facilityId: 'managed-forest',
        kind: 'loading',
        blocker: null,
        batchUnits: 10,
      }));
    },
  );

  it('includes the exact centre and radius boundary of a rail-access ring', () => {
    const centre = propose({
      runtime: [makeRuntime('train-1', { x: -500, y: 0 })],
    });
    const boundary = propose({
      runtime: [makeRuntime('train-1', { x: -467.5, y: 0 })],
    });
    const outside = propose({
      runtime: [makeRuntime('train-1', { x: -467.499999, y: 0 })],
    });

    expect(centre.statuses[0].kind).toBe('loading');
    expect(boundary.statuses[0].kind).toBe('loading');
    expectSingleBlocked(
      outside,
      'outside-eligible-facility',
    );
  });

  it('selects the nearest eligible contained facility by distance', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    forest.id = 'forest-far';
    forest.railAccess = { x: 0, y: 0, radius: 30 };
    const nearer = {
      ...forest,
      id: 'forest-near',
      x: 10,
      railAccess: { x: 10, y: 0, radius: 30 },
      inventories: {
        logs: { ...forest.inventories.logs },
      },
    };
    input.economy.facilities.push(nearer);

    const result = proposeCargoTick({
      ...input,
      runtime: [makeRuntime('train-1', { x: 8, y: 0 })],
    });

    expect(result.statuses[0]).toEqual(expect.objectContaining({
      facilityId: 'forest-near',
      kind: 'loading',
    }));
    expect(facility(result.economy, 'managed-forest').id).toBe('forest-far');
    expect(result.economy.facilities.find(
      ({ id }) => id === 'forest-near',
    )?.inventories.logs.quantity).toBe(
      nearer.inventories.logs.quantity - 10,
    );
  });

  it('breaks equal-distance eligible facility ties by facility ID', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    forest.id = 'forest-z';
    forest.railAccess = { x: -10, y: 0, radius: 20 };
    input.economy.facilities.push({
      ...forest,
      id: 'forest-a',
      x: 10,
      railAccess: { x: 10, y: 0, radius: 20 },
      inventories: {
        logs: { ...forest.inventories.logs },
      },
    });

    const result = proposeCargoTick({
      ...input,
      runtime: [makeRuntime('train-1', { x: 0, y: 0 })],
    });

    expect(result.statuses[0].facilityId).toBe('forest-a');
  });

  it('resolves eligibility across every overlapping physical ring before blocking', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const sawmill = facility(input.economy, 'sawmill');
    forest.railAccess = { x: 0, y: 0, radius: 30 };
    sawmill.railAccess = { x: 20, y: 0, radius: 30 };
    forest.inventories.logs.quantity =
      forest.inventories.logs.reservedQuantity;
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 10,
        loadedUnits: 10,
        originFacilityId: forest.id,
      },
    });

    const result = proposeCargoTick({
      ...input,
      trains: [loaded],
      runtime: [makeRuntime('train-1', { x: 2, y: 0 })],
    });

    expect(result.statuses[0]).toEqual(expect.objectContaining({
      facilityId: sawmill.id,
      kind: 'unloading',
      blocker: null,
      batchUnits: 10,
    }));
  });

  it('uses the nearest contained physical facility to explain a blocker', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const sawmill = facility(input.economy, 'sawmill');
    forest.railAccess = { x: 0, y: 0, radius: 30 };
    sawmill.railAccess = { x: 10, y: 0, radius: 30 };
    forest.inventories.logs.quantity = 0;

    const result = proposeCargoTick({
      ...input,
      runtime: [makeRuntime('train-1', { x: 1, y: 0 })],
    });

    expectSingleBlocked(result, 'source-empty');
    expect(result.statuses[0].facilityId).toBe(forest.id);
  });

  it('uses the nearest relevant source as the outside loading remedy', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const fartherForest = {
      ...forest,
      id: 'managed-forest-farther',
      railAccess: { x: -800, y: 0, radius: 20 },
      inventories: { logs: { ...forest.inventories.logs } },
    };
    input.economy.facilities.push(fartherForest);

    const result = proposeCargoTick({
      ...input,
      runtime: [makeRuntime('train-1', { x: -300, y: 0 })],
    });

    expectSingleBlocked(
      result,
      'outside-eligible-facility',
    );
    expect(result.statuses[0].facilityId).toBe(forest.id);
  });

  it('uses the nearest relevant destination as the outside unloading remedy', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const sawmill = facility(input.economy, 'sawmill');
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 10,
        loadedUnits: 10,
        originFacilityId: forest.id,
      },
    });
    input.economy.facilities.push({
      ...sawmill,
      id: 'sawmill-farther',
      railAccess: { x: 800, y: 0, radius: 20 },
      inventories: Object.fromEntries(Object.entries(
        sawmill.inventories,
      ).map(([id, slot]) => [id, { ...slot }])),
    });

    const result = proposeCargoTick({
      ...input,
      trains: [loaded],
      runtime: [makeRuntime('train-1', { x: 300, y: 0 })],
    });

    expectSingleBlocked(result, 'outside-eligible-facility');
    expect(result.statuses[0].facilityId).toBe(sawmill.id);
  });

  it('uses only the consignment origin as an outside reload remedy', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const nearerForest = {
      ...forest,
      id: 'nearer-forest',
      railAccess: { x: -200, y: 0, radius: 20 },
      inventories: { logs: { ...forest.inventories.logs } },
    };
    input.economy.facilities.push(nearerForest);
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 10,
        loadedUnits: 10,
        originFacilityId: forest.id,
      },
    });

    const result = proposeCargoTick({
      ...input,
      trains: [loaded],
      runtime: [makeRuntime('train-1', { x: 0 })],
    });

    expectSingleBlocked(result, 'outside-eligible-facility');
    expect(result.statuses[0].facilityId).toBe(forest.id);
  });

  it('uses only a destination as the remedy after a partial unload', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const sawmill = facility(input.economy, 'sawmill');
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 10,
        loadedUnits: 20,
        originFacilityId: forest.id,
      },
    });

    const result = proposeCargoTick({
      ...input,
      trains: [loaded],
      runtime: [makeRuntime('train-1', { x: -300 })],
    });

    expectSingleBlocked(result, 'outside-eligible-facility');
    expect(result.statuses[0].facilityId).toBe(sawmill.id);
  });

  it('fails closed for malformed source and destination slots', () => {
    const sourceInput = makeInput();
    const forest = facility(sourceInput.economy, 'managed-forest');
    forest.inventories.logs = null as any;

    const sourceResult = proposeCargoTick(sourceInput);

    expectSingleBlocked(sourceResult, 'product-not-accepted');

    const destinationInput = makeInput();
    const sawmill = facility(destinationInput.economy, 'sawmill');
    sawmill.inventories.logs = {
      ...sawmill.inventories.logs,
      quantity: Number.MAX_SAFE_INTEGER + 1,
    };
    destinationInput.trains[0].cargo = {
      productId: 'logs',
      units: 10,
      loadedUnits: 10,
      originFacilityId: 'managed-forest',
    };
    destinationInput.runtime = [
      makeRuntime('train-1', { x: 500 }),
    ];

    const destinationResult = proposeCargoTick(destinationInput);

    expectSingleBlocked(destinationResult, 'product-not-accepted');
  });

  it('applies the complete blocker precedence without mutating authority', () => {
    const cases: Array<{
      expected: ExpectedCargoBlockerCode;
      input: ReturnType<typeof makeInput>;
      productId: string | null;
      facilityId: string | null;
    }> = [];
    const notOperating = makeInput({ operating: false });
    notOperating.trains[0].freightSetId = 'missing-set';
    notOperating.runtime = [makeRuntime('train-1', {
      derailed: true,
      throttle: 1,
    })];
    cases.push({
      expected: 'not-operating',
      input: notOperating,
      productId: null,
      facilityId: null,
    });

    const derailed = makeInput();
    derailed.trains[0].freightSetId = 'missing-set';
    derailed.runtime = [makeRuntime('train-1', {
      derailed: true,
      throttle: 1,
    })];
    cases.push({
      expected: 'derailed',
      input: derailed,
      productId: null,
      facilityId: null,
    });

    const moving = makeInput();
    moving.trains[0].freightSetId = 'missing-set';
    moving.runtime = [makeRuntime('train-1', { throttle: 1 })];
    cases.push({
      expected: 'train-moving',
      input: moving,
      productId: null,
      facilityId: null,
    });

    const unknownSet = makeInput();
    unknownSet.trains[0].freightSetId = 'missing-set';
    cases.push({
      expected: 'unknown-freight-set',
      input: unknownSet,
      productId: null,
      facilityId: null,
    });

    const incompatible = makeInput();
    incompatible.trains[0].cargo = {
      productId: 'limestone-aggregate',
      units: 10,
      loadedUnits: 10,
      originFacilityId: 'quarry',
    };
    cases.push({
      expected: 'incompatible-product',
      input: incompatible,
      productId: 'limestone-aggregate',
      facilityId: null,
    });

    const outside = makeInput();
    outside.runtime = [makeRuntime('train-1', { x: 0 })];
    cases.push({
      expected: 'outside-eligible-facility',
      input: outside,
      productId: 'logs',
      facilityId: 'managed-forest',
    });

    const sourceEmpty = makeInput();
    const emptyForest = facility(sourceEmpty.economy, 'managed-forest');
    emptyForest.inventories.logs.reservedQuantity =
      emptyForest.inventories.logs.quantity;
    cases.push({
      expected: 'source-empty',
      input: sourceEmpty,
      productId: 'logs',
      facilityId: 'managed-forest',
    });

    const trainFull = makeInput();
    trainFull.trains[0].cargo = {
      productId: 'logs',
      units: 60,
      loadedUnits: 60,
      originFacilityId: 'managed-forest',
    };
    cases.push({
      expected: 'train-full',
      input: trainFull,
      productId: 'logs',
      facilityId: 'managed-forest',
    });

    const destinationFull = makeInput();
    destinationFull.trains[0].cargo = {
      productId: 'logs',
      units: 10,
      loadedUnits: 10,
      originFacilityId: 'managed-forest',
    };
    destinationFull.runtime = [makeRuntime('train-1', { x: 500 })];
    const fullSawmill = facility(destinationFull.economy, 'sawmill');
    fullSawmill.inventories.logs.quantity =
      fullSawmill.inventories.logs.capacity;
    cases.push({
      expected: 'destination-full',
      input: destinationFull,
      productId: 'logs',
      facilityId: 'sawmill',
    });

    const notAccepted = makeInput();
    notAccepted.trains[0].cargo = {
      productId: 'structural-timber',
      units: 8,
      loadedUnits: 8,
      originFacilityId: 'sawmill',
    };
    cases.push({
      expected: 'product-not-accepted',
      input: notAccepted,
      productId: 'structural-timber',
      facilityId: 'managed-forest',
    });

    cases.forEach(({ expected, input, productId, facilityId }) => {
      const before = JSON.parse(JSON.stringify(input));
      const result = proposeCargoTick(input);
      expect(result.statuses).toEqual([expect.objectContaining({
        blocker: expected,
        productId,
        facilityId,
      })]);
      expect(result.company).toEqual(before.company);
      expect(result.economy).toEqual(before.economy);
      expect(result.trains).toEqual(before.trains);
      expect(result.freightProgress).toEqual(before.freightProgress);
      expect(result.completedDeliveries).toEqual([]);
    });
  });
});

describe('proposeCargoTick loading conservation and capacity', () => {
  it('loads an empty train in a 10-unit batch without charging the company', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const beforeLogs = forest.inventories.logs.quantity;
    const beforeCargo = input.trains[0].cargo?.units ?? 0;

    const result = proposeCargoTick(input);
    const afterForest = facility(result.economy, 'managed-forest');
    const afterTrain = result.trains[0];

    expect(result.changed).toBe(true);
    expect(result.company).toEqual(input.company);
    expect(result.company).not.toBe(input.company);
    expect(result.statuses[0]).toEqual({
      trainId: 'train-1',
      facilityId: forest.id,
      productId: 'logs',
      kind: 'loading',
      blocker: null,
      batchUnits: 10,
      cargoUnits: 10,
      capacityUnits: 60,
      batchRevenue: 0,
    });
    expect(afterForest.inventories.logs).toEqual({
      ...forest.inventories.logs,
      quantity: beforeLogs - 10,
      recentOutflow: forest.inventories.logs.recentOutflow + 10,
    });
    expect(afterTrain.cargo).toEqual({
      productId: 'logs',
      units: 10,
      loadedUnits: 10,
      originFacilityId: forest.id,
    });
    expect(beforeLogs + beforeCargo).toBe(
      afterForest.inventories.logs.quantity
        + (afterTrain.cargo?.units ?? 0),
    );
  });

  it('extends compatible onboard logs at their consignment origin', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 20,
        loadedUnits: 20,
        originFacilityId: forest.id,
      },
    });
    const beforeLogs = forest.inventories.logs.quantity;

    const result = proposeCargoTick({
      ...input,
      trains: [loaded],
    });

    expect(result.trains[0].cargo).toEqual({
      productId: 'logs',
      units: 30,
      loadedUnits: 30,
      originFacilityId: forest.id,
    });
    expect(
      beforeLogs + 20,
    ).toBe(
      facility(result.economy, 'managed-forest').inventories.logs.quantity
        + (result.trains[0].cargo?.units ?? 0),
    );
  });

  it('blocks same-origin reload after a partial unload', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 10,
        loadedUnits: 20,
        originFacilityId: forest.id,
      },
    });

    const result = proposeCargoTick({
      ...input,
      trains: [loaded],
    });

    expectSingleBlocked(result, 'product-not-accepted');
    expect(result.trains[0]).toEqual(loaded);
    expect(result.economy).toEqual(input.economy);
  });

  it('blocks reload of the same product at a second origin', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    const secondForest = {
      ...forest,
      id: 'second-forest',
      inventories: { logs: { ...forest.inventories.logs } },
    };
    forest.railAccess = { x: -800, y: 0, radius: 20 };
    input.economy.facilities.push(secondForest);
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 20,
        loadedUnits: 20,
        originFacilityId: forest.id,
      },
    });

    const result = proposeCargoTick({
      ...input,
      trains: [loaded],
    });

    expectSingleBlocked(result, 'product-not-accepted');
    expect(result.trains[0]).toEqual(loaded);
    expect(result.economy).toEqual(input.economy);
  });

  it.each([
    ['above capacity', 61],
    ['unsafe', Number.MAX_SAFE_INTEGER],
  ])('rejects %s cumulative loaded units', (_description, loadedUnits) => {
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 59,
        loadedUnits,
        originFacilityId: 'managed-forest',
      },
    });

    const result = propose({ trains: [loaded] });

    expectSingleBlocked(result, 'train-full');
    expect(result.trains[0]).toEqual(loaded);
  });

  it('clamps a partial train to its remaining compatible capacity', () => {
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 55,
        loadedUnits: 55,
        originFacilityId: 'managed-forest',
      },
    });

    const result = propose({ trains: [loaded] });

    expect(result.statuses[0]).toEqual(expect.objectContaining({
      kind: 'loading',
      batchUnits: 5,
      cargoUnits: 60,
      capacityUnits: 60,
    }));
    expect(result.trains[0].cargo?.units).toBe(60);
  });

  it('clamps loading to unreserved source availability', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    forest.inventories.logs.quantity = 15;
    forest.inventories.logs.reservedQuantity = 9;
    forest.inventories.logs.recentOutflow = 4;

    const result = proposeCargoTick(input);
    const slot = facility(
      result.economy,
      'managed-forest',
    ).inventories.logs;

    expect(result.statuses[0].batchUnits).toBe(6);
    expect(result.trains[0].cargo?.units).toBe(6);
    expect(slot.quantity).toBe(9);
    expect(slot.reservedQuantity).toBe(9);
    expect(slot.recentOutflow).toBe(10);
    expect(15).toBe(slot.quantity + (result.trains[0].cargo?.units ?? 0));
  });

  it('reports exhausted source stock without changing authority', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    forest.inventories.logs.quantity = 12;
    forest.inventories.logs.reservedQuantity = 12;

    const result = proposeCargoTick(input);

    expectSingleBlocked(result, 'source-empty');
    expect(result.economy).toEqual(input.economy);
    expect(result.trains).toEqual(input.trains);
  });

  it('reports an exactly full compatible timber set', () => {
    const full = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 60,
        loadedUnits: 60,
        originFacilityId: 'managed-forest',
      },
    });

    const result = propose({ trains: [full] });

    expectSingleBlocked(result, 'train-full');
    expect(result.statuses[0]).toEqual(expect.objectContaining({
      cargoUnits: 60,
      capacityUnits: 60,
    }));
  });

  it('rejects incompatible onboard cargo deterministically', () => {
    const incompatible = makeFreightTrainDef({
      cargo: {
        productId: 'structural-timber',
        units: 4,
        loadedUnits: 4,
        originFacilityId: 'sawmill',
      },
    });

    const result = propose({ trains: [incompatible] });

    expectSingleBlocked(result, 'product-not-accepted');
    expect(result.trains[0]).toEqual(incompatible);
  });

  it('does not transfer after movement interrupts an otherwise valid load', () => {
    const input = makeInput();

    const result = proposeCargoTick({
      ...input,
      runtime: [makeRuntime('train-1', {
        speedWorldUnitsPerSecond: 2.000001,
      })],
    });

    expectSingleBlocked(result, 'train-moving');
    expect(result.economy).toEqual(input.economy);
    expect(result.trains).toEqual(input.trains);
  });

  it('preserves unsorted train authority byte-for-byte for a no-op tick', () => {
    const input = makeInput();
    const trainB = makeFreightTrainDef({ id: 'train-b' });
    const trainA = makeFreightTrainDef({ id: 'train-a' });
    const trains = [trainB, trainA];

    const result = proposeCargoTick({
      ...input,
      operating: false,
      trains,
      runtime: [
        makeRuntime('train-b'),
        makeRuntime('train-a'),
      ],
    });

    expect(result.changed).toBe(false);
    expect(JSON.stringify(result.trains)).toBe(JSON.stringify(trains));
    expect(result.trains.map(({ id }) => id)).toEqual([
      'train-b',
      'train-a',
    ]);
    expect(result.statuses.map(({ trainId }) => trainId)).toEqual([
      'train-a',
      'train-b',
    ]);
  });

  it('processes shared inventory by stable ID without reordering train authority', () => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    forest.inventories.logs.quantity = 15;
    const trainB = makeFreightTrainDef({ id: 'train-b' });
    const trainA = makeFreightTrainDef({ id: 'train-a' });

    const result = proposeCargoTick({
      ...input,
      trains: [trainB, trainA],
      runtime: [
        makeRuntime('train-b'),
        makeRuntime('train-a'),
      ],
    });

    expect(result.statuses.map(({ trainId }) => trainId)).toEqual([
      'train-a',
      'train-b',
    ]);
    expect(result.statuses.map(({ batchUnits }) => batchUnits)).toEqual([
      10,
      5,
    ]);
    expect(result.trains.map(({ id }) => id)).toEqual([
      'train-b',
      'train-a',
    ]);
    expect(result.trains.map(({ cargo }) => cargo?.units)).toEqual([5, 10]);
    expect(facility(
      result.economy,
      'managed-forest',
    ).inventories.logs.quantity).toBe(0);
  });

  it('uses active-recipe output order for an ambiguous empty-train load', () => {
    const input = makeInput();
    const sawmill = facility(input.economy, 'sawmill');
    sawmill.activeRecipeId = 'mixed-output';
    sawmill.inventories.logs.quantity = 20;
    sawmill.inventories['structural-timber'].quantity = 20;
    input.runtime = [makeRuntime('train-1', { x: 500 })];
    const definition: FacilityDefinition = Object.freeze({
      id: 'sawmill',
      displayName: 'Sawmill',
      recipeIds: Object.freeze(['mixed-output']),
      inventory: Object.freeze([
        Object.freeze({
          productId: 'logs',
          capacity: 200,
          targetStock: 100,
          initialQuantity: 0,
        }),
        Object.freeze({
          productId: 'structural-timber',
          capacity: 160,
          targetStock: 80,
          initialQuantity: 0,
        }),
      ]),
      boundary: 'none',
    });
    const recipe: RecipeDefinition = Object.freeze({
      id: 'mixed-output',
      kind: 'processing',
      cycleTicks: 3,
      inputs: Object.freeze([]),
      outputs: Object.freeze([
        Object.freeze({ productId: 'structural-timber', quantity: 8 }),
        Object.freeze({ productId: 'logs', quantity: 10 }),
      ]),
    });
    jest.spyOn(ProductCatalog, 'getFacilityDefinition')
      .mockImplementation((id) => id === 'sawmill' ? definition : undefined);
    jest.spyOn(ProductCatalog, 'getRecipe')
      .mockImplementation((id) => id === 'mixed-output' ? recipe : undefined);

    const result = proposeCargoTick(input);

    expect(result.statuses).toEqual([expect.objectContaining({
      facilityId: 'sawmill',
      productId: 'structural-timber',
      kind: 'loading',
      batchUnits: 10,
      capacityUnits: 60,
    })]);
    expect(result.trains[0].cargo).toEqual({
      productId: 'structural-timber',
      units: 10,
      loadedUnits: 10,
      originFacilityId: 'sawmill',
    });
    expect(facility(
      result.economy,
      'sawmill',
    ).inventories['structural-timber'].quantity).toBe(10);
    expect(facility(result.economy, 'sawmill').inventories.logs.quantity)
      .toBe(20);
  });

  it('resolves six-train contention by ID and conserves structural timber', () => {
    const input = makeInput();
    const sawmill = facility(input.economy, 'sawmill');
    sawmill.inventories['structural-timber'].quantity = 45;
    const trains = ['f', 'e', 'd', 'c', 'b', 'a'].map((suffix) =>
      makeFreightTrainDef({ id: `train-${suffix}` }));
    const runtime = trains.map((train) =>
      makeRuntime(train.id, { x: 500 }));

    const result = proposeCargoTick({
      ...input,
      trains,
      runtime,
    });

    expect(result.statuses.map((entry) => ({
      trainId: entry.trainId,
      blocker: entry.blocker,
      batchUnits: entry.batchUnits,
    }))).toEqual([
      { trainId: 'train-a', blocker: null, batchUnits: 10 },
      { trainId: 'train-b', blocker: null, batchUnits: 10 },
      { trainId: 'train-c', blocker: null, batchUnits: 10 },
      { trainId: 'train-d', blocker: null, batchUnits: 10 },
      { trainId: 'train-e', blocker: null, batchUnits: 5 },
      { trainId: 'train-f', blocker: 'source-empty', batchUnits: 0 },
    ]);
    expect(result.trains.map((train) => train.cargo?.units ?? 0))
      .toEqual([0, 5, 10, 10, 10, 10]);
    const remaining = facility(
      result.economy,
      'sawmill',
    ).inventories['structural-timber'].quantity;
    const onboard = result.trains.reduce(
      (sum, train) => sum + (train.cargo?.units ?? 0),
      0,
    );
    expect(45).toBe(remaining + onboard);
  });

  it('rejects unknown facility, recipe, and product definitions atomically', () => {
    const unknownFacility = makeInput();
    facility(unknownFacility.economy, 'managed-forest').definitionId =
      'missing-facility';
    const unknownRecipe = makeInput();
    facility(unknownRecipe.economy, 'managed-forest').activeRecipeId =
      'missing-recipe';
    const unknownProduct = makeInput();
    unknownProduct.trains[0].cargo = {
      productId: 'missing-product',
      units: 10,
      loadedUnits: 10,
      originFacilityId: 'missing-origin',
    };

    [
      { input: unknownFacility, blocker: 'product-not-accepted' },
      { input: unknownRecipe, blocker: 'product-not-accepted' },
      { input: unknownProduct, blocker: 'incompatible-product' },
    ].forEach(({ input, blocker }) => {
      const before = JSON.parse(JSON.stringify(input));
      const result = proposeCargoTick(input);
      expect(result.statuses[0].blocker).toBe(blocker);
      expect(result.company).toEqual(before.company);
      expect(result.economy).toEqual(before.economy);
      expect(result.trains).toEqual(before.trains);
      expect(result.completedDeliveries).toEqual([]);
    });
  });
});

describe('proposeCargoTick unloading, revenue, and trip roll-over', () => {
  const loadedAtSawmill = (
    units: number,
    operationOverrides: Partial<TrainDef['operations']> = {},
  ): ReturnType<typeof makeInput> => {
    const input = makeInput();
    const forest = facility(input.economy, 'managed-forest');
    input.trains = [makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units,
        loadedUnits: units,
        originFacilityId: forest.id,
      },
      operations: {
        ...makeFreightTrainDef().operations,
        ...operationOverrides,
      },
    })];
    input.runtime = [makeRuntime('train-1', {
      x: 500,
      trackT: 0.9,
    })];
    return input;
  };

  const deliverRemainingCargo = (
    initial: ReturnType<typeof makeInput>,
  ): CargoTickProposal => {
    let input = initial;
    let final: CargoTickProposal | null = null;
    for (let batch = 0; batch < 6; batch += 1) {
      final = proposeCargoTick(input);
      if (final.trains[0].cargo === null) break;
      input = {
        operating: true,
        company: final.company,
        economy: final.economy,
        trains: final.trains,
        freightProgress: final.freightProgress,
        runtime: initial.runtime,
      };
    }
    if (!final || final.trains[0].cargo !== null) {
      throw new Error('Full consignment did not unload within six batches');
    }
    return final;
  };

  it('moves produced structural timber through the same flatbed and conserves both products', () => {
    const input = loadedAtSawmill(10);
    const prefabDefinition = ProductCatalog.getFacilityDefinition(
      'prefabrication-plant',
    );
    const sawmillRecipe = ProductCatalog.getRecipe('sawmill-cut');
    if (!prefabDefinition || !sawmillRecipe) {
      throw new Error('Structural-timber catalogue definitions are missing');
    }
    input.economy.facilities.push(makeFacility(prefabDefinition, 900));
    const initialLogs = facility(
      input.economy,
      'managed-forest',
    ).inventories.logs.quantity
      + (input.trains[0].cargo?.units ?? 0)
      + facility(input.economy, 'sawmill').inventories.logs.quantity;

    const logDelivery = proposeCargoTick(input);
    let producedEconomy = JSON.parse(
      JSON.stringify(logDelivery.economy),
    ) as EconomyStateDef;
    let completedSawmillBatches = 0;
    for (let tick = 0; tick < 3; tick += 1) {
      const sawmillIndex = producedEconomy.facilities.findIndex(
        ({ id }) => id === 'sawmill',
      );
      const advanced = advanceFacilityRecipe(
        producedEconomy.facilities[sawmillIndex],
        sawmillRecipe,
      );
      producedEconomy.facilities[sawmillIndex] = advanced.facility;
      completedSawmillBatches += advanced.completedBatches;
    }

    const timberLoad = proposeCargoTick({
      ...input,
      company: logDelivery.company,
      economy: producedEconomy,
      trains: logDelivery.trains,
      freightProgress: logDelivery.freightProgress,
      runtime: [makeRuntime('train-1', { x: 500 })],
    });
    const timberDelivery = proposeCargoTick({
      ...input,
      company: timberLoad.company,
      economy: timberLoad.economy,
      trains: timberLoad.trains,
      freightProgress: timberLoad.freightProgress,
      runtime: [makeRuntime('train-1', { x: 900 })],
    });

    expect(logDelivery.completedDeliveries).toEqual([
      expect.objectContaining({
        productId: 'logs',
        units: 10,
        destinationFacilityId: 'sawmill',
      }),
    ]);
    expect(timberLoad.statuses).toEqual([expect.objectContaining({
      facilityId: 'sawmill',
      productId: 'structural-timber',
      kind: 'loading',
      batchUnits: 8,
      cargoUnits: 8,
      capacityUnits: 60,
    })]);
    expect(timberLoad.trains[0].cargo).toEqual({
      productId: 'structural-timber',
      units: 8,
      loadedUnits: 8,
      originFacilityId: 'sawmill',
    });
    expect(timberDelivery.statuses).toEqual([expect.objectContaining({
      facilityId: 'prefabrication-plant',
      productId: 'structural-timber',
      kind: 'unloading',
      batchUnits: 8,
      cargoUnits: 0,
      capacityUnits: 60,
    })]);
    expect(timberDelivery.completedDeliveries).toEqual([
      expect.objectContaining({
        productId: 'structural-timber',
        units: 8,
        destinationFacilityId: 'prefabrication-plant',
      }),
    ]);
    expect(initialLogs).toBe(
      facility(timberDelivery.economy, 'managed-forest')
        .inventories.logs.quantity
      + (timberDelivery.trains[0].cargo?.productId === 'logs'
        ? timberDelivery.trains[0].cargo.units
        : 0)
      + facility(timberDelivery.economy, 'sawmill')
        .inventories.logs.quantity
      + 10 * completedSawmillBatches,
    );
    expect(8 * completedSawmillBatches).toBe(
      facility(timberDelivery.economy, 'sawmill')
        .inventories['structural-timber'].quantity
      + (timberDelivery.trains[0].cargo?.productId === 'structural-timber'
        ? timberDelivery.trains[0].cargo.units
        : 0)
      + facility(timberDelivery.economy, 'prefabrication-plant')
        .inventories['structural-timber'].quantity,
    );
    expect(
      timberDelivery.freightProgress.profitableLogDeliveryCompleted,
    ).toBe(false);
    expect(
      timberDelivery.freightProgress
        .profitableStructuralTimberDeliveryCompleted,
    ).toBe(false);
    expect(timberDelivery.freightProgress.developmentGrantAwarded)
      .toBe(false);
  });

  it('rejects unloading when the freight set definition is unavailable', () => {
    const input = loadedAtSawmill(10, {
      currentTripRevenue: 100,
      currentTripRunningCost: 20,
      lifetimeDeliveredUnits: 4,
      lifetimeRevenue: 400,
    });
    input.trains[0].freightSetId = 'unavailable-freight-set';
    const sawmill = facility(input.economy, 'sawmill');
    const before = JSON.parse(JSON.stringify(input));

    const result = proposeCargoTick(input);

    expectSingleBlocked(result, 'unknown-freight-set');
    expect(result.statuses[0]).toEqual(expect.objectContaining({
      facilityId: null,
      productId: 'logs',
      capacityUnits: 0,
    }));
    expect(result.company).toEqual(before.company);
    expect(result.economy).toEqual(before.economy);
    expect(result.trains).toEqual(before.trains);
    expect(result.completedDeliveries).toEqual([]);
  });

  it('rejects an empty same-product source from another origin', () => {
    const input = loadedAtSawmill(4, {
      currentTripRevenue: 100,
      currentTripRunningCost: 20,
      lifetimeDeliveredUnits: 3,
      lifetimeRevenue: 300,
    });
    input.trains[0].cargo = {
      productId: 'structural-timber',
      units: 4,
      loadedUnits: 4,
      originFacilityId: 'other-sawmill',
    };

    const result = proposeCargoTick(input);

    expectSingleBlocked(result, 'product-not-accepted');
    expect(result.statuses[0]).toEqual(expect.objectContaining({
      facilityId: 'sawmill',
      productId: 'structural-timber',
      cargoUnits: 4,
      capacityUnits: 60,
    }));
    expect(result.company).toEqual(input.company);
    expect(result.company.ledger).toEqual(input.company.ledger);
    expect(result.economy).toEqual(input.economy);
    expect(result.trains).toEqual(input.trains);
    expect(result.freightProgress).toEqual(input.freightProgress);
    expect(result.completedDeliveries).toEqual([]);
  });

  it('quotes the pre-batch destination and posts accepted-only revenue', () => {
    const input = loadedAtSawmill(14, {
      currentTripRevenue: 200,
      lifetimeDeliveredUnits: 7,
      lifetimeRevenue: 500,
    });
    const sawmill = facility(input.economy, 'sawmill');
    sawmill.inventories.logs.recentInflow = 3;
    const preBatchSlot = { ...sawmill.inventories.logs };
    const quote = quoteLocalProduct(
      'logs',
      input.economy.market,
      preBatchSlot,
    );
    if (quote.ok === false) {
      throw new Error(`Unexpected quote rejection: ${quote.code}`);
    }
    const expectedRevenue = quote.unitPrice * 10;
    const beforeCash = input.company.cash;
    const beforeCargo = input.trains[0].cargo?.units ?? 0;
    const beforeSawmillLogs = preBatchSlot.quantity;

    const result = proposeCargoTick(input);
    const resultSawmill = facility(result.economy, 'sawmill');
    const resultTrain = result.trains[0];

    expect(result.statuses[0]).toEqual({
      trainId: 'train-1',
      facilityId: sawmill.id,
      productId: 'logs',
      kind: 'unloading',
      blocker: null,
      batchUnits: 10,
      cargoUnits: 4,
      capacityUnits: 60,
      batchRevenue: expectedRevenue,
    });
    expect(resultSawmill.inventories.logs).toEqual({
      ...preBatchSlot,
      quantity: preBatchSlot.quantity + 10,
      recentInflow: 13,
    });
    expect(resultTrain.cargo?.units).toBe(4);
    expect(resultTrain.operations).toEqual({
      currentTripRevenue: 200 + expectedRevenue,
      currentTripRunningCost: 0,
      lastTripRevenue: 0,
      lastTripRunningCost: 0,
      lifetimeDeliveredUnits: 17,
      lifetimeRevenue: 500 + expectedRevenue,
      lifetimeRunningCost: 0,
    });
    expect(result.company.cash).toBe(beforeCash + expectedRevenue);
    expect(result.company.ledger.at(-1)).toEqual({
      id: input.company.nextLedgerId,
      tick: input.economy.tick,
      category: 'delivery-revenue',
      ledgerClass: 'revenue',
      amount: expectedRevenue,
      referenceId: `train-1:${input.economy.tick}:${sawmill.id}`,
    });
    expect(beforeCargo + beforeSawmillLogs).toBe(
      (resultTrain.cargo?.units ?? 0)
        + resultSawmill.inventories.logs.quantity,
    );
    expect(result.completedDeliveries).toEqual([]);
  });

  it('clamps unloading to partial destination space and accepted-only stats', () => {
    const input = loadedAtSawmill(10, {
      currentTripRevenue: 11,
      lifetimeDeliveredUnits: 3,
      lifetimeRevenue: 17,
    });
    const sawmill = facility(input.economy, 'sawmill');
    const slot = sawmill.inventories.logs;
    slot.quantity = slot.capacity - 4;
    const quote = quoteLocalProduct('logs', input.economy.market, { ...slot });
    if (quote.ok === false) {
      throw new Error(`Unexpected quote rejection: ${quote.code}`);
    }

    const result = proposeCargoTick(input);

    expect(result.statuses[0]).toEqual(expect.objectContaining({
      batchUnits: 4,
      cargoUnits: 6,
      batchRevenue: quote.unitPrice * 4,
    }));
    expect(facility(
      result.economy,
      'sawmill',
    ).inventories.logs.quantity).toBe(slot.capacity);
    expect(result.trains[0].operations).toEqual(expect.objectContaining({
      currentTripRevenue: 11 + quote.unitPrice * 4,
      lifetimeDeliveredUnits: 7,
      lifetimeRevenue: 17 + quote.unitPrice * 4,
    }));
    expect(result.completedDeliveries).toEqual([]);
  });

  it('reports full destination storage without quoting or mutating a batch', () => {
    const input = loadedAtSawmill(10);
    const slot = facility(input.economy, 'sawmill').inventories.logs;
    slot.quantity = slot.capacity;

    const result = proposeCargoTick(input);

    expectSingleBlocked(result, 'destination-full');
    expect(result.company).toEqual(input.company);
    expect(result.economy).toEqual(input.economy);
    expect(result.trains).toEqual(input.trains);
  });

  it('leaves a final delivery unprofitable when revenue only equals cost', () => {
    const quoteInput = loadedAtSawmill(10);
    const slot = facility(
      quoteInput.economy,
      'sawmill',
    ).inventories.logs;
    const quote = quoteLocalProduct(
      'logs',
      quoteInput.economy.market,
      { ...slot },
    );
    if (quote.ok === false) {
      throw new Error(`Unexpected quote rejection: ${quote.code}`);
    }
    const input = loadedAtSawmill(10, {
      currentTripRunningCost: quote.unitPrice * 10,
    });

    const result = proposeCargoTick(input);

    expect(result.trains[0].cargo).toBeNull();
    expect(result.trains[0].operations).toEqual({
      currentTripRevenue: 0,
      currentTripRunningCost: 0,
      lastTripRevenue: quote.unitPrice * 10,
      lastTripRunningCost: quote.unitPrice * 10,
      lifetimeDeliveredUnits: 10,
      lifetimeRevenue: quote.unitPrice * 10,
      lifetimeRunningCost: 0,
    });
    expect(result.freightProgress.profitableLogDeliveryCompleted).toBe(false);
    expect(result.completedDeliveries).toEqual([{
      trainId: 'train-1',
      productId: 'logs',
      units: 10,
      destinationFacilityId: 'sawmill',
      tick: input.economy.tick,
      revenue: quote.unitPrice * 10,
      runningCost: quote.unitPrice * 10,
      operatingProfit: 0,
    }]);
  });

  it('awards one canonical development grant for a profitable full logs delivery', () => {
    const input = loadedAtSawmill(60, {
      currentTripRunningCost: 5_000,
    });
    const initialCash = input.company.cash;

    const result = deliverRemainingCargo(input);
    const grantEntries = result.company.ledger.filter(
      ({ category }) => category === 'contract-bonus',
    );

    expect(result.completedDeliveries).toEqual([
      expect.objectContaining({
        productId: 'logs',
        units: 60,
        destinationFacilityId: 'sawmill',
        operatingProfit: expect.any(Number),
      }),
    ]);
    expect(result.completedDeliveries[0].operatingProfit)
      .toBeGreaterThan(0);
    expect(result.freightProgress).toEqual({
      progressVersion: 1,
      profitableLogDeliveryCompleted: true,
      developmentGrantAwarded: true,
      profitableStructuralTimberDeliveryCompleted: false,
    });
    expect(grantEntries).toEqual([{
      id: 8,
      tick: input.economy.tick,
      category: 'contract-bonus',
      ledgerClass: 'revenue',
      amount: 250_000,
      referenceId: 'regional-development-grant:v1',
    }]);
    expect(result.company.cash).toBe(
      initialCash
      + result.completedDeliveries[0].revenue
      + 250_000,
    );
  });

  it('does not award progress or a grant for a profitable partial logs consignment', () => {
    const input = loadedAtSawmill(10);

    const result = proposeCargoTick(input);

    expect(result.completedDeliveries).toEqual([
      expect.objectContaining({
        productId: 'logs',
        units: 10,
        destinationFacilityId: 'sawmill',
      }),
    ]);
    expect(result.completedDeliveries[0].operatingProfit)
      .toBeGreaterThan(0);
    expect(result.freightProgress).toEqual(input.freightProgress);
    expect(result.company.ledger.filter(
      ({ category }) => category === 'contract-bonus',
    )).toEqual([]);
  });

  it('does not award progress or a grant for an unprofitable full logs delivery', () => {
    const input = loadedAtSawmill(60, {
      currentTripRunningCost: 100_000,
    });

    const result = deliverRemainingCargo(input);

    expect(result.completedDeliveries[0]).toEqual(expect.objectContaining({
      productId: 'logs',
      units: 60,
      destinationFacilityId: 'sawmill',
    }));
    expect(result.completedDeliveries[0].operatingProfit)
      .toBeLessThan(0);
    expect(result.freightProgress).toEqual(input.freightProgress);
    expect(result.company.ledger.filter(
      ({ category }) => category === 'contract-bonus',
    )).toEqual([]);
  });

  it('latches a profitable full structural-timber delivery only at the Prefabrication Plant', () => {
    const input = makeInput();
    const prefabDefinition = ProductCatalog.getFacilityDefinition(
      'prefabrication-plant',
    );
    if (!prefabDefinition) {
      throw new Error('Prefabrication Plant definition is missing');
    }
    const prefab = makeFacility(prefabDefinition, 900);
    input.economy.facilities.push(prefab);
    input.trains = [makeFreightTrainDef({
      cargo: {
        productId: 'structural-timber',
        units: 10,
        loadedUnits: 60,
        originFacilityId: 'sawmill',
      },
      operations: {
        ...makeFreightTrainDef().operations,
        currentTripRevenue: 5_000,
        currentTripRunningCost: 1_000,
      },
    })];
    input.runtime = [makeRuntime('train-1', { x: 900 })];

    const result = proposeCargoTick(input);

    expect(result.completedDeliveries).toEqual([
      expect.objectContaining({
        productId: 'structural-timber',
        units: 60,
        destinationFacilityId: prefab.id,
        operatingProfit: expect.any(Number),
      }),
    ]);
    expect(result.completedDeliveries[0].operatingProfit)
      .toBeGreaterThan(0);
    expect(result.freightProgress).toEqual({
      progressVersion: 1,
      profitableLogDeliveryCompleted: false,
      developmentGrantAwarded: false,
      profitableStructuralTimberDeliveryCompleted: true,
    });
    expect(result.company.ledger.filter(
      ({ category }) => category === 'contract-bonus',
    )).toEqual([]);
  });

  it('does not award the log grant for a full profitable delivery to a non-sawmill definition', () => {
    const input = loadedAtSawmill(10, {
      currentTripRevenue: 5_000,
      currentTripRunningCost: 1_000,
    });
    input.trains[0].cargo!.loadedUnits = 60;
    const sawmillDefinition = ProductCatalog.getFacilityDefinition('sawmill');
    if (!sawmillDefinition) throw new Error('Sawmill definition is missing');
    const otherSawmillDefinition: FacilityDefinition = {
      ...sawmillDefinition,
      id: 'other-sawmill',
      displayName: 'Other Sawmill',
    };
    const originalGetFacilityDefinition =
      ProductCatalog.getFacilityDefinition;
    jest.spyOn(ProductCatalog, 'getFacilityDefinition')
      .mockImplementation((definitionId) =>
        definitionId === otherSawmillDefinition.id
          ? otherSawmillDefinition
          : originalGetFacilityDefinition(definitionId));
    input.economy.facilities = input.economy.facilities.map(
      (candidate) => candidate.definitionId === 'sawmill'
        ? makeFacility(otherSawmillDefinition, 500)
        : candidate,
    );

    const result = proposeCargoTick(input);

    expect(result.completedDeliveries).toEqual([
      expect.objectContaining({
        productId: 'logs',
        units: 60,
        destinationFacilityId: 'other-sawmill',
      }),
    ]);
    expect(result.freightProgress).toEqual(input.freightProgress);
    expect(result.company.ledger.filter(
      ({ category }) => category === 'contract-bonus',
    )).toEqual([]);
  });

  it('never posts a second development grant after the awarded state is reloaded', () => {
    const input = loadedAtSawmill(10, {
      currentTripRevenue: 5_000,
      currentTripRunningCost: 1_000,
    });
    input.trains[0].cargo!.loadedUnits = 60;
    const awarded = postLedgerEntry(input.company, {
      category: 'contract-bonus',
      magnitude: 250_000,
      tick: 4,
      referenceId: 'regional-development-grant:v1',
      direction: 'forward',
    });
    if (awarded.ok === false) throw new Error(awarded.code);
    input.company = JSON.parse(JSON.stringify(awarded.company));
    input.freightProgress = {
      progressVersion: 1,
      profitableLogDeliveryCompleted: true,
      developmentGrantAwarded: true,
      profitableStructuralTimberDeliveryCompleted: false,
    };

    const result = proposeCargoTick(input);

    expect(result.freightProgress).toEqual(input.freightProgress);
    expect(result.company.ledger.filter(
      ({ referenceId }) =>
        referenceId === 'regional-development-grant:v1',
    )).toHaveLength(1);
  });

  it('rejects the whole final delivery when the grant would overflow cash', () => {
    const quoteInput = loadedAtSawmill(10, {
      currentTripRevenue: 5_000,
      currentTripRunningCost: 1_000,
    });
    const sawmill = facility(quoteInput.economy, 'sawmill');
    const quote = quoteLocalProduct(
      'logs',
      quoteInput.economy.market,
      { ...sawmill.inventories.logs },
    );
    if (quote.ok === false) throw new Error(quote.code);
    quoteInput.trains[0].cargo!.loadedUnits = 60;
    quoteInput.company = createCompanyState(
      Number.MAX_SAFE_INTEGER - quote.unitPrice * 10,
    );
    const before = JSON.parse(JSON.stringify(quoteInput));

    const result = proposeCargoTick(quoteInput);

    expect(result.changed).toBe(false);
    expect(result.company).toEqual(before.company);
    expect(result.economy).toEqual(before.economy);
    expect(result.trains).toEqual(before.trains);
    expect(result.freightProgress).toEqual(before.freightProgress);
    expect(result.completedDeliveries).toEqual([]);
  });

  it('rolls back earlier trains when a later grant post fails', () => {
    const input = loadedAtSawmill(10, {
      currentTripRevenue: 5_000,
      currentTripRunningCost: 1_000,
    });
    const sawmill = facility(input.economy, 'sawmill');
    const quote = quoteLocalProduct(
      'logs',
      input.economy.market,
      { ...sawmill.inventories.logs },
    );
    if (quote.ok === false) throw new Error(quote.code);
    input.company = createCompanyState(
      Number.MAX_SAFE_INTEGER - quote.unitPrice * 10,
    );
    input.trains = [
      makeFreightTrainDef({
        id: 'a-loader',
        cargo: null,
      }),
      makeFreightTrainDef({
        id: 'z-grant',
        cargo: {
          productId: 'logs',
          units: 10,
          loadedUnits: 60,
          originFacilityId: 'managed-forest',
        },
        operations: {
          ...makeFreightTrainDef().operations,
          currentTripRevenue: 5_000,
          currentTripRunningCost: 1_000,
        },
      }),
    ];
    input.runtime = [
      makeRuntime('a-loader', { x: -500, trackT: 0.1 }),
      makeRuntime('z-grant', { x: 500, trackT: 0.9 }),
    ];
    const before = JSON.parse(JSON.stringify(input));

    const result = proposeCargoTick(input);

    expect(result).toEqual(expect.objectContaining({
      changed: false,
      company: before.company,
      economy: before.economy,
      trains: before.trains,
      freightProgress: before.freightProgress,
      statuses: [],
      completedDeliveries: [],
    }));
  });

  it('rejects the whole proposal when persisted freight progress is invalid', () => {
    const input = loadedAtSawmill(10);
    input.trains[0].cargo!.loadedUnits = 60;
    (input.freightProgress as any).developmentGrantAwarded =
      Number.MAX_SAFE_INTEGER;
    const before = JSON.parse(JSON.stringify(input));

    const result = proposeCargoTick(input);

    expect(result.changed).toBe(false);
    expect(result.company).toEqual(before.company);
    expect(result.economy).toEqual(before.economy);
    expect(result.trains).toEqual(before.trains);
    expect(result.freightProgress).toEqual(before.freightProgress);
    expect(result.completedDeliveries).toEqual([]);
  });

  it.each([
    ['null', null],
    ['number', 7],
    ['string', 'invalid'],
    ['array', []],
  ])('fails closed for %s freight progress at the proposal boundary', (
    _name,
    malformedProgress,
  ) => {
    const input = makeInput();
    (input as unknown as { freightProgress: unknown }).freightProgress =
      malformedProgress;
    const before = JSON.parse(JSON.stringify(input));
    let result: CargoTickProposal | null = null;

    expect(() => {
      result = proposeCargoTick(input);
    }).not.toThrow();

    expect(result).toEqual(expect.objectContaining({
      changed: false,
      company: before.company,
      economy: before.economy,
      trains: before.trains,
      freightProgress: before.freightProgress,
      statuses: [],
      completedDeliveries: [],
    }));
  });

  it.each([
    {
      name: 'lower validated construction factor',
      constructionIndexBps: 8_500,
    },
    {
      name: 'upper validated construction factor',
      constructionIndexBps: 11_500,
    },
  ])(
    'reprices six batches independently at the $name',
    ({ constructionIndexBps }) => {
      let input = loadedAtSawmill(60, {
        currentTripRunningCost: 5_000,
      });
      input.economy.market.constructionIndexBps = constructionIndexBps;
      input.economy.market.regionalDemandBpsByProduct.logs = 10_000;
      const initialCash = input.company.cash;
      const expectedPrices: number[] = [];
      const actualRevenues: number[] = [];
      let final: CargoTickProposal | null = null;

      for (let batch = 0; batch < 6; batch += 1) {
        const destinationSlot = facility(
          input.economy,
          'sawmill',
        ).inventories.logs;
        const quote = quoteLocalProduct(
          'logs',
          input.economy.market,
          { ...destinationSlot },
        );
        if (quote.ok === false) {
          throw new Error(`Unexpected quote rejection: ${quote.code}`);
        }
        expectedPrices.push(quote.unitPrice);

        const proposal = proposeCargoTick(input);
        actualRevenues.push(proposal.statuses[0].batchRevenue);
        expect(proposal.statuses[0].batchRevenue).toBe(
          quote.unitPrice * 10,
        );
        expect(proposal.company.ledger).toHaveLength(
          input.company.ledger.length + (batch === 5 ? 2 : 1),
        );
        expect(proposal.completedDeliveries).toHaveLength(
          batch === 5 ? 1 : 0,
        );

        final = proposal;
        input = {
          operating: true,
          company: proposal.company,
          economy: proposal.economy,
          trains: proposal.trains,
          freightProgress: proposal.freightProgress,
          runtime: input.runtime,
        };
      }

      if (!final) throw new Error('Six-batch proposal did not run');
      const totalRevenue = actualRevenues.reduce(
        (total, revenue) => total + revenue,
        0,
      );
      expect(expectedPrices).toHaveLength(6);
      expect(new Set(expectedPrices).size).toBeGreaterThan(1);
      expect(final.company.ledger).toHaveLength(8);
      expect(final.company.cash).toBe(
        initialCash + totalRevenue + 250_000,
      );
      expect(final.trains[0].cargo).toBeNull();
      expect(final.trains[0].operations).toEqual({
        currentTripRevenue: 0,
        currentTripRunningCost: 0,
        lastTripRevenue: totalRevenue,
        lastTripRunningCost: 5_000,
        lifetimeDeliveredUnits: 60,
        lifetimeRevenue: totalRevenue,
        lifetimeRunningCost: 0,
      });
      expect(
        final.freightProgress.profitableLogDeliveryCompleted,
      ).toBe(totalRevenue > 5_000);
      expect(final.freightProgress.developmentGrantAwarded)
        .toBe(totalRevenue > 5_000);
      expect(final.completedDeliveries).toEqual([{
        trainId: 'train-1',
        productId: 'logs',
        units: 60,
        destinationFacilityId: 'sawmill',
        tick: input.economy.tick,
        revenue: totalRevenue,
        runningCost: 5_000,
        operatingProfit: totalRevenue - 5_000,
      }]);
      expect(totalRevenue).toBeGreaterThanOrEqual(5_290);
      expect(totalRevenue).toBeLessThanOrEqual(7_930);
    },
  );

  it('preserves an already-completed profitability latch', () => {
    const input = loadedAtSawmill(10, {
      currentTripRunningCost: 100_000,
    });
    const awarded = postLedgerEntry(input.company, {
      category: 'contract-bonus',
      magnitude: 250_000,
      tick: 4,
      referenceId: 'regional-development-grant:v1',
      direction: 'forward',
    });
    if (awarded.ok === false) throw new Error(awarded.code);
    input.company = awarded.company;
    input.freightProgress = {
      progressVersion: 1,
      profitableLogDeliveryCompleted: true,
      developmentGrantAwarded: true,
      profitableStructuralTimberDeliveryCompleted: false,
    };

    const result = proposeCargoTick(input);

    expect(result.freightProgress.profitableLogDeliveryCompleted).toBe(true);
  });
});

describe('proposeCargoTick output authority', () => {
  it('returns deeply frozen detached output without mutating any input', () => {
    const input = makeInput();
    const before = JSON.parse(JSON.stringify(input));

    const result = proposeCargoTick(input);

    expect(input).toEqual(before);
    expect(deepFreezeCheck(result)).toBe(true);
    expect(result.company).not.toBe(input.company);
    expect(result.economy).not.toBe(input.economy);
    expect(result.trains).not.toBe(input.trains);
    expect(result.freightProgress).not.toBe(input.freightProgress);
    expect(result.statuses).not.toBe(input.runtime);
    expect(result.economy.facilities[0]).not.toBe(
      input.economy.facilities[0],
    );
    expect(result.trains[0]).not.toBe(input.trains[0]);
  });
});
