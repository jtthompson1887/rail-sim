/**
 * @jest-environment ./tests/performance/CoverageAwareNodeEnvironment.js
 */

import {
  validateWorldData,
  type WorldData,
} from '../../src/config/WorldData';
import {
  EconomySystem,
  type EconomyWorldPort,
  type EconomyUpdateResult,
} from '../../src/economy/EconomySystem';
import { potentialAcceptedProduct } from '../../src/freight/FacilityCargoRules';
import type { OperationsDraft } from '../../src/managers/WorldManager';
import {
  clonePlainData,
  equalPlainData,
} from '../../src/utils/PlainData';
import {
  makeEconomyTickBenchmarkFixture,
  type EconomyTickBenchmarkState,
} from '../fixtures/StructuralTimberLinkFixture';

const WARMUP_TICKS = 100;
const MEASURED_TICKS = 500;
const P95_BUDGET_MS = 16;
const BENCHMARK_FREIGHT_SET_IDS = [
  'flatbed-freight-set',
  'aggregate-hopper-set',
  'covered-cement-set',
] as const;
const collectingCoverage = (
  globalThis as typeof globalThis & {
    readonly __RAIL_SIM_COLLECT_COVERAGE__: boolean;
  }
).__RAIL_SIM_COLLECT_COVERAGE__;

class BenchmarkWorldPort implements EconomyWorldPort {
  private current: WorldData;
  private batchInProgress = false;

  constructor(initial: WorldData) {
    this.current = clonePlainData(initial);
  }

  get world(): WorldData {
    return this.current;
  }

  applyOperationsBatch(
    expectedRevision: number,
    mutate: (draft: OperationsDraft) => boolean,
  ): boolean {
    const world = this.current;
    if (this.batchInProgress
      || world.revision !== expectedRevision
      || !Number.isSafeInteger(world.revision)
      || world.revision < 0
      || world.revision >= Number.MAX_SAFE_INTEGER
      || !Number.isSafeInteger(world.operationsRevision)
      || world.operationsRevision < 0
      || world.operationsRevision >= Number.MAX_SAFE_INTEGER
      || !validateWorldData(world).compatible) return false;
    const before = clonePlainData(world);
    const draft: OperationsDraft = {
      company: clonePlainData(before.company),
      economy: clonePlainData(before.economy),
      trains: clonePlainData(before.trains),
      freightProgress: clonePlainData(before.freightProgress),
    };
    this.batchInProgress = true;
    try {
      if (!mutate(draft)
        || this.current !== world
        || !equalPlainData(world, before)
        || (equalPlainData(draft.company, before.company)
          && equalPlainData(draft.economy, before.economy)
          && equalPlainData(draft.trains, before.trains)
          && equalPlainData(
            draft.freightProgress,
            before.freightProgress,
          ))) return false;

      const candidate: WorldData = {
        ...before,
        revision: before.revision + 1,
        operationsRevision: before.operationsRevision + 1,
        company: draft.company,
        economy: draft.economy,
        trains: draft.trains,
        freightProgress: draft.freightProgress,
      };
      if (!validateWorldData(candidate).compatible) return false;

      world.company = clonePlainData(candidate.company);
      world.economy = clonePlainData(candidate.economy);
      world.trains = clonePlainData(candidate.trains);
      world.freightProgress = clonePlainData(candidate.freightProgress);
      world.revision = candidate.revision;
      world.operationsRevision = candidate.operationsRevision;
      return true;
    } finally {
      this.batchInProgress = false;
    }
  }

  snapshot(): WorldData {
    return clonePlainData(this.current);
  }
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [
        key,
        canonicalize(record[key]),
      ]),
    );
  }
  return value;
};

