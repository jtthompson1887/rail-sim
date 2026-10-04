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
import {
  potentialAcceptedProduct,
  potentialLoadProducts,
} from '../../src/freight/FacilityCargoRules';
import { getFreightSet } from '../../src/freight/FreightSetCatalog';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
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
const FINAL_AUTHORITY_TICKS = 600;
const P95_BUDGET_MS = 16;
const MIN_ACTIVE_TRANSFER_SAMPLE_COUNT = Math.ceil(MEASURED_TICKS * 0.10);
const TAIL_SAMPLE_WINDOW = 25;
const TAIL_SAMPLE_START = MEASURED_TICKS - TAIL_SAMPLE_WINDOW + 1;
const BENCHMARK_FREIGHT_SET_IDS = [
  'flatbed-freight-set',
  'aggregate-hopper-set',
  'covered-cement-set',
] as const;
const BENCHMARK_FACILITY_DEFINITION_IDS = [
  'managed-forest',
  'sawmill',
  'quarry',
  'cement-works',
  'port-interchange',
  'prefabrication-plant',
  'town-construction-market',
] as const;
const BENCHMARK_PRODUCT_CAPACITY = {
  logs: 60,
  'structural-timber': 60,
  'limestone-aggregate': 120,
  cement: 80,
  steel: 60,
  'building-modules': 4,
} as const;
const BENCHMARK_CYCLIC_ROUTES = [
  {
    trainId: 'unloading-c',
    freightSetId: 'flatbed-freight-set',
    productId: 'logs',
    sourceDefinitionId: 'managed-forest',
    destinationDefinitionId: 'sawmill',
  },
  {
    trainId: 'full-destination-a',
    freightSetId: 'flatbed-freight-set',
    productId: 'structural-timber',
    sourceDefinitionId: 'sawmill',
    destinationDefinitionId: 'prefabrication-plant',
  },
  {
    trainId: 'unloading-a',
    freightSetId: 'aggregate-hopper-set',
    productId: 'limestone-aggregate',
    sourceDefinitionId: 'quarry',
    destinationDefinitionId: 'cement-works',
  },
  {
    trainId: 'unloading-b',
    freightSetId: 'covered-cement-set',
    productId: 'cement',
    sourceDefinitionId: 'cement-works',
    destinationDefinitionId: 'prefabrication-plant',
  },
  {
    trainId: 'unloading-d',
    freightSetId: 'flatbed-freight-set',
    productId: 'steel',
    sourceDefinitionId: 'port-interchange',
    destinationDefinitionId: 'prefabrication-plant',
  },
  {
    trainId: 'unloading-e',
    freightSetId: 'flatbed-freight-set',
    productId: 'building-modules',
    sourceDefinitionId: 'prefabrication-plant',
    destinationDefinitionId: 'town-construction-market',
  },
] as const;
const EXPECTED_ROUTE_TUPLES = BENCHMARK_CYCLIC_ROUTES.map((route) =>
  `${route.productId}:`
  + `${route.sourceDefinitionId}->${route.destinationDefinitionId}`)
  .sort();
