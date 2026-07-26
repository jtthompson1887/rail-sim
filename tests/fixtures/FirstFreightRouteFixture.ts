import {
  createEmptyWorld,
  type TrainDef,
  type WorldData,
} from '../../src/config/WorldData';
import { getFacilityDefinition } from '../../src/economy/ProductCatalog';
import type {
  FacilityDefinition,
  FacilityEconomyDef,
} from '../../src/economy/EconomyData';
import { makeStarterOpportunity } from './StarterOpportunityFixture';

const makeFacility = (
  definition: FacilityDefinition,
  x: number,
): FacilityEconomyDef => ({
  id: definition.id,
  definitionId: definition.id,
  name: definition.displayName,
  x,
  y: 0,
  railAccess: { x, y: 0, radius: 32.5 },
  inventories: Object.fromEntries(definition.inventory.map((slot) => [
    slot.productId,
    {
      productId: slot.productId,
      quantity: slot.initialQuantity,
      reservedQuantity: 0,
      capacity: slot.capacity,
      recentInflow: 0,
      recentOutflow: 0,
      targetStock: slot.targetStock,
    },
  ])),
  activeRecipeId: definition.recipeIds[0] ?? null,
  recipeProgressTicks: 0,
});

export const makeFreightTrainDef = (
  overrides: Partial<TrainDef> = {},
): TrainDef => ({
  id: 'train-1',
  freightSetId: 'timber-freight-set',
  trackUUID: 'forest-sawmill-track',
  trackT: 0.1,
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
  ...overrides,
});

export const makeFirstFreightRouteWorld = (): WorldData => {
  const world = createEmptyWorld(
    'First freight route',
    'first-freight-route',
    'temperate',
    makeStarterOpportunity('first-freight-route'),
  );
  world.tracks.push({
    geometryVersion: 1,
    uuid: 'forest-sawmill-track',
    p0: { x: -500, y: 0 },
    p1: { x: -167, y: 0 },
    p2: { x: 167, y: 0 },
    p3: { x: 500, y: 0 },
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
  });

  const forestDefinition = getFacilityDefinition('managed-forest');
  const sawmillDefinition = getFacilityDefinition('sawmill');
  if (!forestDefinition || !sawmillDefinition) {
    throw new Error('First freight route facility definitions are missing');
  }
  world.economy.facilities.push(
    makeFacility(forestDefinition, -500),
    makeFacility(sawmillDefinition, 500),
  );
  world.trains.push(makeFreightTrainDef());
  return world;
};
