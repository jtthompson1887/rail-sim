import type {
  EconomyStateDef,
  TrainDef,
} from '../../src/config/WorldData';
import type {
  CompanyStateDef,
  FacilityEconomyDef,
} from '../../src/economy/EconomyData';
import { quoteLocalProduct } from '../../src/economy/MarketSystem';
import {
  proposeCargoTick,
  type CargoTickProposal,
} from '../../src/freight/CargoSystem';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

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
  definitionId: 'managed-forest' | 'sawmill',
): FacilityEconomyDef => {
  const found = economy.facilities.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (!found) throw new Error(`Missing ${definitionId} fixture`);
  return found;
};

const expectSingleBlocked = (
  proposal: CargoTickProposal,
  blocker:
    | 'Stop the train to transfer cargo'
    | 'Move inside Managed Forest rail access'
    | 'Move inside Sawmill rail access'
    | 'Waiting for logs'
    | 'Timber set is full'
    | 'Sawmill input storage is full'
    | 'Cargo is not accepted here'
    | 'Insufficient cash for running costs'
    | 'Re-rail the train before operating',
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

describe('proposeCargoTick eligibility and facility resolution', () => {
  it('keeps the train idle outside Operate mode', () => {
    const result = propose({ operating: false });

    expect(result.changed).toBe(false);
    expect(result.statuses).toEqual([{
      trainId: 'train-1',
      facilityId: null,
      kind: 'idle',
      blocker: null,
      batchUnits: 0,
      cargoUnits: 0,
      capacityUnits: 60,
      batchRevenue: 0,
    }]);
  });

  it('still prioritizes derailment and movement blockers outside Operate mode', () => {
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

    expectSingleBlocked(derailed, 'Re-rail the train before operating');
    expectSingleBlocked(moving, 'Stop the train to transfer cargo');
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

    expectSingleBlocked(result, 'Re-rail the train before operating');
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

    expectSingleBlocked(result, 'Stop the train to transfer cargo');
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
      'Move inside Managed Forest rail access',
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

    expectSingleBlocked(result, 'Waiting for logs');
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
      'Move inside Managed Forest rail access',
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

    expectSingleBlocked(result, 'Move inside Sawmill rail access');
    expect(result.statuses[0].facilityId).toBe(sawmill.id);
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
      originFacilityId: forest.id,
    });
    expect(beforeLogs + beforeCargo).toBe(
      afterForest.inventories.logs.quantity
        + (afterTrain.cargo?.units ?? 0),
    );
  });

  it('extends compatible onboard logs while preserving the first origin', () => {
    const input = makeInput();
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 20,
        originFacilityId: 'original-forest',
      },
    });
    const forest = facility(input.economy, 'managed-forest');
    const beforeLogs = forest.inventories.logs.quantity;

    const result = proposeCargoTick({
      ...input,
      trains: [loaded],
    });

    expect(result.trains[0].cargo).toEqual({
      productId: 'logs',
      units: 30,
      originFacilityId: 'original-forest',
    });
    expect(
      beforeLogs + 20,
    ).toBe(
      facility(result.economy, 'managed-forest').inventories.logs.quantity
        + (result.trains[0].cargo?.units ?? 0),
    );
  });

  it('clamps a partial train to its remaining compatible capacity', () => {
    const loaded = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 55,
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

    expectSingleBlocked(result, 'Waiting for logs');
    expect(result.economy).toEqual(input.economy);
    expect(result.trains).toEqual(input.trains);
  });

  it('reports an exactly full compatible timber set', () => {
    const full = makeFreightTrainDef({
      cargo: {
        productId: 'logs',
        units: 60,
        originFacilityId: 'managed-forest',
      },
    });

    const result = propose({ trains: [full] });

    expectSingleBlocked(result, 'Timber set is full');
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
        originFacilityId: 'sawmill',
      },
    });

    const result = propose({ trains: [incompatible] });

    expectSingleBlocked(result, 'Cargo is not accepted here');
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

    expectSingleBlocked(result, 'Stop the train to transfer cargo');
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

  it('unloads destination-accepted cargo even when the freight set is unavailable', () => {
    const input = loadedAtSawmill(10, {
      currentTripRevenue: 100,
      currentTripRunningCost: 20,
      lifetimeDeliveredUnits: 4,
      lifetimeRevenue: 400,
    });
    input.trains[0].freightSetId = 'unavailable-freight-set';
    const sawmill = facility(input.economy, 'sawmill');
    const beforeSlot = { ...sawmill.inventories.logs };
    const quote = quoteLocalProduct(
      'logs',
      input.economy.market,
      beforeSlot,
    );
    if (quote.ok === false) {
      throw new Error(`Unexpected quote rejection: ${quote.code}`);
    }
    const batchRevenue = quote.unitPrice * 10;

    const result = proposeCargoTick(input);

    expect(result.statuses[0]).toEqual({
      trainId: 'train-1',
      facilityId: sawmill.id,
      kind: 'unloading',
      blocker: null,
      batchUnits: 10,
      cargoUnits: 0,
      capacityUnits: 0,
      batchRevenue,
    });
    expect(facility(result.economy, 'sawmill').inventories.logs).toEqual({
      ...beforeSlot,
      quantity: beforeSlot.quantity + 10,
      recentInflow: beforeSlot.recentInflow + 10,
    });
    expect(result.company.cash).toBe(input.company.cash + batchRevenue);
    expect(result.company.ledger).toEqual([
      ...input.company.ledger,
      {
        id: input.company.nextLedgerId,
        tick: input.economy.tick,
        category: 'delivery-revenue',
        ledgerClass: 'revenue',
        amount: batchRevenue,
        referenceId: `train-1:${input.economy.tick}:${sawmill.id}`,
      },
    ]);
    expect(result.trains[0].cargo).toBeNull();
    expect(result.trains[0].operations).toEqual({
      currentTripRevenue: 0,
      currentTripRunningCost: 0,
      lastTripRevenue: 100 + batchRevenue,
      lastTripRunningCost: 20,
      lifetimeDeliveredUnits: 14,
      lifetimeRevenue: 400 + batchRevenue,
      lifetimeRunningCost: 0,
    });
    expect(result.freightProgress.profitableLogDeliveryCompleted).toBe(true);
    expect(result.completedDeliveries).toEqual([{
      trainId: 'train-1',
      destinationFacilityId: sawmill.id,
      tick: input.economy.tick,
      revenue: 100 + batchRevenue,
      runningCost: 20,
      operatingProfit: 80 + batchRevenue,
    }]);
  });

  it('rejects cargo held in a Sawmill output slot without changing accounting', () => {
    const input = loadedAtSawmill(4, {
      currentTripRevenue: 100,
      currentTripRunningCost: 20,
      lifetimeDeliveredUnits: 3,
      lifetimeRevenue: 300,
    });
    input.trains[0].freightSetId = 'unavailable-freight-set';
    input.trains[0].cargo = {
      productId: 'structural-timber',
      units: 4,
      originFacilityId: 'other-sawmill',
    };

    const result = proposeCargoTick(input);

    expectSingleBlocked(result, 'Cargo is not accepted here');
    expect(result.statuses[0]).toEqual(expect.objectContaining({
      facilityId: 'sawmill',
      cargoUnits: 4,
      capacityUnits: 0,
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

    expectSingleBlocked(result, 'Sawmill input storage is full');
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
      destinationFacilityId: 'sawmill',
      tick: input.economy.tick,
      revenue: quote.unitPrice * 10,
      runningCost: quote.unitPrice * 10,
      operatingProfit: 0,
    }]);
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
          input.company.ledger.length + 1,
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
      expect(final.company.ledger).toHaveLength(7);
      expect(final.company.cash).toBe(initialCash + totalRevenue);
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
      expect(final.completedDeliveries).toEqual([{
        trainId: 'train-1',
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
    input.freightProgress = {
      progressVersion: 1,
      profitableLogDeliveryCompleted: true,
      developmentGrantAwarded: false,
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
