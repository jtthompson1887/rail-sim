import { createRiversideRegion } from '../../src/region/RiversideRegion';
import { SimulationSession } from '../../src/simulation/SimulationSession';
import type { ManagedWorld, ServiceDefinition } from '../../src/simulation/SimulationTypes';
import { clonePlainData } from '../../src/utils/PlainData';
import { validateWorldData } from '../../src/config/WorldData';
import { SaveRepository } from '../../src/persistence/SaveRepository';
import { MemoryStorage } from '../../src/persistence/StoragePort';

function advanceUntil(session: SimulationSession, predicate: (world: ManagedWorld) => boolean, seconds = 350): ManagedWorld {
  for (let step = 0; step < seconds * 4; step++) {
    session.advance(250);
    const world = session.snapshot();
    if (predicate(world)) return world;
  }
  throw new Error(`Service condition did not occur by ${session.clockSeconds}s: ${JSON.stringify(session.snapshot().management.serviceStates)}`);
}

function travelling(session: SimulationSession, serviceId: string, nextStopIndex = 1): ManagedWorld {
  return advanceUntil(session, world => {
    const service = world.management.services.find(candidate => candidate.id === serviceId)!;
    const state = world.management.serviceStates[serviceId];
    const train = world.trains.find(candidate => candidate.id === service.trainId)!;
    const loaded = service.kind === 'freight' ? (train.cargo?.units ?? 0) > 0
      : world.management.passengers.cohorts.some(cohort => cohort.trainId === train.id);
    return state.phase === 'travelling' && state.nextStopIndex === nextStopIndex && state.calls >= 3
      && loaded && train.dynamics.mode === 'on-rail' && train.dynamics.speedMps > 1;
  });
}

