import { createEmptyWorld, validateWorldData, type TrackDef, type TrainDef, type WorldData } from '../../src/config/WorldData';
import { getFacilityDefinition } from '../../src/economy/ProductCatalog';
import { LAUNCH_PRODUCTS } from '../../src/economy/InitialEconomyContent';
import { validateCompanyState } from '../../src/economy/FinanceLedger';
import { SaveRepository } from '../../src/persistence/SaveRepository';
import { MemoryStorage } from '../../src/persistence/StoragePort';
import { acceptProject, connectProjectStation, createRegionState, footprintIsClear, resolveTransformationFootprints } from '../../src/region/RegionalProjects';
import * as regionalProjects from '../../src/region/RegionalProjects';
import { passengerCounts } from '../../src/region/PassengerSystem';
import { SimulationSession } from '../../src/simulation/SimulationSession';
import { runRehearsal } from '../../src/simulation/Rehearsal';
import type { ServiceDefinition, SimulationEvent } from '../../src/simulation/SimulationTypes';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';

const corridor = (uuid: string, y: number): TrackDef => ({ geometryVersion: 1, uuid,
  p0: { x: 0, y }, p1: { x: 400, y }, p2: { x: 800, y }, p3: { x: 1_200, y },
  verticalProfile: { profileVersion: 1, knots: [{ t: 0, elevation: 40 }, { t: 1, elevation: 40 }] },
  structures: [{ type: 'surface', startT: 0, endT: 1, startElevation: 40, endElevation: 40 }], paidBuildCost: 0 });

const vehicle = (id: string, trackUUID: string, vehicleFamilyId: string): TrainDef => ({ id, trackUUID, vehicleFamilyId,
  freightSetId: 'flatbed-freight-set', trackT: 0.25, facing: 1, cargo: null,
  dynamics: { mode: 'on-rail', trackUUID, distance: 300, direction: 1, speedMps: 0, consistId: `consist-${id}`, consistOrder: 0 },
  operations: { currentTripRevenue: 0, currentTripRunningCost: 0, lastTripRevenue: 0, lastTripRunningCost: 0, lifetimeDeliveredUnits: 0, lifetimeRevenue: 0, lifetimeRunningCost: 0 } });

/** Stock and infrastructure are fixture inputs; all project progress must come from running services. */
function housingRegion(): WorldData {
  const world = createEmptyWorld('Homes by rail', 'signature-housing', 'temperate', makeStarterOpportunity());
  world.id = 'signature-housing';
  world.tracks = [corridor('modules-line', 0), corridor('residents-line', 400)];
  world.trains = [vehicle('module-train', 'modules-line', 'mixed-diesel'), vehicle('resident-train', 'residents-line', 'regional-dmu')];
  world.economy.facilities = ['prefabrication-plant', 'town-construction-market'].map((id, i) => {
    const definition = getFacilityDefinition(id)!;
    const x = i === 0 ? 300 : 900;
    return { id, definitionId: id, name: definition.displayName, x, y: 0, railAccess: { x, y: 0, radius: 32.5 },
      inventories: Object.fromEntries(definition.inventory.map(slot => [slot.productId, { productId: slot.productId,
        quantity: i === 0 && slot.productId === 'building-modules' ? 40 : 0, reservedQuantity: 0,
        capacity: slot.capacity, targetStock: slot.targetStock, recentInflow: 0, recentOutflow: 0 }])),
      activeRecipeId: definition.recipeIds[0] ?? null, recipeProgressTicks: 0 };
  });
  for (const product of LAUNCH_PRODUCTS) world.economy.market.regionalDemandBpsByProduct[product.id] = 10_000;
  world.stations = [
    { id: 'origin', name: 'Old Town', trackUUID: 'residents-line', trackT: 0.25, passengerSpawnRate: 120, platformLengthMetres: 60 },
    { id: 'new-homes', name: 'New Homes', trackUUID: 'residents-line', trackT: 0.75, passengerSpawnRate: 0, platformLengthMetres: 60 },
  ];
  world.region = connectProjectStation(acceptProject(createRegionState(world), 'housing'), 'housing', 'new-homes');
  return world;
}

