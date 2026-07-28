import type {
  TrackDef,
  TrainDef,
  TrainOperationsDef,
  WorldData,
} from '../../src/config/WorldData';
import type { FacilityEconomyDef } from '../../src/economy/EconomyData';
import { getFacilityDefinition } from '../../src/economy/ProductCatalog';
import type { TrackTopologySnapshot } from '../../src/managers/TrackManager';
import {
  deriveFreightObjective,
  FreightObjectiveCelebrationSession,
  freightObjectiveCelebrationSession,
  type FreightObjectiveStep,
} from '../../src/freight/FreightObjective';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

const firstRouteTopology: TrackTopologySnapshot = [{
  kind: 'track',
  uuid: 'forest-sawmill-track',
  previous: null,
  next: null,
}];

const firstRouteSteps = (
  states: Array<'complete' | 'current' | 'pending'>,
): FreightObjectiveStep[] => [
  { id: 'connect-route', label: 'Connect the route', state: states[0] },
  { id: 'buy-train', label: 'Buy the train', state: states[1] },
  { id: 'load-logs', label: 'Load logs', state: states[2] },
  { id: 'deliver-logs', label: 'Deliver logs', state: states[3] },
  { id: 'run-profitably', label: 'Run profitably', state: states[4] },
];

const structuralSteps = (
  states: Array<'complete' | 'current' | 'pending'>,
): FreightObjectiveStep[] => [
  {
    id: 'produce-structural-timber',
    label: 'Produce structural timber',
    state: states[0],
  },
  {
    id: 'connect-prefabrication-plant',
    label: 'Connect the Prefabrication Plant',
    state: states[1],
  },
  {
    id: 'load-structural-timber',
    label: 'Load structural timber',
    state: states[2],
  },
  {
    id: 'deliver-structural-timber-profitably',
    label: 'Deliver profitably',
    state: states[3],
  },
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

function facility(
  definitionId: string,
  x: number,
): FacilityEconomyDef {
  const definition = getFacilityDefinition(definitionId);
  if (!definition) throw new Error(`Missing facility ${definitionId}`);
  return {
    id: definitionId,
    definitionId,
    name: definition.displayName,
    x,
    y: 0,
    railAccess: { x, y: 0, radius: 32.5 },
    inventories: Object.fromEntries(definition.inventory.map((slot) => [
      slot.productId,
      {
        productId: slot.productId,
        quantity: 0,
        reservedQuantity: 0,
        capacity: slot.capacity,
        recentInflow: 0,
        recentOutflow: 0,
        targetStock: slot.targetStock,
      },
    ])),
    activeRecipeId: definition.recipeIds[0] ?? null,
    recipeProgressTicks: 0,
  };
}

function connectedWorldWithoutTrain(): WorldData {
  const world = makeFirstFreightRouteWorld();
  world.trains = [];
  return world;
}

function structuralWorld(): {
  world: WorldData;
  connectedTopology: TrackTopologySnapshot;
} {
  const world = makeFirstFreightRouteWorld();
  world.freightProgress.profitableLogDeliveryCompleted = true;
  const sawmill = world.economy.facilities.find(
    ({ definitionId }) => definitionId === 'sawmill',
  );
  if (!sawmill) throw new Error('Missing Sawmill');
  sawmill.inventories['structural-timber'].quantity = 0;
  sawmill.inventories['structural-timber'].recentInflow = 0;
  world.economy.facilities.push(facility('prefabrication-plant', 1_000));
  world.tracks.push(trackStub(
    world.tracks[0],
    'sawmill-prefab-track',
    500,
    1_000,
  ));
  return {
    world,
    connectedTopology: [{
      kind: 'track',
      uuid: 'sawmill-prefab-track',
      previous: null,
      next: null,
    }],
  };
}

describe('deriveFreightObjective first profitable route', () => {
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

    expect(deriveFreightObjective(world, topology)).toEqual({
      objectiveVersion: 1,
      id: 'first-profitable-route',
      title: 'First freight route',
      status: 'Complete the timber service',
      achieved: false,
      steps: firstRouteSteps([
        'current',
        'pending',
        'pending',
        'pending',
        'pending',
      ]),
    });
  });

  it('preserves the five first-route facts and derives full log capacity from the catalogue', () => {
    const world = connectedWorldWithoutTrain();
    world.trains.push(trainWith({
      productId: 'logs',
      units: 60,
      loadedUnits: 60,
      originFacilityId: 'managed-forest',
    }));

    expect(deriveFreightObjective(world, firstRouteTopology).steps).toEqual(
      firstRouteSteps([
        'complete',
        'complete',
        'complete',
        'current',
        'pending',
      ]),
    );

    world.trains[0].cargo!.units = 59;
    world.trains[0].cargo!.loadedUnits = 59;
    expect(deriveFreightObjective(world, firstRouteTopology).steps).toEqual(
      firstRouteSteps([
        'complete',
        'complete',
        'current',
        'pending',
        'pending',
      ]),
    );
  });

  it('preserves delivered and profitable latch behavior through demolition', () => {
    const world = connectedWorldWithoutTrain();
    world.trains.push(trainWith(null, {
      lastTripRevenue: 100,
      lifetimeDeliveredUnits: 20,
    }));
    expect(deriveFreightObjective(world, firstRouteTopology).steps).toEqual(
      firstRouteSteps([
        'complete',
        'complete',
        'complete',
        'complete',
        'current',
      ]),
    );

    world.freightProgress.profitableLogDeliveryCompleted = true;
    world.tracks = [];
    world.trains = [];
    const dto = deriveFreightObjective(world, []);
    expect(dto.id).toBe('structural-timber-link');
  });
});

