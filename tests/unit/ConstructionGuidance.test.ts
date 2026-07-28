import type { WorldData } from '../../src/config/WorldData';
import {
  deriveConstructionGuidance,
} from '../../src/freight/ConstructionGuidance';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

const ownedSet = (
  world: WorldData,
  freightSetId: string,
  id: string,
): void => {
  world.trains.push({
    ...makeFreightTrainDef({ id, freightSetId }),
    id,
    freightSetId,
  });
};

describe('deriveConstructionGuidance', () => {
  it('reserves one unowned flatbed plus operating cash before log profit', () => {
    const world = makeFirstFreightRouteWorld();
    world.trains = [];

    expect(deriveConstructionGuidance(world)).toEqual({
      guidanceVersion: 1,
      phase: 'first-route',
      objective: 'Connect Managed Forest to Sawmill.',
      reserve: 110_000,
      reservePurpose: 'a General Flatbed Set and operating reserve',
      requiredFreightSetIds: ['flatbed-freight-set'],
    });

    ownedSet(world, 'flatbed-freight-set', 'owned-flatbed');
    expect(deriveConstructionGuidance(world)).toEqual({
      guidanceVersion: 1,
      phase: 'first-route',
      objective: 'Connect Managed Forest to Sawmill.',
      reserve: 20_000,
      reservePurpose: 'operating reserve',
      requiredFreightSetIds: [],
    });
  });

  it('retains an unowned flatbed during the structural phase', () => {
    const world = makeFirstFreightRouteWorld();
    world.trains = [];
    world.freightProgress.profitableLogDeliveryCompleted = true;

    expect(deriveConstructionGuidance(world)).toEqual({
      guidanceVersion: 1,
      phase: 'structural-timber',
      objective: 'Connect Sawmill to Prefabrication Plant.',
      reserve: 110_000,
      reservePurpose: 'a General Flatbed Set and operating reserve',
      requiredFreightSetIds: ['flatbed-freight-set'],
    });
  });

  it('reserves each exact unowned mineral set once before limestone profit', () => {
    const world = makeFirstFreightRouteWorld();
    world.trains = [];
    world.freightProgress.profitableLogDeliveryCompleted = true;
    world.freightProgress.profitableStructuralTimberDeliveryCompleted = true;

    expect(deriveConstructionGuidance(world)).toEqual({
      guidanceVersion: 1,
      phase: 'limestone',
      objective: 'Connect Quarry to Cement Works.',
      reserve: 235_000,
      reservePurpose:
        'an Aggregate Hopper Set, a Covered Cement Set, and operating reserve',
      requiredFreightSetIds: [
        'aggregate-hopper-set',
        'covered-cement-set',
      ],
    });

    ownedSet(world, 'aggregate-hopper-set', 'owned-aggregate');
    expect(deriveConstructionGuidance(world)).toEqual({
      guidanceVersion: 1,
      phase: 'limestone',
      objective: 'Connect Quarry to Cement Works.',
      reserve: 125_000,
      reservePurpose: 'a Covered Cement Set and operating reserve',
      requiredFreightSetIds: ['covered-cement-set'],
    });
  });

  it('reserves only an unowned covered set after limestone profit', () => {
    const world = makeFirstFreightRouteWorld();
    world.trains = [];
    world.freightProgress.profitableLogDeliveryCompleted = true;
    world.freightProgress.profitableStructuralTimberDeliveryCompleted = true;
    world.freightProgress.profitableLimestoneDeliveryCompleted = true;

    expect(deriveConstructionGuidance(world)).toEqual({
      guidanceVersion: 1,
      phase: 'cement',
      objective: 'Connect Cement Works to Prefabrication Plant.',
      reserve: 125_000,
      reservePurpose: 'a Covered Cement Set and operating reserve',
      requiredFreightSetIds: ['covered-cement-set'],
    });

    ownedSet(world, 'covered-cement-set', 'owned-covered');
    expect(deriveConstructionGuidance(world)).toEqual({
      guidanceVersion: 1,
      phase: 'cement',
      objective: 'Connect Cement Works to Prefabrication Plant.',
      reserve: 20_000,
      reservePurpose: 'operating reserve',
      requiredFreightSetIds: [],
    });
  });

  it('keeps only the operating reserve after achievement', () => {
    const world = makeFirstFreightRouteWorld();
    world.freightProgress.profitableLogDeliveryCompleted = true;
    world.freightProgress.profitableStructuralTimberDeliveryCompleted = true;
    world.freightProgress.profitableLimestoneDeliveryCompleted = true;
    world.freightProgress.profitableCementDeliveryCompleted = true;

    const guidance = deriveConstructionGuidance(world);

    expect(guidance).toEqual({
      guidanceVersion: 1,
      phase: 'achieved',
      objective: 'Cement secured · Prefabrication awaits steel.',
      reserve: 20_000,
      reservePurpose: 'operating reserve',
      requiredFreightSetIds: [],
    });
    expect(Object.isFrozen(guidance)).toBe(true);
    expect(Object.isFrozen(guidance.requiredFreightSetIds)).toBe(true);
  });
});
