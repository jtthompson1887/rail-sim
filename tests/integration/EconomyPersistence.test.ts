/**
 * @jest-environment jsdom
 */

import { EconomySystem } from '../../src/economy/EconomySystem';
import { WorldManager } from '../../src/managers/WorldManager';
import { clonePlainData } from '../../src/utils/PlainData';

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

    expect(system.update(4_000, true).ticksAdvanced).toBe(4);
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

    expect(firstRuntime.update(750, true).ticksAdvanced).toBe(0);
    expect(WorldManager.save()).toBe(true);
    const worldId = world.id;
    WorldManager.reset();
    expect(WorldManager.load(worldId)?.economy.tick).toBe(0);

    const reloadedRuntime = new EconomySystem();
    expect(reloadedRuntime.update(250, true).ticksAdvanced).toBe(0);
    expect(WorldManager.world?.economy.tick).toBe(0);
    expect(reloadedRuntime.update(750, true).ticksAdvanced).toBe(1);
    expect(WorldManager.world?.economy.tick).toBe(1);
  });
});