// Standard regional legs keep real transfers distributed across the window.
const STANDARD_INITIAL_OUTBOUND_TICKS = 20;
const STANDARD_REGIONAL_OUTBOUND_TICKS = 60;
const STANDARD_REGIONAL_RETURN_TICKS = 140;
// The longer steel return preserves the Port's finite second consignment.
const FINITE_STEEL_RETURN_TICKS = 300;
// The module return places its second real delivery in the tail without
// relying on deferred Town consumption; its final outbound leg stays local.
const MODULE_TAIL_RETURN_TICKS = 454;
const MODULE_LOCAL_OUTBOUND_TICKS = 5;
const TRANSIT_PACING_BY_TRAIN_ID: Readonly<Record<
string,
{
  readonly initialOutboundTicks: number;
  readonly outboundTicks: number;
  readonly returnTicks: number;
}
>> = {
  'unloading-c': {
    initialOutboundTicks: STANDARD_INITIAL_OUTBOUND_TICKS,
    outboundTicks: STANDARD_REGIONAL_OUTBOUND_TICKS,
    returnTicks: STANDARD_REGIONAL_RETURN_TICKS,
  },
  'full-destination-a': {
    initialOutboundTicks: STANDARD_INITIAL_OUTBOUND_TICKS,
    outboundTicks: STANDARD_REGIONAL_OUTBOUND_TICKS,
    returnTicks: STANDARD_REGIONAL_RETURN_TICKS,
  },
  'unloading-a': {
    initialOutboundTicks: STANDARD_INITIAL_OUTBOUND_TICKS,
    outboundTicks: STANDARD_REGIONAL_OUTBOUND_TICKS,
    returnTicks: STANDARD_REGIONAL_RETURN_TICKS,
  },
  'unloading-b': {
    initialOutboundTicks: STANDARD_INITIAL_OUTBOUND_TICKS,
    outboundTicks: STANDARD_REGIONAL_OUTBOUND_TICKS,
    returnTicks: STANDARD_REGIONAL_RETURN_TICKS,
  },
  'unloading-d': {
    initialOutboundTicks: STANDARD_INITIAL_OUTBOUND_TICKS,
    outboundTicks: STANDARD_REGIONAL_OUTBOUND_TICKS,
    returnTicks: FINITE_STEEL_RETURN_TICKS,
  },
  'unloading-e': {
    initialOutboundTicks: STANDARD_INITIAL_OUTBOUND_TICKS,
    outboundTicks: MODULE_LOCAL_OUTBOUND_TICKS,
    returnTicks: MODULE_TAIL_RETURN_TICKS,
  },
};
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

const expectRegionalConstructionFixture = (
  fixture: ReturnType<typeof makeEconomyTickBenchmarkFixture>,
): void => {
  expect(validateWorldData(fixture.world).compatible).toBe(true);
  expect(fixture.world.economy.facilities.map(
    ({ definitionId }) => definitionId,
  )).toEqual(BENCHMARK_FACILITY_DEFINITION_IDS);
  expect(fixture.world.trains).toHaveLength(16);

  const freightSetCounts = Object.fromEntries(
    BENCHMARK_FREIGHT_SET_IDS.map((freightSetId) => [
      freightSetId,
      fixture.world.trains.filter(
        (train) => train.freightSetId === freightSetId,
      ).length,
    ]),
  );
  expect(freightSetCounts).toEqual({
    'flatbed-freight-set': 8,
    'aggregate-hopper-set': 4,
    'covered-cement-set': 4,
  });

  const cargoProductIds = [...new Set(fixture.world.trains.flatMap(
    (train) => train.cargo === null ? [] : [train.cargo.productId],
  ))].sort();
  expect(cargoProductIds).toEqual([
    'building-modules',
    'cement',
    'limestone-aggregate',
    'logs',
    'steel',
    'structural-timber',
  ]);

  const flatbedProductIds = [...new Set(fixture.world.trains.flatMap(
    (train) => train.freightSetId !== 'flatbed-freight-set'
      || train.cargo === null
      ? []
      : [train.cargo.productId],
  ))].sort();
  expect(flatbedProductIds).toEqual([
    'building-modules',
    'logs',
    'steel',
    'structural-timber',
  ]);

  fixture.world.trains.forEach((train) => {
    if (train.cargo === null) return;
    const expectedCapacity = BENCHMARK_PRODUCT_CAPACITY[
      train.cargo.productId as keyof typeof BENCHMARK_PRODUCT_CAPACITY
    ];
    expect(expectedCapacity).toBeDefined();
    expect(train.cargo.units).toBe(expectedCapacity);
    expect(train.cargo.loadedUnits).toBe(expectedCapacity);
  });

  BENCHMARK_CYCLIC_ROUTES.forEach((route) => {
    const train = fixture.world.trains.find(
      ({ id }) => id === route.trainId,
    );
    const source = fixture.world.economy.facilities.find(
      ({ definitionId }) => definitionId === route.sourceDefinitionId,
    );
    const destination = fixture.world.economy.facilities.find(
      ({ definitionId }) => definitionId
        === route.destinationDefinitionId,
    );
    const freightSet = getFreightSet(route.freightSetId);
    expect(train?.freightSetId).toBe(route.freightSetId);
    expect(source).toBeDefined();
    expect(destination).toBeDefined();
    expect(freightSet).toBeDefined();
    expect(potentialLoadProducts(source!, freightSet!)).toContainEqual(
      expect.objectContaining({ productId: route.productId }),
    );
    expect(potentialAcceptedProduct(destination!, route.productId))
      .not.toBeNull();
  });
};

