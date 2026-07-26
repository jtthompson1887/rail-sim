/**
 * @jest-environment jsdom
 */

import type { WorldData } from '../../src/config/WorldData';
import type { IndustryBlocker } from '../../src/economy/EconomyData';
import {
  EconomySystem,
  MAX_ECONOMY_TICKS_PER_FRAME,
} from '../../src/economy/EconomySystem';
import { advanceMarketTick } from '../../src/economy/MarketSystem';
import { WorldManager } from '../../src/managers/WorldManager';
import { clonePlainData } from '../../src/utils/PlainData';

const facilitySnapshot = (world: WorldData, facilityId: string) =>
  clonePlainData(
    world.economy.facilities.find((facility) => facility.id === facilityId),
  );

const updateInGroups = (groups: number[]) => {
  const system = new EconomySystem();
  const results = groups.map((deltaMs) => system.update(deltaMs, true));
  return {
    economy: clonePlainData(WorldManager.world!.economy),
    results,
  };
};

describe('EconomySystem', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    WorldManager.reset();
    localStorage.clear();
  });

  it('makes four 250 ms updates identical to one 1,000 ms update', () => {
    WorldManager.createNew('Split ticks', 'economy-tick-split');
    const split = updateInGroups([250, 250, 250, 250]);

    WorldManager.reset();
    WorldManager.createNew('Single tick', 'economy-tick-split');
    const single = updateInGroups([1_000]);

    expect(split.economy).toEqual(single.economy);
    expect(split.results.map((result) => result.ticksAdvanced))
      .toEqual([0, 0, 0, 1]);
    expect(single.results[0].ticksAdvanced).toBe(1);
  });

  it('does not accumulate or advance time outside operating play', () => {
    const world = WorldManager.createNew(
      'Stopped economy',
      'economy-tick-stopped',
    );
    const before = clonePlainData(world);
    const system = new EconomySystem();

    expect(system.update(8_000, false)).toEqual({
      ticksAdvanced: 0,
      changedFacilityIds: [],
      blockers: [],
      commitRejected: false,
    });
    expect(world).toEqual(before);

    expect(system.update(999, true).ticksAdvanced).toBe(0);
    expect(world.economy.tick).toBe(0);
  });

  it('catches up at most four ticks per call and retains remaining backlog', () => {
    const world = WorldManager.createNew(
      'Catch-up economy',
      'economy-tick-catchup',
    );
    const system = new EconomySystem();

    const result = system.update(10_250, true);

    expect(result.ticksAdvanced).toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(world.economy.tick).toBe(4);
    expect(world.operationsRevision).toBe(4);

    expect(system.update(0, true).ticksAdvanced)
      .toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(world.economy.tick).toBe(8);
    expect(system.update(0, true).ticksAdvanced).toBe(2);
    expect(world.economy.tick).toBe(10);
    expect(system.update(749, true).ticksAdvanced).toBe(0);
    expect(system.update(1, true).ticksAdvanced).toBe(1);
    expect(world.economy.tick).toBe(11);
  });

  it('eventually matches ten regular ticks while every catch-up call stays bounded', () => {
    WorldManager.createNew(
      'Backlogged economy',
      'economy-tick-eventual-equivalence',
    );
    const backloggedSystem = new EconomySystem();
    const backloggedTicks = [
      backloggedSystem.update(10_000, true).ticksAdvanced,
      backloggedSystem.update(0, true).ticksAdvanced,
      backloggedSystem.update(0, true).ticksAdvanced,
    ];
    const backloggedEconomy = clonePlainData(
      WorldManager.world!.economy,
    );

    expect(backloggedTicks).toEqual([4, 4, 2]);
    expect(backloggedTicks.every(
      (ticks) => ticks <= MAX_ECONOMY_TICKS_PER_FRAME,
    )).toBe(true);

    WorldManager.reset();
    WorldManager.createNew(
      'Regular economy',
      'economy-tick-eventual-equivalence',
    );
    const regularSystem = new EconomySystem();
    const regularTicks = Array.from({ length: 10 }, () => (
      regularSystem.update(1_000, true).ticksAdvanced
    ));

    expect(regularTicks).toEqual(Array(10).fill(1));
    expect(WorldManager.world!.economy).toEqual(backloggedEconomy);
  });

  it('ignores invalid deltas but allows zero to drain operating backlog', () => {
    const world = WorldManager.createNew(
      'Validated delta economy',
      'economy-tick-validated-delta',
    );
    const system = new EconomySystem();

    expect(system.update(5_000, true).ticksAdvanced).toBe(4);
    expect(system.update(-1, true).ticksAdvanced).toBe(0);
    expect(system.update(Number.NaN, true).ticksAdvanced).toBe(0);
    expect(system.update(Number.POSITIVE_INFINITY, true).ticksAdvanced)
      .toBe(0);
    expect(world.economy.tick).toBe(4);

    expect(system.update(0, false).ticksAdvanced).toBe(0);
    expect(system.update(0, true).ticksAdvanced).toBe(1);
    expect(world.economy.tick).toBe(5);
  });

  it('advances root and economy revisions once per committed tick only', () => {
    const world = WorldManager.createNew(
      'Revision economy',
      'economy-tick-revisions',
    );
    const constructionRevision = world.constructionRevision;
    const system = new EconomySystem();

    const result = system.update(3_000, true);

    expect(result.ticksAdvanced).toBe(3);
    expect(world.economy.tick).toBe(3);
    expect(world.revision).toBe(3);
    expect(world.operationsRevision).toBe(3);
    expect(world.constructionRevision).toBe(constructionRevision);
  });

  it('advances facilities in stable id order and returns final blockers', () => {
    const world = WorldManager.createNew(
      'Ordered economy',
      'economy-tick-order',
    );
    world.economy.facilities.reverse();
    const system = new EconomySystem();

    const result = system.update(1_000, true);
    const expectedIds = world.economy.facilities
      .map((facility) => facility.id)
      .sort();

    expect(result.blockers.map(({ facilityId }) => facilityId))
      .toEqual(expectedIds);
    expect(result.blockers).toEqual(expect.arrayContaining([
      { facilityId: 'managed-forest', blocker: 'working' },
      { facilityId: 'sawmill', blocker: 'waiting-input' },
      { facilityId: 'port-interchange', blocker: 'idle' },
    ] satisfies Array<{
      facilityId: string;
      blocker: IndustryBlocker;
    }>));
    expect(result.changedFacilityIds).toEqual([
      'managed-forest',
      'quarry',
    ]);
  });

  it('advances the market using the newly committed tick', () => {
    const world = WorldManager.createNew(
      'Market cadence',
      'economy-tick-market',
    );
    world.economy.tick = 23;
    const initialMarket = clonePlainData(world.economy.market);
    const expectedMarket = advanceMarketTick(
      initialMarket,
      world.generationConfig.seed,
      24,
    );

    const result = new EconomySystem().update(1_000, true);

    expect(result.ticksAdvanced).toBe(1);
    expect(world.economy.tick).toBe(24);
    expect(world.economy.market).toEqual(expectedMarket);
  });

  it('keeps all facility, market, tick, and revision state atomic when the cursor loses', () => {
    const world = WorldManager.createNew(
      'Rejected economy',
      'economy-tick-rejected',
    );
    const before = clonePlainData(world);
    const rejectingPort = {
      get world(): WorldData {
        return world;
      },
      applyEconomyBatch(
        _expectedEconomyRevision: number,
        mutate: (draft: WorldData['economy']) => boolean,
      ): boolean {
        const detachedDraft = clonePlainData(world.economy);
        expect(mutate(detachedDraft)).toBe(true);
        expect(detachedDraft).not.toEqual(world.economy);
        return false;
      },
    };

    const result = new EconomySystem(rejectingPort).update(1_000, true);

    expect(result).toEqual({
      ticksAdvanced: 0,
      changedFacilityIds: [],
      blockers: [],
      commitRejected: true,
    });
    expect(world).toEqual(before);
  });

  it('reports a saturated economy tick as a rejected atomic commit', () => {
    const world = WorldManager.createNew(
      'Saturated economy',
      'economy-tick-saturated',
    );
    world.economy.tick = Number.MAX_SAFE_INTEGER;
    const before = clonePlainData(world);

    const result = new EconomySystem().update(1_000, true);

    expect(result).toEqual({
      ticksAdvanced: 0,
      changedFacilityIds: [],
      blockers: [],
      commitRejected: true,
    });
    expect(world).toEqual(before);
  });

  it('retains a large frame backlog until four ticks actually commit', () => {
    const world = WorldManager.createNew(
      'Retried backlog',
      'economy-tick-retried-backlog',
    );
    let batchAttempt = 0;
    const intermittentlyRejectingPort = {
      get world(): WorldData {
        return world;
      },
      applyEconomyBatch(
        expectedEconomyRevision: number,
        mutate: (draft: WorldData['economy']) => boolean,
      ): boolean {
        batchAttempt += 1;
        if (batchAttempt === 1 || batchAttempt === 3) {
          const detachedDraft = clonePlainData(world.economy);
          expect(mutate(detachedDraft)).toBe(true);
          return false;
        }
        return WorldManager.applyEconomyBatch(
          expectedEconomyRevision,
          mutate,
        );
      },
    };
    const system = new EconomySystem(intermittentlyRejectingPort);

    expect(system.update(10_250, true).ticksAdvanced).toBe(0);
    expect(system.update(1, true)).toMatchObject({
      ticksAdvanced: 1,
      commitRejected: true,
    });

    expect(system.update(1, true).ticksAdvanced)
      .toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(world.economy.tick).toBe(5);
  });

  it('keeps accumulator arithmetic finite across extreme frame deltas', () => {
    const world = WorldManager.createNew(
      'Finite backlog',
      'economy-tick-finite-backlog',
    );
    let rejectNext = true;
    const rejectOncePort = {
      get world(): WorldData {
        return world;
      },
      applyEconomyBatch(
        expectedEconomyRevision: number,
        mutate: (draft: WorldData['economy']) => boolean,
      ): boolean {
        if (rejectNext) {
          rejectNext = false;
          const detachedDraft = clonePlainData(world.economy);
          expect(mutate(detachedDraft)).toBe(true);
          return false;
        }
        return WorldManager.applyEconomyBatch(
          expectedEconomyRevision,
          mutate,
        );
      },
    };
    const system = new EconomySystem(rejectOncePort);

    expect(system.update(Number.MAX_VALUE, true).ticksAdvanced).toBe(0);
    expect(system.update(Number.MAX_VALUE, true).ticksAdvanced)
      .toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(system.update(0, true).ticksAdvanced)
      .toBe(MAX_ECONOMY_TICKS_PER_FRAME);
    expect(world.economy.tick).toBe(8);
  });

  it('produces identical industry and market state for equivalent elapsed ticks', () => {
    WorldManager.createNew('Chunked economy', 'economy-tick-equivalent');
    const chunked = updateInGroups([1_500, 500, 2_000]).economy;

    WorldManager.reset();
    WorldManager.createNew('Batched economy', 'economy-tick-equivalent');
    const batched = updateInGroups([4_000]).economy;

    expect(chunked).toEqual(batched);
    expect(facilitySnapshot(
      { ...WorldManager.world!, economy: chunked },
      'managed-forest',
    )).toEqual(facilitySnapshot(WorldManager.world!, 'managed-forest'));
  });
});
