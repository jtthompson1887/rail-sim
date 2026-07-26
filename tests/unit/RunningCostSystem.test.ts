import type { TrainDef } from '../../src/config/WorldData';
import type { CompanyStateDef } from '../../src/economy/EconomyData';
import { createCompanyState } from '../../src/economy/FinanceLedger';
import {
  proposeRunningCosts,
  type RunningCostTickProposal,
} from '../../src/freight/RunningCostSystem';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
import { makeFreightTrainDef } from '../fixtures/FirstFreightRouteFixture';

const clone = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const makeTrain = (
  id: string,
  overrides: Partial<TrainDef> = {},
): TrainDef => {
  const train = makeFreightTrainDef({ id });
  return {
    ...train,
    ...overrides,
    operations: {
      ...train.operations,
      ...overrides.operations,
    },
  };
};

const makeRuntime = (
  trainId: string,
  overrides: Partial<TrainRuntimeSnapshot> = {},
): TrainRuntimeSnapshot => ({
  trainId,
  trackUUID: 'forest-sawmill-track',
  trackT: 0.1,
  facing: 1,
  x: 0,
  y: 0,
  speedWorldUnitsPerSecond: 0,
  throttle: 0,
  derailed: false,
  ...overrides,
});

const propose = (overrides: Partial<{
  tick: number;
  company: CompanyStateDef;
  trains: readonly TrainDef[];
  runtime: readonly TrainRuntimeSnapshot[];
}> = {}): RunningCostTickProposal => proposeRunningCosts({
  tick: 7,
  company: createCompanyState(1_000),
  trains: [makeTrain('train-1')],
  runtime: [makeRuntime('train-1', { throttle: 1 })],
  ...overrides,
});

const isDeepFrozen = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isDeepFrozen);
};

describe('proposeRunningCosts active attribution', () => {
  it.each([
    {
      name: 'powered while stopped',
      runtime: { throttle: 1 as const },
      active: true,
    },
    {
      name: 'unpowered while moving above the stop limit',
      runtime: { speedWorldUnitsPerSecond: 2.000001 },
      active: true,
    },
    {
      name: 'fully stopped',
      runtime: {},
      active: false,
    },
    {
      name: 'zero throttle at exactly the stop limit',
      runtime: { speedWorldUnitsPerSecond: 2 },
      active: false,
    },
    {
      name: 'derailed while powered',
      runtime: { throttle: 1 as const, derailed: true },
      active: false,
    },
  ])('charges one timber-set cost when $name', ({
    runtime,
    active,
  }) => {
    const result = propose({
      runtime: [makeRuntime('train-1', runtime)],
    });

    expect(result.activeTrainIds).toEqual(active ? ['train-1'] : []);
    expect(result.aggregateCost).toBe(active ? 20 : 0);
    expect(result.changed).toBe(active);
    expect(result.company.cash).toBe(active ? 980 : 1_000);
    expect(result.company.ledger.filter(
      ({ category }) => category === 'train-running-cost',
    )).toHaveLength(active ? 1 : 0);
    expect(result.trains[0].operations.currentTripRunningCost)
      .toBe(active ? 20 : 0);
    expect(result.trains[0].operations.lifetimeRunningCost)
      .toBe(active ? 20 : 0);
  });

  it('charges only trains with an active runtime snapshot', () => {
    const trains = [
      makeTrain('missing-runtime'),
      makeTrain('inactive'),
      makeTrain('derailed'),
      makeTrain('active'),
    ];

    const result = propose({
      trains,
      runtime: [
        makeRuntime('inactive'),
        makeRuntime('derailed', { throttle: 1, derailed: true }),
        makeRuntime('active', { speedWorldUnitsPerSecond: 3 }),
      ],
    });

    expect(result.activeTrainIds).toEqual(['active']);
    expect(result.aggregateCost).toBe(20);
    expect(result.trains.map((train) => ({
      id: train.id,
      trip: train.operations.currentTripRunningCost,
      lifetime: train.operations.lifetimeRunningCost,
    }))).toEqual([
      { id: 'missing-runtime', trip: 0, lifetime: 0 },
      { id: 'inactive', trip: 0, lifetime: 0 },
      { id: 'derailed', trip: 0, lifetime: 0 },
      { id: 'active', trip: 20, lifetime: 20 },
    ]);
  });

  it('posts one aggregate entry and attributes each same-SKU train its exact set cost', () => {
    const trains = [
      makeTrain('timber-c'),
      makeTrain('timber-a'),
      makeTrain('timber-b'),
    ];
    const result = propose({
      trains,
      runtime: trains.map((train) => makeRuntime(
        train.id,
        { throttle: 1 },
      )),
    });

    expect(result.activeTrainIds).toEqual([
      'timber-a',
      'timber-b',
      'timber-c',
    ]);
    expect(result.stopTrainIds).toEqual([]);
    expect(result.aggregateCost).toBe(60);
    expect(result.company.cash).toBe(940);
    expect(result.company.ledger.slice(1)).toEqual([{
      id: 2,
      tick: 7,
      category: 'train-running-cost',
      ledgerClass: 'operating-expense',
      amount: -60,
      referenceId: 'active-trains:7',
    }]);
    expect(result.trains.map((train) => ({
      id: train.id,
      trip: train.operations.currentTripRunningCost,
      lifetime: train.operations.lifetimeRunningCost,
    }))).toEqual([
      { id: 'timber-c', trip: 20, lifetime: 20 },
      { id: 'timber-a', trip: 20, lifetime: 20 },
      { id: 'timber-b', trip: 20, lifetime: 20 },
    ]);
    expect(result.blockerByTrainId).toEqual({
      'timber-a': null,
      'timber-b': null,
      'timber-c': null,
    });
  });
});