const services: ServiceDefinition[] = [
  { id: 'modules', name: 'Homes supplies', trainId: 'module-train', kind: 'freight', enabled: true, priority: 1, frequencySeconds: 0, departureOffsetSeconds: 0,
    stops: [{ targetId: 'prefabrication-plant', targetKind: 'facility', loadRule: 'full', maxWaitSeconds: 8 }, { targetId: 'town-construction-market', targetKind: 'facility', loadRule: 'unload', maxWaitSeconds: 8 }] },
  { id: 'residents', name: 'Residents shuttle', trainId: 'resident-train', kind: 'passenger', enabled: true, priority: 1, frequencySeconds: 0, departureOffsetSeconds: 0,
    stops: [{ targetId: 'origin', targetKind: 'station', loadRule: 'none', maxWaitSeconds: 8 }, { targetId: 'new-homes', targetKind: 'station', loadRule: 'none', maxWaitSeconds: 8 }] },
];

function advanceAt20Hz(session: SimulationSession, seconds: number): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (let frame = 0; frame < seconds * 20; frame++) {
    session.advance(50);
    events.push(...session.drainEvents());
  }
  return events;
}

describe('design, rehearse and transform signature slice', () => {
  it.each(['bound', 'nearby'] as const)('completes housing with %s station selection through real services and durable reload without a second grant', async (binding) => {
    const source = housingRegion();
    if (binding === 'nearby') source.region = connectProjectStation(source.region!, 'housing', null);
    expect(validateWorldData(source).compatible).toBe(true);
    const session = new SimulationSession(source);
    for (const service of services) expect(session.upsertService(service)).toEqual({ ok: true, errors: [] });
    const planned = session.snapshot();
    expect(planned.region.projects.find(project => project.definitionId === 'housing')!.progress).toEqual({ modules: 0, residents: 0 });
    expect(planned.management.passengers.generated).toBe(0);
    const beforeRehearsal = JSON.stringify(planned);
    const regionalEvents = jest.spyOn(regionalProjects, 'applyRegionEvent');
    let forecast: ReturnType<typeof runRehearsal>;
    try {
      forecast = runRehearsal({ requestId: 'housing-rehearsal', world: planned, horizonSeconds: 120, sampleIntervalSeconds: 5 });
      const arrivals = regionalEvents.mock.calls.map(([, event]) => event).filter(event => event.kind === 'passenger-arrival');
      expect(arrivals.length).toBeGreaterThan(0);
      expect(arrivals.every(event => event.kind === 'passenger-arrival' && Number.isFinite(event.x) && Number.isFinite(event.y))).toBe(true);
      expect(regionalEvents.mock.results.some(result => result.type === 'return'
        && result.value.state.projects.find(project => project.definitionId === 'housing').progress.residents > 0)).toBe(true);
    } finally {
      regionalEvents.mockRestore();
    }
    expect(forecast.status).toBe('complete');
    expect(forecast.engineering.deliveredUnits).toBeGreaterThan(0);
    expect(forecast.engineering.passengersDelivered).toBeGreaterThan(0);
    expect(JSON.stringify(planned)).toBe(beforeRehearsal);
    expect(session.snapshot()).toEqual(planned);

    const events = advanceAt20Hz(session, 180);
    const completed = session.snapshot();
    const modules = events.filter(event => event.type === 'freight-delivery' && event.productId === 'building-modules' && event.destinationFacilityId === 'town-construction-market');
    const arrivals = events.filter(event => event.type === 'passenger-arrival' && event.originStationId === 'origin' && event.stationId === 'new-homes');
    expect(modules.reduce((sum, event) => sum + (event.type === 'freight-delivery' ? event.units : 0), 0)).toBeGreaterThanOrEqual(16);
    expect(arrivals.reduce((sum, event) => sum + (event.type === 'passenger-arrival' ? event.passengers : 0), 0)).toBeGreaterThanOrEqual(60);
    const housing = completed.region.projects.find(project => project.definitionId === 'housing')!;
    expect(housing.progress).toEqual({ modules: 16, residents: 60 });
    expect(housing.completedAtTick).not.toBeNull();
    expect(completed.region.transformations).toEqual([{ projectId: 'housing', tick: housing.completedAtTick, x: 900, y: 0 }]);
    expect(completed.region.unlockIds).toEqual(['housing-extension']);
    expect(completed.region.passengerDemandBonusBps).toBe(2_500);
    expect(completed.economy.market.regionalDemandBpsByProduct.food).toBe(11_000);
    const grants = completed.company.ledger.filter(entry => entry.referenceId === 'project:housing');
    expect(grants).toHaveLength(1);
    expect(grants[0]).toEqual(expect.objectContaining({ category: 'contract-bonus', amount: 30_000, tick: housing.completedAtTick }));
    expect(validateCompanyState(completed.company)).toEqual({ valid: true });
    const factory = completed.economy.facilities.find(facility => facility.id === 'prefabrication-plant')!;
    const town = completed.economy.facilities.find(facility => facility.id === 'town-construction-market')!;
    expect(factory.inventories['building-modules'].quantity + town.inventories['building-modules'].quantity
      + town.inventories['building-modules'].recentOutflow + (completed.trains.find(train => train.id === 'module-train')!.cargo?.units ?? 0)).toBe(40);
    const counts = passengerCounts(completed.management.passengers);
    expect(counts.generated).toBe(counts.waiting + counts.onboard + counts.arrived);

    const unreserved = resolveTransformationFootprints(completed.region, completed.tracks);
    expect(unreserved).toHaveLength(1);
    const draft = corridor('reserved-future-railway', unreserved[0].y);
    for (const key of ['p0', 'p1', 'p2', 'p3'] as const) draft[key].x += unreserved[0].x - 600;
    expect(footprintIsClear(unreserved[0], [draft])).toBe(false);
    const protectedFootprints = resolveTransformationFootprints(completed.region, completed.tracks, [draft]);
    expect(protectedFootprints).toHaveLength(1);
    expect(protectedFootprints[0]).not.toEqual(unreserved[0]);
    expect(protectedFootprints[0].buildingCount).toBe(9);
    expect(footprintIsClear(protectedFootprints[0], [...completed.tracks, draft])).toBe(true);

    const storage = new MemoryStorage();
    const repository = new SaveRepository(storage);
    await repository.save(completed); await repository.flush();
    const loaded = await new SaveRepository(storage).load(completed.id);
    expect(loaded.recovered).toBe(false); expect(loaded.warnings).toEqual([]);
    expect(loaded.world).toEqual(completed);
    expect(resolveTransformationFootprints(loaded.world!.region!, loaded.world!.tracks, [draft])).toEqual(protectedFootprints);
    const resumed = new SimulationSession(loaded.world!);
    const laterEvents = advanceAt20Hz(resumed, 60);
    const later = resumed.snapshot();
    expect(laterEvents.some(event => event.type === 'freight-delivery' && event.productId === 'building-modules')).toBe(true);
    expect(laterEvents.some(event => event.type === 'passenger-arrival' && event.stationId === 'new-homes')).toBe(true);
    expect(later.company.ledger.filter(entry => entry.referenceId === 'project:housing')).toEqual(grants);
    expect(later.region.transformations).toEqual(completed.region.transformations);
    // Base demand is 120/minute; the completed neighbourhood adds a real 25% uplift.
    expect(later.management.passengers.generated - completed.management.passengers.generated).toBe(150);
    expect(validateWorldData(later).compatible).toBe(true);
    expect(source.region!.projects.find(project => project.definitionId === 'housing')!.completedAtTick).toBeNull();
  });

  it('does not credit a remotely bound station despite real arrivals in either rehearsal or live simulation', () => {
    const source = housingRegion();
    source.tracks[1] = corridor('residents-line', 4_000);
    const session = new SimulationSession(source);
    for (const service of services) expect(session.upsertService(service)).toEqual({ ok: true, errors: [] });
    const planned = session.snapshot();
    const regionalEvents = jest.spyOn(regionalProjects, 'applyRegionEvent');
    try {
      const forecast = runRehearsal({ requestId: 'remote-residents', world: planned, horizonSeconds: 120 });
      expect(forecast.status).toBe('complete');
      expect(forecast.engineering.passengersDelivered).toBeGreaterThan(0);
      expect(regionalEvents.mock.calls.some(([, event]) => event.kind === 'passenger-arrival' && event.y === 4_000)).toBe(true);
      expect(regionalEvents.mock.results.every(result => result.type === 'return'
        && result.value.state.projects.find(project => project.definitionId === 'housing').progress.residents === 0)).toBe(true);
    } finally {
      regionalEvents.mockRestore();
    }
    expect(session.snapshot()).toEqual(planned);
    const events = advanceAt20Hz(session, 180);
    expect(events.reduce((sum, event) => sum + (event.type === 'passenger-arrival' ? event.passengers : 0), 0)).toBeGreaterThanOrEqual(60);
    const current = session.snapshot();
    const housing = current.region.projects.find(project => project.definitionId === 'housing')!;
    expect(housing.progress).toEqual({ modules: 16, residents: 0 });
    expect(housing.completedAtTick).toBeNull();
    expect(current.region.transformations).toEqual([]);
    expect(current.company.ledger.filter(entry => entry.referenceId === 'project:housing')).toEqual([]);
  });
});
