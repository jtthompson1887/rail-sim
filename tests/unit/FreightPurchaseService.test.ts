import {
  FreightPurchaseService,
  type FreightPurchaseQuoteInput,
  type FreightPurchaseResult,
  type FreightPurchaseRuntimePort,
} from '../../src/freight/FreightPurchaseService';
import type Train from '../../src/entities/Train';
import type { TrackDef, WorldData } from '../../src/config/WorldData';
import type { TrackTopologySnapshot } from '../../src/managers/TrackManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { createCompanyState } from '../../src/economy/FinanceLedger';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

const node = (
  uuid: string,
  previous: TrackTopologySnapshot[number]['previous'] = null,
  next: TrackTopologySnapshot[number]['next'] = null,
): TrackTopologySnapshot[number] => ({
  kind: 'track',
  uuid,
  previous,
  next,
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function addTrack(
  world: WorldData,
  uuid: string,
  points: Pick<TrackDef, 'p0' | 'p1' | 'p2' | 'p3'>,
): TrackDef {
  const track: TrackDef = {
    geometryVersion: 1,
    uuid,
    ...points,
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
    paidBuildCost: 10_000,
  };
  world.tracks.push(track);
  return track;
}

function makeRuntime(overrides: Partial<FreightPurchaseRuntimePort> = {}): {
  port: FreightPurchaseRuntimePort;
  live: Map<string, Train>;
} {
  const live = new Map<string, Train>();
  const port: FreightPurchaseRuntimePort = {
    spawn: jest.fn((trainId: string) => {
      const train = { getUUID: () => trainId } as Train;
      live.set(trainId, train);
      return train;
    }),
    place: jest.fn().mockReturnValue(true),
    remove: jest.fn((trainId: string) => {
      live.delete(trainId);
    }),
    ...overrides,
  };
  return { port, live };
}

function setupWorld(cash = 1_000_000): WorldData {
  const world = WorldManager.createNew(
    'Freight purchase',
    `freight-purchase-${cash}`,
  );
  const fixture = makeFirstFreightRouteWorld();
  world.tracks = clone(fixture.tracks);
  world.economy = clone(fixture.economy);
  world.company = createCompanyState(cash);
  world.trains = [];
  return world;
}

function connectedInput(
  overrides: Partial<FreightPurchaseQuoteInput> = {},
): FreightPurchaseQuoteInput {
  return {
    freightSetId: 'timber-freight-set',
    trackUUID: 'forest-sawmill-track',
    trackT: 0,
    x: -500,
    y: 0,
    topology: [node('forest-sawmill-track')],
    ...overrides,
  };
}

function authoritativeSnapshot(world: WorldData): string {
  return JSON.stringify({
    cash: world.company.cash,
    ledger: world.company.ledger,
    trains: world.trains,
    revision: world.revision,
    constructionRevision: world.constructionRevision,
    operationsRevision: world.operationsRevision,
  });
}

describe('FreightPurchaseService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    WorldManager.reset();
    localStorage.clear();
  });

  it('atomically places one train, posts one £90k capex, and advances only root and operations revisions', () => {
    const world = setupWorld();
    const before = {
      cash: world.company.cash,
      ledgerLength: world.company.ledger.length,
      revision: world.revision,
      constructionRevision: world.constructionRevision,
      operationsRevision: world.operationsRevision,
    };
    const runtime = makeRuntime();
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      () => 'purchased-train',
    );

    const quote = service.quote(connectedInput());
    const result = service.purchase(quote);

    expect(quote).toEqual({
      expectedRevision: before.revision,
      freightSetId: 'timber-freight-set',
      trackUUID: 'forest-sawmill-track',
      trackT: 0,
      facing: 1,
      purchasePrice: 90_000,
      cashAfter: before.cash - 90_000,
      affordable: true,
      valid: true,
      blocker: null,
    });
    expect(Object.isFrozen(quote)).toBe(true);
    expect(result).toEqual({
      ok: true,
      trainId: 'purchased-train',
      saved: true,
      saveState: 'saved',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(runtime.live.size).toBe(1);
    expect(world.trains).toEqual([{
      id: 'purchased-train',
      freightSetId: 'timber-freight-set',
      trackUUID: 'forest-sawmill-track',
      trackT: 0,
      facing: 1,
      cargo: null,
      operations: {
        currentTripRevenue: 0,
        currentTripRunningCost: 0,
        lastTripRevenue: 0,
        lastTripRunningCost: 0,
        lifetimeDeliveredUnits: 0,
        lifetimeRevenue: 0,
        lifetimeRunningCost: 0,
      },
    }]);
    expect(world.company.cash).toBe(before.cash - 90_000);
    expect(world.company.ledger).toHaveLength(before.ledgerLength + 1);
    expect(world.company.ledger.at(-1)).toEqual({
      id: before.ledgerLength + 1,
      tick: world.economy.tick,
      category: 'vehicle-capex',
      ledgerClass: 'capital-expenditure',
      amount: -90_000,
      referenceId: 'purchased-train',
    });
    expect(world.revision).toBe(before.revision + 1);
    expect(world.operationsRevision).toBe(before.operationsRevision + 1);
    expect(world.constructionRevision).toBe(before.constructionRevision);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('permits multiple train instances from the same catalog SKU', () => {
    const world = setupWorld();
    const runtime = makeRuntime();
    const ids = ['timber-a', 'timber-b'];
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      () => ids.shift()!,
    );
    jest.spyOn(WorldManager, 'save').mockReturnValue(true);

    expect(service.purchase(service.quote(connectedInput())).ok).toBe(true);
    expect(service.purchase(service.quote(connectedInput())).ok).toBe(true);

    expect(world.trains.map(({ id, freightSetId }) => ({
      id,
      freightSetId,
    }))).toEqual([
      { id: 'timber-a', freightSetId: 'timber-freight-set' },
      { id: 'timber-b', freightSetId: 'timber-freight-set' },
    ]);
    expect(world.company.ledger.filter(
      ({ category }) => category === 'vehicle-capex',
    )).toHaveLength(2);
  });

  it.each([
    {
      name: 'no selected player track',
      expected: 'no-track' as const,
      prepare: (_world: WorldData) => connectedInput({
        trackUUID: 'not-player-track',
      }),
    },
    {
      name: 'placement centre outside Managed Forest access',
      expected: 'outside-forest-access' as const,
      prepare: (_world: WorldData) => connectedInput({
        trackT: 0.5,
        x: 0,
      }),
    },
    {
      name: 'selected forest track disconnected from Sawmill',
      expected: 'disconnected-route' as const,
      prepare: (world: WorldData) => {
        addTrack(world, 'forest-stub', {
          p0: { x: -500, y: 0 },
          p1: { x: -520, y: 20 },
          p2: { x: -540, y: 20 },
          p3: { x: -560, y: 0 },
        });
        return connectedInput({
          trackUUID: 'forest-stub',
          topology: [
            node('forest-sawmill-track'),
            node('forest-stub'),
          ],
        });
      },
    },
  ])('rejects $name with the exact blocker and no side effects', ({
    expected,
    prepare,
  }) => {
    const world = setupWorld();
    const input = prepare(world);
    const before = authoritativeSnapshot(world);
    const runtime = makeRuntime();
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      () => 'unused-train',
    );

    const quote = service.quote(input);
    const result = service.purchase(quote);

    expect(quote.valid).toBe(false);
    expect(quote.blocker).toBe(expected);
    expect(result).toEqual({ ok: false, blocker: expected });
    expect(authoritativeSnapshot(world)).toBe(before);
    expect(runtime.live.size).toBe(0);
    expect(runtime.port.spawn).not.toHaveBeenCalled();
  });

  it('rejects insufficient cash before generating or spawning a train', () => {
    const world = setupWorld(89_999);
    const before = authoritativeSnapshot(world);
    const runtime = makeRuntime();
    const idFactory = jest.fn().mockReturnValue('unused-train');
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      idFactory,
    );

    const quote = service.quote(connectedInput());
    const result = service.purchase(quote);

    expect(quote).toEqual(expect.objectContaining({
      affordable: false,
      cashAfter: -1,
      valid: false,
      blocker: 'insufficient-cash',
    }));
    expect(result).toEqual({ ok: false, blocker: 'insufficient-cash' });
    expect(authoritativeSnapshot(world)).toBe(before);
    expect(idFactory).not.toHaveBeenCalled();
    expect(runtime.live.size).toBe(0);
  });

  it('rejects a stale root revision before generating or spawning a train', () => {
    const world = setupWorld();
    const runtime = makeRuntime();
    const idFactory = jest.fn().mockReturnValue('unused-train');
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      idFactory,
    );
    const quote = service.quote(connectedInput());
    world.revision += 1;
    const before = authoritativeSnapshot(world);

    const result = service.purchase(quote);

    expect(result).toEqual({ ok: false, blocker: 'stale-revision' });
    expect(authoritativeSnapshot(world)).toBe(before);
    expect(idFactory).not.toHaveBeenCalled();
    expect(runtime.live.size).toBe(0);
  });

  it('rejects a generated duplicate train ID before live spawn', () => {
    const world = setupWorld();
    world.trains.push(makeFreightTrainDef({ id: 'duplicate-train' }));
    const before = authoritativeSnapshot(world);
    const runtime = makeRuntime();
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      () => 'duplicate-train',
    );

    const result = service.purchase(service.quote(connectedInput()));

    expect(result).toEqual({ ok: false, blocker: 'duplicate-train-id' });
    expect(authoritativeSnapshot(world)).toBe(before);
    expect(runtime.live.size).toBe(0);
    expect(runtime.port.spawn).not.toHaveBeenCalled();
  });

  it('rejects a forged current-revision valid-looking quote before spawn or mutation', () => {
    const world = setupWorld();
    addTrack(world, 'outside-track', {
      p0: { x: -100, y: 100 },
      p1: { x: -33, y: 100 },
      p2: { x: 33, y: 100 },
      p3: { x: 100, y: 100 },
    });
    const before = authoritativeSnapshot(world);
    const runtime = makeRuntime();
    const idFactory = jest.fn().mockReturnValue('forged-train');
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      idFactory,
    );
    const issued = service.quote(connectedInput());
    const forged = Object.freeze({
      ...issued,
      trackUUID: 'outside-track',
      trackT: 0.5,
      facing: -1 as const,
      valid: true,
      blocker: null,
    });

    const result = service.purchase(forged);

    expect(result).toEqual({ ok: false, blocker: 'stale-revision' });
    expect(authoritativeSnapshot(world)).toBe(before);
    expect(runtime.live.size).toBe(0);
    expect(idFactory).not.toHaveBeenCalled();
    expect(runtime.port.spawn).not.toHaveBeenCalled();
  });

  it('consumes an issued quote on its first attempt and rejects replay at the same root', () => {
    const world = setupWorld();
    const before = authoritativeSnapshot(world);
    const runtime = makeRuntime({
      spawn: jest.fn().mockReturnValue(null),
    });
    const idFactory = jest.fn().mockReturnValue('single-use-train');
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      idFactory,
    );
    const quote = service.quote(connectedInput());

    const first = service.purchase(quote);
    const replay = service.purchase(quote);

    expect(first).toEqual({ ok: false, blocker: 'live-spawn-failed' });
    expect(replay).toEqual({ ok: false, blocker: 'stale-revision' });
    expect(authoritativeSnapshot(world)).toBe(before);
    expect(runtime.live.size).toBe(0);
    expect(idFactory).toHaveBeenCalledTimes(1);
    expect(runtime.port.spawn).toHaveBeenCalledTimes(1);
  });

  it('rejects a simultaneous reentrant purchase as duplicate-gesture', () => {
    const world = setupWorld();
    const before = authoritativeSnapshot(world);
    let service!: FreightPurchaseService;
    let quote!: ReturnType<FreightPurchaseService['quote']>;
    let duplicateResult: FreightPurchaseResult | undefined;
    const runtime = makeRuntime({
      spawn: jest.fn(() => {
        duplicateResult = service.purchase(quote);
        return null;
      }),
    });
    service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      () => 'outer-train',
    );
    quote = service.quote(connectedInput());

    const outerResult = service.purchase(quote);

    expect(duplicateResult).toEqual({
      ok: false,
      blocker: 'duplicate-gesture',
    });
    expect(outerResult).toEqual({
      ok: false,
      blocker: 'live-spawn-failed',
    });
    expect(authoritativeSnapshot(world)).toBe(before);
    expect(runtime.live.size).toBe(0);
  });

  it('maps a null live spawn to live-spawn-failed without spending cash', () => {
    const world = setupWorld();
    const before = authoritativeSnapshot(world);
    const runtime = makeRuntime({
      spawn: jest.fn().mockReturnValue(null),
    });
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      () => 'spawn-failure',
    );

    const result = service.purchase(service.quote(connectedInput()));

    expect(result).toEqual({ ok: false, blocker: 'live-spawn-failed' });
    expect(authoritativeSnapshot(world)).toBe(before);
    expect(runtime.live.size).toBe(0);
  });

  it('removes a provisional train when live placement fails', () => {
    const world = setupWorld();
    const before = authoritativeSnapshot(world);
    const runtime = makeRuntime({
      place: jest.fn().mockReturnValue(false),
    });
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      () => 'placement-failure',
    );

    const result = service.purchase(service.quote(connectedInput()));

    expect(result).toEqual({
      ok: false,
      blocker: 'live-placement-failed',
    });
    expect(runtime.port.remove).toHaveBeenCalledWith('placement-failure');
    expect(runtime.live.size).toBe(0);
    expect(authoritativeSnapshot(world)).toBe(before);
  });

  it('removes a provisional train when the atomic operations install rejects', () => {
    const world = setupWorld();
    const before = authoritativeSnapshot(world);
    const runtime = makeRuntime();
    const worldPort = {
      get world() {
        return WorldManager.world;
      },
      applyOperationsBatch: jest.fn().mockReturnValue(false),
      save: jest.fn().mockReturnValue(true),
    };
    const service = new FreightPurchaseService(
      worldPort,
      runtime.port,
      () => 'install-failure',
    );

    const result = service.purchase(service.quote(connectedInput()));

    expect(result).toEqual({
      ok: false,
      blocker: 'world-install-failed',
    });
    expect(runtime.port.remove).toHaveBeenCalledWith('install-failure');
    expect(runtime.live.size).toBe(0);
    expect(authoritativeSnapshot(world)).toBe(before);
    expect(worldPort.save).not.toHaveBeenCalled();
  });

  it('classifies a revision changed during rejected install as stale and rolls back live state', () => {
    const world = setupWorld();
    const runtime = makeRuntime();
    const worldPort = {
      get world() {
        return WorldManager.world;
      },
      applyOperationsBatch: jest.fn().mockImplementation(() => {
        world.revision += 1;
        return false;
      }),
      save: jest.fn().mockReturnValue(true),
    };
    const service = new FreightPurchaseService(
      worldPort,
      runtime.port,
      () => 'install-stale',
    );

    const result = service.purchase(service.quote(connectedInput()));

    expect(result).toEqual({ ok: false, blocker: 'stale-revision' });
    expect(runtime.port.remove).toHaveBeenCalledWith('install-stale');
    expect(runtime.live.size).toBe(0);
    expect(world.company.ledger.filter(
      ({ category }) => category === 'vehicle-capex',
    )).toHaveLength(0);
    expect(world.trains).toHaveLength(0);
    expect(world.operationsRevision).toBe(0);
  });

  it('keeps the authoritative/live purchase and ledger when the one post-commit save fails', () => {
    const world = setupWorld();
    const runtime = makeRuntime();
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(false);
    const service = new FreightPurchaseService(
      WorldManager,
      runtime.port,
      () => 'unsaved-train',
    );

    const result = service.purchase(service.quote(connectedInput()));

    expect(result).toEqual({
      ok: true,
      trainId: 'unsaved-train',
      saved: false,
      saveState: 'unsaved',
    });
    expect(runtime.live.has('unsaved-train')).toBe(true);
    expect(world.trains.map(({ id }) => id)).toEqual(['unsaved-train']);
    expect(world.company.ledger.filter(
      ({ category, amount, referenceId }) => (
        category === 'vehicle-capex'
        && amount === -90_000
        && referenceId === 'unsaved-train'
      ),
    )).toHaveLength(1);
    expect(runtime.port.remove).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);

    expect(WorldManager.save()).toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
    expect(world.trains.map(({ id }) => id)).toEqual(['unsaved-train']);
    expect(world.company.ledger.filter(
      ({ category }) => category === 'vehicle-capex',
    )).toHaveLength(1);
  });

  it('rejects an orphan forest-ring stub even when a different forest-to-sawmill route exists', () => {
    const world = setupWorld();
    addTrack(world, 'orphan', {
      p0: { x: -500, y: 0 },
      p1: { x: -520, y: 10 },
      p2: { x: -540, y: 10 },
      p3: { x: -560, y: 0 },
    });
    const runtime = makeRuntime();
    const service = new FreightPurchaseService(WorldManager, runtime.port);

    const quote = service.quote(connectedInput({
      trackUUID: 'orphan',
      topology: [
        node('forest-sawmill-track'),
        node('orphan'),
      ],
    }));

    expect(quote.blocker).toBe('disconnected-route');
    expect(service.purchase(quote)).toEqual({
      ok: false,
      blocker: 'disconnected-route',
    });
  });

  it('rejects a connected track whose midpoint enters the ring when neither endpoint does', () => {
    const world = setupWorld();
    addTrack(world, 'midpoint-only', {
      p0: { x: -550, y: 0 },
      p1: { x: -516.6666666667, y: 0 },
      p2: { x: -483.3333333333, y: 0 },
      p3: { x: -450, y: 0 },
    });
    const runtime = makeRuntime();
    const service = new FreightPurchaseService(WorldManager, runtime.port);

    const quote = service.quote(connectedInput({
      trackUUID: 'midpoint-only',
      trackT: 0.5,
      topology: [
        node('forest-sawmill-track', null, {
          kind: 'track',
          uuid: 'midpoint-only',
        }),
        node('midpoint-only', {
          kind: 'track',
          uuid: 'forest-sawmill-track',
        }),
      ],
    }));

    expect(quote.blocker).toBe('disconnected-route');
    expect(service.purchase(quote)).toEqual({
      ok: false,
      blocker: 'disconnected-route',
    });
  });

  it('derives -1 facing when p3 is the unique Forest endpoint', () => {
    const world = setupWorld();
    world.tracks[0] = {
      ...world.tracks[0],
      p0: { x: 500, y: 0 },
      p1: { x: 167, y: 0 },
      p2: { x: -167, y: 0 },
      p3: { x: -500, y: 0 },
    };
    const service = new FreightPurchaseService(
      WorldManager,
      makeRuntime().port,
    );

    const quote = service.quote(connectedInput({
      trackT: 1,
      x: -500,
    }));

    expect(quote.facing).toBe(-1);
    expect(quote.valid).toBe(true);
  });

  it('uses the endpoint tangent toward Sawmill when both endpoints are inside Forest access', () => {
    const world = setupWorld();
    world.tracks[0] = {
      ...world.tracks[0],
      p0: { x: -510, y: 0 },
      p1: { x: -500, y: 0 },
      p2: { x: -490, y: 0 },
      p3: { x: -480, y: 0 },
    };
    addTrack(world, 'sawmill-link', {
      p0: { x: -480, y: 0 },
      p1: { x: -153, y: 0 },
      p2: { x: 173, y: 0 },
      p3: { x: 500, y: 0 },
    });
    const service = new FreightPurchaseService(
      WorldManager,
      makeRuntime().port,
    );

    const quote = service.quote(connectedInput({
      x: -495,
      trackT: 0.5,
      topology: [
        node('forest-sawmill-track', null, {
          kind: 'track',
          uuid: 'sawmill-link',
        }),
        node('sawmill-link', {
          kind: 'track',
          uuid: 'forest-sawmill-track',
        }),
      ],
    }));

    expect(quote.facing).toBe(1);
    expect(quote.valid).toBe(true);
  });

  it('uses facing 1 as the exact tie-break when both endpoint tangent dots match', () => {
    const world = setupWorld();
    world.tracks[0] = {
      ...world.tracks[0],
      p0: { x: -500, y: -10 },
      p1: { x: -500, y: 0 },
      p2: { x: -500, y: 0 },
      p3: { x: -500, y: 10 },
    };
    addTrack(world, 'sawmill-link', {
      p0: { x: -500, y: 10 },
      p1: { x: -167, y: 7 },
      p2: { x: 167, y: 3 },
      p3: { x: 500, y: 0 },
    });
    const service = new FreightPurchaseService(
      WorldManager,
      makeRuntime().port,
    );

    const quote = service.quote(connectedInput({
      x: -500,
      trackT: 0.5,
      topology: [
        node('forest-sawmill-track', null, {
          kind: 'track',
          uuid: 'sawmill-link',
        }),
        node('sawmill-link', {
          kind: 'track',
          uuid: 'forest-sawmill-track',
        }),
      ],
    }));

    expect(quote.facing).toBe(1);
    expect(quote.valid).toBe(true);
  });

  it('returns a frozen detached quote that cannot be altered through later input or world mutation', () => {
    const world = setupWorld();
    const input = connectedInput();
    const service = new FreightPurchaseService(
      WorldManager,
      makeRuntime().port,
    );

    const quote = service.quote(input);
    (input as { trackUUID: string }).trackUUID = 'mutated-input';
    (input.topology[0] as { uuid: string }).uuid = 'mutated-topology';
    world.tracks[0].uuid = 'mutated-world';

    expect(Object.isFrozen(quote)).toBe(true);
    expect(quote.trackUUID).toBe('forest-sawmill-track');
    expect(quote.expectedRevision).toBe(0);
  });
});