describe('editing a live Brookford timetable', () => {
  it.each(['mill-goods', 'valley-local'])('preserves the current trip and earned history for %s and persists its edits', async serviceId => {
    const session = new SimulationSession(createRiversideRegion());session.setSpeed(1);
    const before = travelling(session, serviceId);
    const prior = before.management.services.find(service => service.id === serviceId)!;
    const routesBefore = session.presentationRoutes();
    const edited: ServiceDefinition = { ...clonePlainData(prior), name: `${prior.name} revised`,
      frequencySeconds: 180, departureOffsetSeconds: 300, priority: 7,
      stops: prior.stops.map((stop,index) => ({ ...stop, maxWaitSeconds: 12,
        loadRule: prior.kind === 'freight' && index === 0 ? 'available' : stop.loadRule })) };
    expect(session.upsertService(edited)).toEqual({ ok: true, errors: [] });
    const changed = session.snapshot();
    expect(changed.management.services.find(service => service.id === serviceId)).toEqual(edited);
    expect(changed.management.serviceStates).toEqual(before.management.serviceStates);
    expect(changed.trains).toEqual(before.trains);
    expect(changed.management.passengers).toEqual(before.management.passengers);
    expect(changed.company).toEqual(before.company);
    expect(changed.economy).toEqual(before.economy);
    expect(session.presentationRoutes()).toEqual(routesBefore);
    expect(changed.operationsRevision).toBe(before.operationsRevision + 1);
    const distanceBefore = changed.management.serviceStates[serviceId].distanceWorldUnits;
    session.advance(250);
    expect(session.snapshot().management.serviceStates[serviceId].distanceWorldUnits).toBeGreaterThan(distanceBefore);
    const saved = session.snapshot(),storage = new MemoryStorage(),repository = new SaveRepository(storage);
    await repository.save(saved);await repository.flush();
    const loaded = (await new SaveRepository(storage).load(saved.id)).world!;
    expect(loaded).toEqual(saved);
    const resumed = new SimulationSession(loaded);resumed.advance(250);
    expect(resumed.snapshot().management.serviceStates[serviceId].nextStopIndex).toBe(1);
    expect(resumed.snapshot().management.serviceStates[serviceId].distanceWorldUnits).toBeGreaterThan(saved.management.serviceStates[serviceId].distanceWorldUnits);
    const returning = advanceUntil(resumed, world => world.management.serviceStates[serviceId].nextStopIndex === 0
      && world.management.serviceStates[serviceId].phase === 'travelling');
    const nextDeparture = returning.management.serviceStates[serviceId].nextDepartureSeconds;
    expect(nextDeparture).toBeGreaterThanOrEqual(returning.management.clockSeconds - .25);
    expect(Number.isInteger((nextDeparture - edited.departureOffsetSeconds) / edited.frequencySeconds)).toBe(true);
    expect(validateWorldData(resumed.snapshot()).compatible).toBe(true);
  });

  it('continues a return journey and applies the new departure slot at its origin station', () => {
    const session = new SimulationSession(createRiversideRegion());session.setSpeed(1);
    const before = travelling(session, 'valley-local', 0);
    const prior = before.management.services.find(service => service.id === 'valley-local')!;
    const departure = Math.ceil(before.management.clockSeconds) + 120;
    expect(session.upsertService({ ...clonePlainData(prior), frequencySeconds: 120, departureOffsetSeconds: departure }).ok).toBe(true);
    const changed = session.snapshot();
    expect(changed.trains).toEqual(before.trains);
    expect(changed.company).toEqual(before.company);
    expect(changed.management.passengers).toEqual(before.management.passengers);
    expect(changed.management.serviceStates['valley-local']).toEqual({ ...before.management.serviceStates['valley-local'], nextDepartureSeconds: departure });
    const atOrigin = advanceUntil(session, world => world.management.serviceStates['valley-local'].phase === 'dwelling'
      && world.management.serviceStates['valley-local'].nextStopIndex === 0);
    expect(atOrigin.management.clockSeconds).toBeLessThan(departure);
    while (session.clockSeconds + .25 < departure) {
      session.advance(250);
      expect(session.snapshot().management.serviceStates['valley-local'].nextStopIndex).toBe(0);
    }
    const departed = advanceUntil(session, world => world.management.serviceStates['valley-local'].nextStopIndex === 1, 2);
    expect(departed.management.clockSeconds).toBeGreaterThanOrEqual(departure);
  });

  it('rejects invalid edits atomically and keeps stop-order changes as route resets', () => {
    const session = new SimulationSession(createRiversideRegion());session.setSpeed(1);
    const before = travelling(session, 'valley-local');
    const prior = before.management.services.find(service => service.id === 'valley-local')!;
    const routesBefore = session.presentationRoutes();
    const invalid: unknown[] = [null, { ...prior, stops: null }, { ...prior, frequencySeconds: -1 },
      { ...prior, departureOffsetSeconds: -1 }, { ...prior, priority: 1.5 },
      { ...prior, stops: prior.stops.map(stop => ({ ...stop, maxWaitSeconds: -1 })) },
      { ...prior, stops: [{ ...prior.stops[0], targetId: 'missing-station' }, prior.stops[1]] }];
    for (const edit of invalid) {
      expect(session.upsertService(edit as ServiceDefinition).ok).toBe(false);
      expect(session.snapshot()).toEqual(before);
      expect(session.presentationRoutes()).toEqual(routesBefore);
    }
    expect(session.upsertService({ ...clonePlainData(prior), stops: [...prior.stops].reverse() }).ok).toBe(true);
    const reset = session.snapshot().management.serviceStates['valley-local'];
    expect(reset).toMatchObject({ nextStopIndex: 0, phase: 'travelling', calls: 0, completedCycles: 0, distanceWorldUnits: 0, delaySeconds: 0 });
    expect(session.presentationRoutes()['brookford-passenger']).toBeUndefined();
    expect(session.getTrainSnapshots().find(train => train.trainId === 'brookford-passenger')!.speedMps).toBe(0);
  });
});