describe('deriveFreightObjective structural timber link', () => {
  it('advances to the four ordered structural-timber outcomes after the first latch', () => {
    const { world } = structuralWorld();

    expect(deriveFreightObjective(world, [])).toEqual({
      objectiveVersion: 1,
      id: 'structural-timber-link',
      title: 'Extend the timber chain',
      status: 'Use the development grant to reach the Prefabrication Plant',
      achieved: false,
      steps: structuralSteps([
        'current',
        'pending',
        'pending',
        'pending',
      ]),
    });
  });

  it.each([
    ['Sawmill stock', (world: WorldData) => {
      const sawmill = world.economy.facilities.find(
        ({ definitionId }) => definitionId === 'sawmill',
      )!;
      sawmill.inventories['structural-timber'].quantity = 1;
    }],
    ['Sawmill cumulative inflow', (world: WorldData) => {
      const sawmill = world.economy.facilities.find(
        ({ definitionId }) => definitionId === 'sawmill',
      )!;
      sawmill.inventories['structural-timber'].recentInflow = 1;
    }],
    ['train cargo', (world: WorldData) => {
      world.trains[0].cargo = {
        productId: 'structural-timber',
        units: 1,
        loadedUnits: 1,
        originFacilityId: 'sawmill',
      };
    }],
    ['Prefab cumulative inflow', (world: WorldData) => {
      const prefab = world.economy.facilities.find(
        ({ definitionId }) => definitionId === 'prefabrication-plant',
      )!;
      prefab.inventories['structural-timber'].recentInflow = 1;
    }],
  ])('recognises production evidence from %s', (_name, arrange) => {
    const { world } = structuralWorld();
    arrange(world);

    expect(deriveFreightObjective(world, []).steps).toEqual(
      structuralSteps([
        'complete',
        'current',
        'pending',
        'pending',
      ]),
    );
  });

  it('derives connection and loading from live topology and cargo', () => {
    const { world, connectedTopology } = structuralWorld();
    const sawmill = world.economy.facilities.find(
      ({ definitionId }) => definitionId === 'sawmill',
    )!;
    sawmill.inventories['structural-timber'].quantity = 1;
    world.trains[0].cargo = {
      productId: 'structural-timber',
      units: 12,
      loadedUnits: 12,
      originFacilityId: sawmill.id,
    };

    expect(deriveFreightObjective(world, connectedTopology).steps).toEqual(
      structuralSteps([
        'complete',
        'complete',
        'complete',
        'current',
      ]),
    );
  });

  it('regresses transient facts before completion and keeps sequential states', () => {
    const { world, connectedTopology } = structuralWorld();
    const sawmill = world.economy.facilities.find(
      ({ definitionId }) => definitionId === 'sawmill',
    )!;
    sawmill.inventories['structural-timber'].quantity = 1;
    world.trains[0].cargo = {
      productId: 'structural-timber',
      units: 12,
      loadedUnits: 12,
      originFacilityId: sawmill.id,
    };
    expect(deriveFreightObjective(world, connectedTopology).steps[2].state)
      .toBe('complete');

    sawmill.inventories['structural-timber'].quantity = 0;
    world.trains[0].cargo = null;
    world.tracks = [];

    expect(deriveFreightObjective(world, []).steps).toEqual(
      structuralSteps([
        'current',
        'pending',
        'pending',
        'pending',
      ]),
    );
  });

  it('freezes all four steps complete once the structural latch is durable', () => {
    const { world } = structuralWorld();
    world.freightProgress.profitableStructuralTimberDeliveryCompleted = true;
    world.tracks = [];
    world.trains = [];
    world.economy.facilities.forEach((entry) => {
      const timber = entry.inventories['structural-timber'];
      if (timber) {
        timber.quantity = 0;
        timber.recentInflow = 0;
      }
    });

    expect(deriveFreightObjective(world, [])).toEqual({
      objectiveVersion: 1,
      id: 'structural-timber-link',
      title: 'Extend the timber chain',
      status: 'Timber link profitable · Prefabrication awaits cement and steel',
      achieved: true,
      steps: structuralSteps([
        'complete',
        'complete',
        'complete',
        'complete',
      ]),
    });
  });

  it('returns deeply frozen data without mutating world authority', () => {
    const { world, connectedTopology } = structuralWorld();
    const before = clone(world);

    const dto = deriveFreightObjective(world, connectedTopology);

    expect(world).toEqual(before);
    expect(Object.isFrozen(dto)).toBe(true);
    expect(Object.isFrozen(dto.steps)).toBe(true);
    dto.steps.forEach((step) => expect(Object.isFrozen(step)).toBe(true));
  });
});

describe('FreightObjectiveCelebrationSession', () => {
  it('celebrates once per non-empty world and objective ID', () => {
    const session = new FreightObjectiveCelebrationSession();

    expect(session.consume(
      '',
      'first-profitable-route',
      true,
    )).toBe(false);
    expect(session.consume(
      'world-a',
      'first-profitable-route',
      false,
    )).toBe(false);
    expect(session.consume(
      'world-a',
      'first-profitable-route',
      true,
    )).toBe(true);
    expect(session.consume(
      'world-a',
      'first-profitable-route',
      true,
    )).toBe(false);
    expect(session.consume(
      'world-a',
      'structural-timber-link',
      true,
    )).toBe(true);
    expect(session.consume(
      'world-a',
      'structural-timber-link',
      true,
    )).toBe(false);
    expect(session.consume(
      'world-b',
      'first-profitable-route',
      true,
    )).toBe(true);
  });

  it('exports one module-lifetime objective celebration owner', () => {
    expect(freightObjectiveCelebrationSession)
      .toBeInstanceOf(FreightObjectiveCelebrationSession);
  });
});
