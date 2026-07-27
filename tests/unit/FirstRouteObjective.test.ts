import type {
  TrackDef,
  TrainDef,
  TrainOperationsDef,
  WorldData,
} from '../../src/config/WorldData';
import type { TrackTopologySnapshot } from '../../src/managers/TrackManager';
import {
  deriveFirstRouteObjective,
  FirstRouteCelebrationSession,
  firstRouteCelebrationSession,
  type FirstRouteObjectiveDto,
  type FirstRouteObjectiveStep,
} from '../../src/freight/FirstRouteObjective';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

const connectedTopology: TrackTopologySnapshot = [{
  kind: 'track',
  uuid: 'forest-sawmill-track',
  previous: null,
  next: null,
}];

const expectedSteps = (
  states: Array<'complete' | 'current' | 'pending'>,
): FirstRouteObjectiveStep[] => [
  { id: 'connect-route', label: 'Connect the route', state: states[0] },
  { id: 'buy-train', label: 'Buy the train', state: states[1] },
  { id: 'load-logs', label: 'Load logs', state: states[2] },
  { id: 'deliver-logs', label: 'Deliver logs', state: states[3] },
  { id: 'run-profitably', label: 'Run profitably', state: states[4] },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function trackStub(
  source: TrackDef,
  uuid: string,
  startX: number,
  endX: number,
): TrackDef {
  return {
    ...clone(source),
    uuid,
    p0: { x: startX, y: 0 },
    p1: { x: startX + (endX - startX) / 3, y: 0 },
    p2: { x: startX + 2 * (endX - startX) / 3, y: 0 },
    p3: { x: endX, y: 0 },
  };
}

function trainWith(
  cargo: TrainDef['cargo'],
  operations: Partial<TrainOperationsDef> = {},
): TrainDef {
  const base = makeFreightTrainDef();
  return {
    ...base,
    cargo,
    operations: {
      ...base.operations,
      ...operations,
    },
  };
}

function connectedWorldWithoutTrain(): WorldData {
  const world = makeFirstFreightRouteWorld();
  world.trains = [];
  return world;
}

describe('deriveFirstRouteObjective', () => {
  it('leaves Connect the route current for disconnected endpoint stubs', () => {
    const world = connectedWorldWithoutTrain();
    const source = world.tracks[0];
    world.tracks = [
      trackStub(source, 'forest-stub', -500, -400),
      trackStub(source, 'sawmill-stub', 400, 500),
    ];
    const topology: TrackTopologySnapshot = [
      {
        kind: 'track',
        uuid: 'forest-stub',
        previous: null,
        next: null,
      },
      {
        kind: 'track',
        uuid: 'sawmill-stub',
        previous: null,
        next: null,
      },
    ];

    expect(deriveFirstRouteObjective(world, topology)).toEqual({
      objectiveVersion: 1,
      achieved: false,
      steps: expectedSteps([
        'current',
        'pending',
        'pending',
        'pending',
        'pending',
      ]),
    });
  });

  it('completes Connect the route from the connected graph', () => {
    const world = connectedWorldWithoutTrain();

    expect(deriveFirstRouteObjective(world, connectedTopology)).toEqual({
      objectiveVersion: 1,
      achieved: false,
      steps: expectedSteps([
        'complete',
        'current',
        'pending',
        'pending',
        'pending',
      ]),
    });
  });

  it('completes Buy the train from any persisted Timber Freight Set', () => {
    const world = connectedWorldWithoutTrain();
    world.trains.push(makeFreightTrainDef({
      id: 'persisted-timber-set',
      trackUUID: 'deleted-track',
    }));

    expect(deriveFirstRouteObjective(world, connectedTopology).steps).toEqual(
      expectedSteps([
        'complete',
        'complete',
        'current',
        'pending',
        'pending',
      ]),
    );
  });

  it('completes Load logs when a timber train is currently at 60/60', () => {
    const world = connectedWorldWithoutTrain();
    world.trains.push(trainWith({
      productId: 'logs',
      units: 60,
      originFacilityId: 'managed-forest',
    }));

    expect(deriveFirstRouteObjective(world, connectedTopology).steps).toEqual(
      expectedSteps([
        'complete',
        'complete',
        'complete',
        'current',
        'pending',
      ]),
    );
  });

  it.each([
    ['the first partial unload', 40, 20],
    ['a later empty phase', null, 60],
    ['a later reloaded phase', 60, 60],
  ])(
    'keeps Load logs complete after %s records delivered timber',
    (_phase, remainingUnits, lifetimeDeliveredUnits) => {
      const world = connectedWorldWithoutTrain();
      world.trains.push(trainWith(
        remainingUnits === null
          ? null
          : {
            productId: 'logs',
            units: remainingUnits,
            originFacilityId: 'managed-forest',
          },
        { lifetimeDeliveredUnits },
      ));

      expect(
        deriveFirstRouteObjective(world, connectedTopology).steps,
      ).toEqual(expectedSteps([
        'complete',
        'complete',
        'complete',
        'current',
        'pending',
      ]));
    },
  );

  it('completes Deliver logs only when one timber train records both delivery and revenue', () => {
    const missingOneFact: Array<{
      operations: Partial<TrainOperationsDef>;
      states: Array<'complete' | 'current' | 'pending'>;
    }> = [
      {
        operations: { lastTripRevenue: 100, lifetimeDeliveredUnits: 0 },
        states: [
          'complete',
          'complete',
          'current',
          'pending',
          'pending',
        ],
      },
      {
        operations: { lastTripRevenue: 0, lifetimeDeliveredUnits: 20 },
        states: [
          'complete',
          'complete',
          'complete',
          'current',
          'pending',
        ],
      },
    ];

    for (const { operations, states } of missingOneFact) {
      const world = connectedWorldWithoutTrain();
      world.trains.push(trainWith(null, operations));
      expect(
        deriveFirstRouteObjective(world, connectedTopology).steps,
      ).toEqual(expectedSteps(states));
    }

    const delivered = connectedWorldWithoutTrain();
    delivered.trains.push(trainWith(null, {
      lastTripRevenue: 100,
      lifetimeDeliveredUnits: 20,
    }));
    expect(
      deriveFirstRouteObjective(delivered, connectedTopology).steps,
    ).toEqual(expectedSteps([
      'complete',
      'complete',
      'complete',
      'complete',
      'current',
    ]));
  });

  it('uses only the root progress latch for Run profitably and achieved', () => {
    const world = connectedWorldWithoutTrain();
    world.trains.push(trainWith(null, {
      lastTripRevenue: 100,
      lifetimeDeliveredUnits: 60,
      lifetimeRevenue: 100,
      lifetimeRunningCost: 10,
    }));

    const beforeLatch = deriveFirstRouteObjective(world, connectedTopology);
    expect(beforeLatch.achieved).toBe(false);
    expect(beforeLatch.steps).toEqual(expectedSteps([
      'complete',
      'complete',
      'complete',
      'complete',
      'current',
    ]));

    world.freightProgress.profitableLogDeliveryCompleted = true;
    const afterLatch = deriveFirstRouteObjective(world, connectedTopology);
    expect(afterLatch).toEqual({
      objectiveVersion: 1,
      achieved: true,
      steps: expectedSteps([
        'complete',
        'complete',
        'complete',
        'complete',
        'complete',
      ]),
    });
  });

  it('keeps every step achieved after later track and train deletion', () => {
    const world = connectedWorldWithoutTrain();
    world.freightProgress.profitableLogDeliveryCompleted = true;
    world.tracks = [];
    world.trains = [];

    expect(deriveFirstRouteObjective(world, [])).toEqual({
      objectiveVersion: 1,
      achieved: true,
      steps: expectedSteps([
        'complete',
        'complete',
        'complete',
        'complete',
        'complete',
      ]),
    });
  });

  it('returns deeply frozen objective data without mutating the world', () => {
    const world = makeFirstFreightRouteWorld();
    const before = clone(world);

    const dto = deriveFirstRouteObjective(world, connectedTopology);

    expect(world).toEqual(before);
    expect(Object.isFrozen(dto)).toBe(true);
    expect(Object.isFrozen(dto.steps)).toBe(true);
    dto.steps.forEach((step) => expect(Object.isFrozen(step)).toBe(true));
  });
});

describe('FirstRouteCelebrationSession', () => {
  const achieved: FirstRouteObjectiveDto = {
    objectiveVersion: 1,
    achieved: true,
    steps: expectedSteps([
      'complete',
      'complete',
      'complete',
      'complete',
      'complete',
    ]),
  };
  const incomplete = {
    ...achieved,
    achieved: false,
  };

  it('celebrates an achieved non-empty world ID once per fresh session', () => {
    const session = new FirstRouteCelebrationSession();

    expect(session.consume('', achieved)).toBe(false);
    expect(session.consume('   ', achieved)).toBe(false);
    expect(session.consume('world-a', incomplete)).toBe(false);
    expect(session.consume('world-a', achieved)).toBe(true);
    expect(session.consume('world-a', achieved)).toBe(false);
    expect(session.consume('world-b', achieved)).toBe(true);
    expect(session.consume('world-b', achieved)).toBe(false);
  });

  it('does not mutate objective data and exports a module-lifetime singleton', () => {
    const session = new FirstRouteCelebrationSession();
    const before = clone(achieved);

    session.consume('immutable-world', achieved);

    expect(achieved).toEqual(before);
    expect(firstRouteCelebrationSession)
      .toBeInstanceOf(FirstRouteCelebrationSession);
    expect(firstRouteCelebrationSession.consume(
      'singleton-world-task-11',
      achieved,
    )).toBe(true);
    expect(firstRouteCelebrationSession.consume(
      'singleton-world-task-11',
      achieved,
    )).toBe(false);
  });
});