const stableHash = (value: unknown): string => {
  const serialized = JSON.stringify(canonicalize(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const economyAuthorityHash = (world: WorldData): string => stableHash({
  revision: world.revision,
  operationsRevision: world.operationsRevision,
  company: world.company,
  economy: world.economy,
  trains: world.trains,
  freightProgress: world.freightProgress,
});

const percentile95 = (durations: readonly number[]): number => {
  const sorted = [...durations].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
};

const run = (measure: boolean) => {
  const fixture = makeEconomyTickBenchmarkFixture();
  const port = new BenchmarkWorldPort(fixture.world);
  const economy = new EconomySystem(port);
  let firstTick: EconomyUpdateResult | null = null;

  for (let index = 0; index < WARMUP_TICKS; index += 1) {
    const result = economy.update(1_000, true, fixture.runtime);
    if (index === 0) firstTick = result;
    expect(result).toMatchObject({
      ticksAdvanced: 1,
      commitRejected: false,
      authoritativeChanged: true,
    });
  }

  const durations: number[] = [];
  for (let index = 0; index < MEASURED_TICKS; index += 1) {
    const startedAt = performance.now();
    const result = economy.update(1_000, true, fixture.runtime);
    if (measure) durations.push(performance.now() - startedAt);
    expect(result).toMatchObject({
      ticksAdvanced: 1,
      commitRejected: false,
      authoritativeChanged: true,
    });
  }

  const world = port.snapshot();
  return {
    fixture,
    durations,
    firstTick,
    world,
    hash: economyAuthorityHash(world),
  };
};

describe('EconomySystem multi-train tick budget', () => {
  it('advances a valid mixed-state fixture deterministically within the uninstrumented budget', () => {
    const first = run(true);
    const second = run(false);
    const stateCounts = Object.values(first.fixture.stateByTrainId).reduce(
      (counts, state) => ({
        ...counts,
        [state]: counts[state] + 1,
      }),
      {
        loading: 0,
        transit: 0,
        unloading: 0,
        idle: 0,
        'full-destination': 0,
        contention: 0,
      } satisfies Record<EconomyTickBenchmarkState, number>,
    );
    const freightSetCounts = Object.fromEntries(
      BENCHMARK_FREIGHT_SET_IDS.map((freightSetId) => [
        freightSetId,
        first.fixture.world.trains.filter(
          (train) => train.freightSetId === freightSetId,
        ).length,
      ]),
    );
    const stateSetCounts = Object.fromEntries(
      Object.keys(stateCounts).map((state) => [
        state,
        Object.fromEntries(BENCHMARK_FREIGHT_SET_IDS.map((freightSetId) => [
          freightSetId,
          first.fixture.world.trains.filter((train) =>
            first.fixture.stateByTrainId[train.id] === state
              && train.freightSetId === freightSetId).length,
        ])),
      ]),
    );
    const p95 = percentile95(first.durations);
    const firstStatusByTrainId = Object.fromEntries(
      first.firstTick!.cargoStatuses.map((status) => [
        status.trainId,
        { kind: status.kind, blocker: status.blocker },
      ]),
    );

    expect(validateWorldData(first.fixture.world).compatible).toBe(true);
    expect(first.fixture.world.economy.facilities).toHaveLength(7);
    expect(first.fixture.world.trains).toHaveLength(12);
    const initialFullDestinationTrains = first.fixture.world.trains.filter(
      (train) =>
        first.fixture.stateByTrainId[train.id] === 'full-destination',
    );
    expect(initialFullDestinationTrains).toHaveLength(2);
    initialFullDestinationTrains.forEach((train) => {
      const runtime = first.fixture.runtime.find(
        (candidate) => candidate.trainId === train.id,
      );
      const productId = train.cargo?.productId;
      expect(runtime).toBeDefined();
      expect(productId).toBeDefined();
      const compatibleDestinations =
        first.fixture.world.economy.facilities.filter((facility) =>
          runtime !== undefined
          && productId !== undefined
          && Math.hypot(
            runtime.x - facility.railAccess.x,
            runtime.y - facility.railAccess.y,
          ) <= facility.railAccess.radius
          && potentialAcceptedProduct(facility, productId) !== null);
      expect(compatibleDestinations).toHaveLength(1);
      const destination = compatibleDestinations[0];
      const slot = destination?.inventories[productId!];
      expect(slot).toBeDefined();
      expect(slot!.quantity).toBe(slot!.capacity);
    });
    expect(freightSetCounts).toEqual({
      'flatbed-freight-set': 4,
      'aggregate-hopper-set': 4,
      'covered-cement-set': 4,
    });
    expect(stateSetCounts).toEqual({
      loading: {
        'flatbed-freight-set': 1,
        'aggregate-hopper-set': 1,
        'covered-cement-set': 0,
      },
      transit: {
        'flatbed-freight-set': 1,
        'aggregate-hopper-set': 1,
        'covered-cement-set': 0,
      },
      unloading: {
        'flatbed-freight-set': 0,
        'aggregate-hopper-set': 1,
        'covered-cement-set': 1,
      },
      idle: {
        'flatbed-freight-set': 0,
        'aggregate-hopper-set': 1,
        'covered-cement-set': 1,
      },
      'full-destination': {
        'flatbed-freight-set': 2,
        'aggregate-hopper-set': 0,
        'covered-cement-set': 0,
      },
      contention: {
        'flatbed-freight-set': 0,
        'aggregate-hopper-set': 0,
        'covered-cement-set': 2,
      },
    });
    expect(stateCounts).toEqual({
      loading: 2,
      transit: 2,
      unloading: 2,
      idle: 2,
      'full-destination': 2,
      contention: 2,
    });
    expect(firstStatusByTrainId).toEqual({
      'contention-a': { kind: 'loading', blocker: null },
      'contention-b': { kind: 'blocked', blocker: 'source-empty' },
      'full-destination-a': {
        kind: 'blocked',
        blocker: 'destination-full',
      },
      'full-destination-b': {
        kind: 'blocked',
        blocker: 'destination-full',
      },
      'idle-a': { kind: 'blocked', blocker: 'outside-eligible-facility' },
      'idle-b': { kind: 'blocked', blocker: 'outside-eligible-facility' },
      'loading-a': { kind: 'loading', blocker: null },
      'loading-b': { kind: 'loading', blocker: null },
      'transit-a': { kind: 'blocked', blocker: 'train-moving' },
      'transit-b': { kind: 'blocked', blocker: 'train-moving' },
      'unloading-a': { kind: 'unloading', blocker: null },
      'unloading-b': { kind: 'unloading', blocker: null },
    });
    expect(first.durations).toHaveLength(MEASURED_TICKS);
    expect(first.world.economy.tick).toBe(600);
    expect(first.world.operationsRevision).toBe(600);
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toBe('6b45cd75');
    expect(Number.isFinite(p95)).toBe(true);
    expect(p95).toBeGreaterThanOrEqual(0);
    if (!collectingCoverage) {
      expect(p95).toBeLessThan(P95_BUDGET_MS);
    }

    console.info(
      `[economy-tick-benchmark] trains=12 facilities=7 samples=500 `
      + `p95=${p95.toFixed(3)}ms hash=${first.hash} `
      + `mode=${collectingCoverage ? 'coverage' : 'budget'}`,
    );
  });
});