const percentile95 = (durations: readonly number[]): number => {
  const sorted = [...durations].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
};

type CargoStatus = EconomyUpdateResult['cargoStatuses'][number];
type DeliveryEvent = EconomyUpdateResult['completedDeliveries'][number];

interface SampledStatus {
  readonly sample: number;
  readonly status: CargoStatus;
}

interface SampledDelivery {
  readonly sample: number;
  readonly event: DeliveryEvent;
  readonly sourceFacilityId: string | null;
}

interface DeliveryConservationProof {
  readonly tuple: string;
  readonly event: DeliveryEvent;
  readonly loadedUnits: number;
  readonly unloadedUnits: number;
}

type TransitPhase = 'outbound' | 'destination' | 'return' | 'source';

interface TransitState {
  phase: TransitPhase;
  remainingTicks: number;
  totalTicks: number;
}

interface RuntimeController {
  readonly transitByTrainId: Map<string, TransitState>;
}

const makeRuntimeController = (): RuntimeController => ({
  transitByTrainId: new Map(BENCHMARK_CYCLIC_ROUTES.map((route) => {
    const pacing = TRANSIT_PACING_BY_TRAIN_ID[route.trainId];
    return [
      route.trainId,
      {
        phase: 'outbound' as const,
        remainingTicks: pacing.initialOutboundTicks,
        totalTicks: pacing.initialOutboundTicks,
      },
    ];
  })),
});

const stoppedRuntime = (
  snapshot: TrainRuntimeSnapshot,
  target: WorldData['economy']['facilities'][number],
): TrainRuntimeSnapshot => ({
  ...snapshot,
  trackT: (target.railAccess.x + 1_200) / 2_400,
  x: target.railAccess.x,
  y: target.railAccess.y,
  speedWorldUnitsPerSecond: 0,
  throttle: 0,
  derailed: false,
});

const movingRuntime = (
  snapshot: TrainRuntimeSnapshot,
  from: WorldData['economy']['facilities'][number],
  to: WorldData['economy']['facilities'][number],
  transit: TransitState,
): TrainRuntimeSnapshot => {
  const progress = (transit.totalTicks - transit.remainingTicks + 1)
    / (transit.totalTicks + 1);
  const x = from.railAccess.x
    + (to.railAccess.x - from.railAccess.x) * progress;
  const y = from.railAccess.y
    + (to.railAccess.y - from.railAccess.y) * progress;
  transit.remainingTicks -= 1;
  return {
    ...snapshot,
    trackT: (x + 1_200) / 2_400,
    x,
    y,
    speedWorldUnitsPerSecond: 18,
    throttle: 1,
    derailed: false,
  };
};

