/**
 * @jest-environment jsdom
 */

import { EconomySystem } from '../../src/economy/EconomySystem';
import type { TrainRuntimeSnapshot } from '../../src/freight/TrainRuntime';
import { WorldManager } from '../../src/managers/WorldManager';
import { clonePlainData } from '../../src/utils/PlainData';
import {
  installFirstFreightRoutePhase,
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

describe('Integration: persisted fixed-tick economy', () => {
  beforeEach(() => {
    localStorage.clear();
    WorldManager.reset();
  });

  afterEach(() => {
    WorldManager.reset();
    localStorage.clear();
  });

  it('reloads the exact tick, recipe progress, market, and inventories', () => {
    const world = WorldManager.createNew(
      'Persisted economy',
      'economy-persistence',
    );
    const system = new EconomySystem();

    expect(system.update(4_000, true, []).ticksAdvanced).toBe(4);
    expect(world.economy.tick).toBe(4);
    expect(world.economy.facilities.find(
      ({ id }) => id === 'managed-forest',
    )?.inventories.logs.quantity).toBe(68);
    expect(WorldManager.save()).toBe(true);

    const expectedEconomy = clonePlainData(world.economy);
    const expectedRevision = world.revision;
    const expectedOperationsRevision = world.operationsRevision;
    const expectedConstructionRevision = world.constructionRevision;
    const worldId = world.id;
    WorldManager.reset();

    const reloaded = WorldManager.load(worldId);

    expect(reloaded?.economy).toEqual(expectedEconomy);
    expect(reloaded?.revision).toBe(expectedRevision);
    expect(reloaded?.operationsRevision).toBe(expectedOperationsRevision);
    expect(reloaded?.constructionRevision)
      .toBe(expectedConstructionRevision);
  });

  it('does not persist or restore the sub-tick accumulator', () => {
    const world = WorldManager.createNew(
      'Fresh accumulator',
      'economy-accumulator',
    );
    const firstRuntime = new EconomySystem();

    expect(firstRuntime.update(750, true, []).ticksAdvanced).toBe(0);
    expect(WorldManager.save()).toBe(true);
    const worldId = world.id;
    WorldManager.reset();
    expect(WorldManager.load(worldId)?.economy.tick).toBe(0);

    const reloadedRuntime = new EconomySystem();
    expect(reloadedRuntime.update(250, true, []).ticksAdvanced).toBe(0);
    expect(WorldManager.world?.economy.tick).toBe(0);
    expect(reloadedRuntime.update(750, true, []).ticksAdvanced).toBe(1);
    expect(WorldManager.world?.economy.tick).toBe(1);
  });

  it('reloads cargo origin, position, trip and lifetime totals at the operations cursor', () => {
    const world = installFirstFreightRoutePhase({ cargoUnits: 30 });
    const system = new EconomySystem();
    expect(system.update(1_000, true, [{
      trainId: 'train-1',
      trackUUID: 'forest-sawmill-track',
      trackT: 0.5,
      facing: -1,
      x: 0,
      y: 0,
      speedWorldUnitsPerSecond: 12,
      throttle: 1,
      derailed: false,
    }]).ticksAdvanced).toBe(1);
    const expected = clonePlainData({
      cargo: world.trains[0].cargo,
      operations: world.trains[0].operations,
      trackUUID: world.trains[0].trackUUID,
      trackT: world.trains[0].trackT,
      facing: world.trains[0].facing,
      tick: world.economy.tick,
      cash: world.company.cash,
      ledger: world.company.ledger,
      freightProgress: world.freightProgress,
      revision: world.revision,
      operationsRevision: world.operationsRevision,
    });
    expect(WorldManager.save()).toBe(true);
    WorldManager.reset();

    const reloaded = WorldManager.load(world.id);

    expect(reloaded).not.toBeNull();
    expect({
      cargo: reloaded?.trains[0].cargo,
      operations: reloaded?.trains[0].operations,
      trackUUID: reloaded?.trains[0].trackUUID,
      trackT: reloaded?.trains[0].trackT,
      facing: reloaded?.trains[0].facing,
      tick: reloaded?.economy.tick,
      cash: reloaded?.company.cash,
      ledger: reloaded?.company.ledger,
      freightProgress: reloaded?.freightProgress,
      revision: reloaded?.revision,
      operationsRevision: reloaded?.operationsRevision,
    }).toEqual(expected);
  });

  it('reloads both authoritative mineral latches with their atomic delivery state', () => {
    const world = WorldManager.createNew(
      'Persisted mineral progress',
      'economy-persistence-minerals',
    );
    const fixture = makeFirstFreightRouteWorld();
    world.tracks = clonePlainData(fixture.tracks);
    const cementWorks = world.economy.facilities.find(
      ({ definitionId }) => definitionId === 'cement-works',
    );
    const prefab = world.economy.facilities.find(
      ({ definitionId }) => definitionId === 'prefabrication-plant',
    );
    if (!cementWorks || !prefab) {
      throw new Error('Generated mineral destinations are missing');
    }
    const mineralTrain = (
      id: string,
      freightSetId: string,
      productId: 'limestone-aggregate' | 'cement',
      loadedUnits: number,
      originFacilityId: string,
    ) => makeFreightTrainDef({
      id,
      freightSetId,
      cargo: {
        productId,
        units: 10,
        loadedUnits,
        originFacilityId,
      },
      operations: {
        ...makeFreightTrainDef().operations,
        currentTripRevenue: 5_000,
        currentTripRunningCost: 1_000,
        lifetimeRevenue: 5_000,
        lifetimeRunningCost: 1_000,
      },
    });
    world.trains = [
      mineralTrain(
        'aggregate-train',
        'aggregate-hopper-set',
        'limestone-aggregate',
        120,
        'quarry',
      ),
      mineralTrain(
        'cement-train',
        'covered-cement-set',
        'cement',
        80,
        'cement-works',
      ),
    ];
    const stoppedAt = (
      trainId: string,
      x: number,
      y: number,
    ): TrainRuntimeSnapshot => ({
      trainId,
      trackUUID: 'forest-sawmill-track',
      trackT: 0.9,
      facing: 1,
      x,
      y,
      speedWorldUnitsPerSecond: 0,
      throttle: 0,
      derailed: false,
    });
    const runtime = [
      stoppedAt(
        'aggregate-train',
        cementWorks.railAccess.x,
        cementWorks.railAccess.y,
      ),
      stoppedAt(
        'cement-train',
        prefab.railAccess.x,
        prefab.railAccess.y,
      ),
    ];

    const update = new EconomySystem().update(1_000, true, runtime);

    expect(update.ticksAdvanced).toBe(1);
    expect(update.completedDeliveries.map(({ productId }) => productId).sort())
      .toEqual(['cement', 'limestone-aggregate']);
    expect(world.freightProgress).toEqual({
      progressVersion: 1,
      profitableLogDeliveryCompleted: false,
      developmentGrantAwarded: false,
      profitableStructuralTimberDeliveryCompleted: false,
      profitableLimestoneDeliveryCompleted: true,
      profitableCementDeliveryCompleted: true,
      profitableSteelDeliveryCompleted: false,
      profitableBuildingModuleDeliveryCompleted: false,
    });
    expect(world.trains.every(({ cargo }) => cargo === null)).toBe(true);
    const expected = clonePlainData({
      company: world.company,
      economy: world.economy,
      trains: world.trains,
      freightProgress: world.freightProgress,
      revision: world.revision,
      operationsRevision: world.operationsRevision,
    });
    expect(WorldManager.save()).toBe(true);
    const worldId = world.id;
    WorldManager.reset();

    const reloaded = WorldManager.load(worldId);

    expect(reloaded).not.toBeNull();
    expect({
      company: reloaded?.company,
      economy: reloaded?.economy,
      trains: reloaded?.trains,
      freightProgress: reloaded?.freightProgress,
      revision: reloaded?.revision,
      operationsRevision: reloaded?.operationsRevision,
    }).toEqual(expected);
  });
});