describe('proposeRunningCosts atomicity and pure output', () => {
  it('stops every active train without ledger or statistics when aggregate cash is insufficient', () => {
    const company = clone(createCompanyState(59));
    const trains = [
      makeTrain('timber-c'),
      makeTrain('timber-a'),
      makeTrain('timber-b'),
    ];
    const originalCompany = clone(company);
    const originalTrains = clone(trains);

    const result = propose({
      company,
      trains,
      runtime: trains.map((train) => makeRuntime(
        train.id,
        { throttle: 1 },
      )),
    });

    expect(result).toEqual(expect.objectContaining({
      company: originalCompany,
      trains: originalTrains,
      activeTrainIds: ['timber-a', 'timber-b', 'timber-c'],
      stopTrainIds: ['timber-a', 'timber-b', 'timber-c'],
      aggregateCost: 60,
      blockerByTrainId: {
        'timber-a': 'Insufficient cash for running costs',
        'timber-b': 'Insufficient cash for running costs',
        'timber-c': 'Insufficient cash for running costs',
      },
      changed: false,
    }));
    expect(result.company.ledger).toHaveLength(1);
    expect(result.company).not.toBe(company);
    expect(result.trains).not.toBe(trains);
    expect(result.trains[0]).not.toBe(trains[0]);
    expect(isDeepFrozen(result)).toBe(true);

    company.cash = 0;
    trains[0].operations.currentTripRunningCost = 999;
    expect(result.company).toEqual(originalCompany);
    expect(result.trains).toEqual(originalTrains);
  });

  it('rejects an unsafe statistics total without posting partial authority', () => {
    const company = clone(createCompanyState(1_000));
    const trains = [makeTrain('train-1', {
      operations: {
        ...makeTrain('unused').operations,
        currentTripRunningCost: Number.MAX_SAFE_INTEGER - 10,
        lifetimeRunningCost: Number.MAX_SAFE_INTEGER - 10,
      },
    })];
    const originalCompany = clone(company);
    const originalTrains = clone(trains);

    const result = propose({
      company,
      trains,
      runtime: [makeRuntime('train-1', { throttle: 1 })],
    });

    expect(result).toEqual(expect.objectContaining({
      company: originalCompany,
      trains: originalTrains,
      activeTrainIds: ['train-1'],
      stopTrainIds: [],
      aggregateCost: 20,
      blockerByTrainId: { 'train-1': null },
      changed: false,
    }));
    expect(result.company.ledger).toHaveLength(1);
    expect(isDeepFrozen(result)).toBe(true);
  });

  it('returns detached frozen authority after a successful proposal', () => {
    const company = clone(createCompanyState(1_000));
    const trains = [makeTrain('train-1')];
    const result = propose({ company, trains });

    expect(result.company).not.toBe(company);
    expect(result.trains).not.toBe(trains);
    expect(result.trains[0]).not.toBe(trains[0]);
    expect(isDeepFrozen(result)).toBe(true);

    company.cash = 0;
    trains[0].operations.currentTripRunningCost = 999;
    expect(result.company.cash).toBe(980);
    expect(result.trains[0].operations.currentTripRunningCost).toBe(20);
  });
});