const runtimeForAuthority = (
  fixture: ReturnType<typeof makeEconomyTickBenchmarkFixture>,
  world: WorldData,
  controller: RuntimeController,
): readonly TrainRuntimeSnapshot[] => fixture.runtime.map((snapshot) => {
  const route = BENCHMARK_CYCLIC_ROUTES.find(
    ({ trainId }) => trainId === snapshot.trainId,
  );
  if (!route) return snapshot;

  const train = world.trains.find(({ id }) => id === route.trainId);
  const source = world.economy.facilities.find(
    ({ definitionId }) => definitionId === route.sourceDefinitionId,
  );
  const destination = world.economy.facilities.find(
    ({ definitionId }) => definitionId === route.destinationDefinitionId,
  );
  const transit = controller.transitByTrainId.get(route.trainId);
  const pacing = TRANSIT_PACING_BY_TRAIN_ID[route.trainId];
  if (!train || !source || !destination || !transit || !pacing) {
    throw new Error(`Missing cyclic benchmark authority for ${route.trainId}`);
  }

  const capacity = BENCHMARK_PRODUCT_CAPACITY[route.productId];
  const cargo = train.cargo;
  const stillLoading = cargo !== null
    && cargo.productId === route.productId
    && cargo.units === cargo.loadedUnits
    && cargo.loadedUnits < capacity;

  if (transit.phase === 'outbound') {
    if (transit.remainingTicks > 0) {
      return movingRuntime(snapshot, source, destination, transit);
    }
    transit.phase = 'destination';
  }
  if (transit.phase === 'destination') {
    if (cargo !== null) return stoppedRuntime(snapshot, destination);
    transit.phase = 'return';
    transit.remainingTicks = pacing.returnTicks;
    transit.totalTicks = pacing.returnTicks;
    return movingRuntime(snapshot, destination, source, transit);
  }
  if (transit.phase === 'return') {
    if (transit.remainingTicks > 0) {
      return movingRuntime(snapshot, destination, source, transit);
    }
    transit.phase = 'source';
  }
  if (cargo === null || stillLoading) {
    return stoppedRuntime(snapshot, source);
  }
  transit.phase = 'outbound';
  transit.remainingTicks = pacing.outboundTicks;
  transit.totalTicks = pacing.outboundTicks;
  return movingRuntime(snapshot, source, destination, transit);
});

const expectCommittedTick = (result: EconomyUpdateResult): void => {
  expect(result).toMatchObject({
    ticksAdvanced: 1,
    commitRejected: false,
    authoritativeChanged: true,
  });
};

const run = (measure: boolean) => {
  const warmupFixture = makeEconomyTickBenchmarkFixture();
  const warmupPort = new BenchmarkWorldPort(warmupFixture.world);
  const warmupEconomy = new EconomySystem(warmupPort);
  const warmupController = makeRuntimeController();
  for (let index = 0; index < WARMUP_TICKS; index += 1) {
    expectCommittedTick(warmupEconomy.update(
      1_000,
      true,
      runtimeForAuthority(
        warmupFixture,
        warmupPort.world,
        warmupController,
      ),
    ));
  }
  expect(warmupPort.world.economy.tick).toBe(WARMUP_TICKS);

  const fixture = makeEconomyTickBenchmarkFixture();
  const port = new BenchmarkWorldPort(fixture.world);
  const economy = new EconomySystem(port);
  const controller = makeRuntimeController();
  const durations: number[] = [];
  const measuredStatuses: SampledStatus[] = [];
  const measuredDeliveries: SampledDelivery[] = [];
  const deliveryProofs: DeliveryConservationProof[] = [];
  const transferByTrainId = new Map<
    string,
    { loadedUnits: number; unloadedUnits: number }
  >(BENCHMARK_CYCLIC_ROUTES.map((route) => {
    const train = fixture.world.trains.find(({ id }) => id === route.trainId);
    return [
      route.trainId,
      {
        loadedUnits: train?.cargo?.loadedUnits ?? 0,
        unloadedUnits: 0,
      },
    ];
  }));

  for (let index = 0; index < MEASURED_TICKS; index += 1) {
    const sample = index + 1;
    const originByTrainId = new Map(port.world.trains.flatMap((train) =>
      train.cargo === null
        ? []
        : [[train.id, train.cargo.originFacilityId] as const]));
    const runtime = runtimeForAuthority(fixture, port.world, controller);
    const startedAt = performance.now();
    const result = economy.update(1_000, true, runtime);
    if (measure) durations.push(performance.now() - startedAt);
    expectCommittedTick(result);

    result.cargoStatuses.forEach((status) => {
      measuredStatuses.push({ sample, status });
      const transfer = transferByTrainId.get(status.trainId);
      if (!transfer || status.batchUnits <= 0) return;
      if (status.kind === 'loading') {
        transfer.loadedUnits += status.batchUnits;
      }
      if (status.kind === 'unloading') {
        transfer.unloadedUnits += status.batchUnits;
      }
    });
    result.completedDeliveries.forEach((event) => {
      const sourceFacilityId = originByTrainId.get(event.trainId) ?? null;
      measuredDeliveries.push({ sample, event, sourceFacilityId });
      const route = BENCHMARK_CYCLIC_ROUTES.find(
        ({ trainId }) => trainId === event.trainId,
      );
      const transfer = transferByTrainId.get(event.trainId);
      if (!route || !transfer || sourceFacilityId === null) {
        throw new Error(`Unmapped benchmark delivery ${event.trainId}`);
      }
      const source = port.world.economy.facilities.find(
        ({ id }) => id === sourceFacilityId,
      );
      const destination = port.world.economy.facilities.find(
        ({ id }) => id === event.destinationFacilityId,
      );
      if (!source || !destination) {
        throw new Error(`Unmapped benchmark delivery ${event.trainId}`);
      }
      if (event.productId !== route.productId
        || source.definitionId !== route.sourceDefinitionId
        || destination.definitionId !== route.destinationDefinitionId) {
        throw new Error(`Misrouted benchmark delivery ${event.trainId}`);
      }
      deliveryProofs.push({
        tuple: `${event.productId}:`
          + `${source.definitionId}->${destination.definitionId}`,
        event,
        loadedUnits: transfer.loadedUnits,
        unloadedUnits: transfer.unloadedUnits,
      });
      transfer.loadedUnits = 0;
      transfer.unloadedUnits = 0;
    });
  }

  for (
    let tick = MEASURED_TICKS;
    tick < FINAL_AUTHORITY_TICKS;
    tick += 1
  ) {
    expectCommittedTick(economy.update(
      1_000,
      true,
      runtimeForAuthority(fixture, port.world, controller),
    ));
  }

  const world = port.snapshot();
  return {
    fixture,
    durations,
    measuredStatuses,
    measuredDeliveries,
    deliveryProofs,
    world,
    hash: economyAuthorityHash(world),
  };
};

describe('Economy tick benchmark fixture', () => {
  it('represents a 16-train regional construction fleet', () => {
    const fixture = makeEconomyTickBenchmarkFixture();

    expectRegionalConstructionFixture(fixture);
  });
});

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
    const loadingSamples = new Set(first.measuredStatuses
      .filter(({ status }) => status.kind === 'loading'
        && status.batchUnits > 0)
      .map(({ sample }) => sample));
    const unloadingSamples = new Set(first.measuredStatuses
      .filter(({ status }) => status.kind === 'unloading'
        && status.batchUnits > 0)
      .map(({ sample }) => sample));
    const blockedSamples = new Set(first.measuredStatuses
      .filter(({ status }) => status.kind === 'blocked')
      .map(({ sample }) => sample));
    const contentionStatusesBySample = new Map<number, CargoStatus[]>();
    first.measuredStatuses
      .filter(({ status }) => status.trainId === 'contention-a'
        || status.trainId === 'contention-b')
      .forEach(({ sample, status }) => {
        const statuses = contentionStatusesBySample.get(sample) ?? [];
        statuses.push(status);
        contentionStatusesBySample.set(sample, statuses);
      });
    const genuineContentionSamples = new Set(
      [...contentionStatusesBySample.entries()]
        .filter(([, statuses]) => {
          const firstStatus = statuses.find(
            ({ trainId }) => trainId === 'contention-a',
          );
          const secondStatus = statuses.find(
            ({ trainId }) => trainId === 'contention-b',
          );
          const loads = (status: CargoStatus | undefined): boolean =>
            status?.kind === 'loading' && status.batchUnits > 0;
          const losesContention = (
            status: CargoStatus | undefined,
          ): boolean => status?.kind === 'blocked'
            && status.blocker === 'source-empty';
          return (loads(firstStatus) && losesContention(secondStatus))
            || (loads(secondStatus) && losesContention(firstStatus));
        })
        .map(([sample]) => sample),
    );
    const routeDeliveryCounts = Object.fromEntries(
      EXPECTED_ROUTE_TUPLES.map((tuple) => [
        tuple,
        first.deliveryProofs.filter((proof) => proof.tuple === tuple).length,
      ]),
    );
    const measuredCounts = {
      loadingSamples: loadingSamples.size,
      unloadingSamples: unloadingSamples.size,
      blockedSamples: blockedSamples.size,
      contentionEpisodes: genuineContentionSamples.size,
      completedDeliveries: first.measuredDeliveries.length,
    };

    expectRegionalConstructionFixture(first.fixture);
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
    expect(stateSetCounts).toEqual({
      loading: {
        'flatbed-freight-set': 2,
        'aggregate-hopper-set': 1,
        'covered-cement-set': 0,
      },
      transit: {
        'flatbed-freight-set': 1,
        'aggregate-hopper-set': 1,
        'covered-cement-set': 0,
      },
      unloading: {
        'flatbed-freight-set': 3,
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
      loading: 3,
      transit: 2,
      unloading: 5,
      idle: 2,
      'full-destination': 2,
      contention: 2,
    });
    expect(measuredCounts.loadingSamples)
      .toBeGreaterThanOrEqual(MIN_ACTIVE_TRANSFER_SAMPLE_COUNT);
    expect(measuredCounts.unloadingSamples)
      .toBeGreaterThanOrEqual(MIN_ACTIVE_TRANSFER_SAMPLE_COUNT);
    expect(measuredCounts.blockedSamples)
      .toBeGreaterThanOrEqual(MIN_ACTIVE_TRANSFER_SAMPLE_COUNT);
    expect(measuredCounts.contentionEpisodes).toBeGreaterThanOrEqual(1);
    expect(measuredCounts.completedDeliveries)
      .toBeGreaterThanOrEqual(EXPECTED_ROUTE_TUPLES.length * 2);
    const lastSampleByActivity = {
      loading: Math.max(...loadingSamples),
      unloading: Math.max(...unloadingSamples),
      blocked: Math.max(...blockedSamples),
    };
    expect(lastSampleByActivity.loading)
      .toBeGreaterThanOrEqual(TAIL_SAMPLE_START);
    expect(lastSampleByActivity.unloading)
      .toBeGreaterThanOrEqual(TAIL_SAMPLE_START);
    expect(lastSampleByActivity.blocked)
      .toBeGreaterThanOrEqual(TAIL_SAMPLE_START);
    expect(first.deliveryProofs).toHaveLength(
      first.measuredDeliveries.length,
    );
    expect([...new Set(first.deliveryProofs.map(({ tuple }) => tuple))]
      .sort()).toEqual(EXPECTED_ROUTE_TUPLES);
    Object.values(routeDeliveryCounts).forEach((count) => {
      expect(count).toBeGreaterThanOrEqual(2);
    });
    first.deliveryProofs.forEach((proof) => {
      expect(proof.loadedUnits).toBe(proof.event.units);
      expect(proof.unloadedUnits).toBe(proof.event.units);
      expect(proof.event.units).toBe(
        BENCHMARK_PRODUCT_CAPACITY[
          proof.event.productId as keyof typeof BENCHMARK_PRODUCT_CAPACITY
        ],
      );
    });
    expect(first.durations).toHaveLength(MEASURED_TICKS);
    expect(first.world.economy.tick).toBe(FINAL_AUTHORITY_TICKS);
    expect(first.world.operationsRevision).toBe(FINAL_AUTHORITY_TICKS);
    expect(validateWorldData(first.world).compatible).toBe(true);
    expect(first.hash).toBe(second.hash);
    // Schema 11 adds authoritative persisted dynamics to every benchmark train.
    // The full economic/conservation assertions above remain unchanged.
    expect(first.hash).toBe('494bd89a');
    expect(Number.isFinite(p95)).toBe(true);
    expect(p95).toBeGreaterThanOrEqual(0);
    if (!collectingCoverage) {
      expect(p95).toBeLessThan(P95_BUDGET_MS);
    }

    console.info(
      `[economy-tick-benchmark] trains=16 facilities=7 samples=500 `
      + `loading=${measuredCounts.loadingSamples} `
      + `unloading=${measuredCounts.unloadingSamples} `
      + `blocked=${measuredCounts.blockedSamples} `
      + `contention=${measuredCounts.contentionEpisodes} `
      + `deliveries=${measuredCounts.completedDeliveries} `
      + `p95=${p95.toFixed(3)}ms hash=${first.hash} `
      + `mode=${collectingCoverage ? 'coverage' : 'budget'}`,
    );
  });
});
