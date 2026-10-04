import { SimulationSession } from '../../src/simulation/SimulationSession';
import { RailGraph } from '../../src/simulation/RailGraph';
import { createRehearsal, runRehearsal } from '../../src/simulation/Rehearsal';
import type { ServiceDefinition, ManagedWorld } from '../../src/simulation/SimulationTypes';
import { createCompanyState, validateCompanyState } from '../../src/economy/FinanceLedger';
import { createRegionState, acceptProject, applyRegionEvent } from '../../src/region/RegionalProjects';
import { getFacilityDefinition } from '../../src/economy/ProductCatalog';
import { consistSpecification } from '../../src/region/VehicleRoster';
import { clonePlainData } from '../../src/utils/PlainData';
import { makeFirstFreightRouteWorld, makeFreightTrainDef } from '../fixtures/FirstFreightRouteFixture';
import { validateWorldData } from '../../src/config/WorldData';
import { fitPassingLoop } from '../../src/management/RailwayTemplates';

const freightService = (overrides: Partial<ServiceDefinition> = {}): ServiceDefinition => ({
  id: 'forest-service', name: 'Timber shuttle', trainId: 'train-1', kind: 'freight',
  stops: [
    { targetId: 'managed-forest', targetKind: 'facility', loadRule: 'full', maxWaitSeconds: 60 },
    { targetId: 'sawmill', targetKind: 'facility', loadRule: 'unload', maxWaitSeconds: 60 },
  ], frequencySeconds: 0, departureOffsetSeconds: 0, priority: 50, enabled: true, ...overrides,
});

const makeWorld = (): ManagedWorld => {
  const world = makeFirstFreightRouteWorld();
  world.company = createCompanyState(1_000_000);
  const forest = world.economy.facilities.find((facility) => facility.id === 'managed-forest');
  const sawmill = world.economy.facilities.find((facility) => facility.id === 'sawmill');
  forest.inventories.logs.quantity = 120;
  sawmill.inventories.logs.quantity = 0;
  return world;
};

const advanceSeconds = (session: SimulationSession, seconds: number): void => {
  for (let index = 0; index < seconds * 4; index += 1) session.advance(250);
};

describe('renderer-independent autonomous railway', () => {
  it('preserves the loaded destination, dwell and statistics when a service is paused and resumed', () => {
    const session=new SimulationSession(makeWorld());session.upsertService(freightService());
    let ready=false;
    for(let i=0;i<160;i++){
      session.advance(250);const world=session.snapshot(),state=world.management.serviceStates['forest-service'];
      if(state.phase==='travelling'&&state.nextStopIndex===1&&world.trains[0].cargo?.units>0&&world.trains[0].dynamics.mode==='on-rail'&&world.trains[0].dynamics.speedMps>0){ready=true;break;}
    }
    expect(ready).toBe(true);const before=session.snapshot(),progress=before.management.serviceStates['forest-service'];
    expect(session.upsertService(freightService({enabled:false})).ok).toBe(true);advanceSeconds(session,10);
    const paused=session.snapshot(),state=paused.management.serviceStates['forest-service'];
    for(const field of ['nextStopIndex','phase','calls','completedCycles','dwellSeconds','nextDepartureSeconds','distanceWorldUnits'] as const)expect(state[field]).toEqual(progress[field]);
    expect(paused.trains[0].cargo).toEqual(before.trains[0].cargo);expect(paused.trains[0].trackT).toBe(before.trains[0].trackT);
    expect(paused.trains[0].operations.lifetimeRunningCost).toBe(before.trains[0].operations.lifetimeRunningCost);
    expect(session.upsertService(freightService()).ok).toBe(true);
    expect(session.snapshot().management.serviceStates['forest-service'].nextStopIndex).toBe(1);
    advanceSeconds(session,50);
    expect(session.snapshot().trains[0].operations.lifetimeDeliveredUnits).toBeGreaterThan(0);
    expect(session.snapshot().management.serviceStates['forest-service'].calls).toBeGreaterThan(progress.calls);
  });

  it('resolves fixed access locations once per graph and revalidates after a world replacement', () => {
    const session=new SimulationSession(makeWorld());const resolution=jest.spyOn(session.railGraph,'facilityLocation');
    session.upsertService(freightService());expect(resolution).toHaveBeenCalledTimes(2);advanceSeconds(session,10);
    expect(resolution).toHaveBeenCalledTimes(2);
    const replacement=clonePlainData(session.snapshot());replacement.revision++;replacement.operationsRevision++;
    replacement.economy.facilities[0].railAccess.y+=10000;session.replaceWorld(replacement);
    const changed=session.upsertService(freightService());expect(changed.ok).toBe(false);expect(changed.errors.join(' ')).toMatch(/Connect/);
  });

  it('stores reserved JavaScript keys as own service state without changing object prototypes', () => {
    const prototypeBefore=Object.getOwnPropertyNames(Object.prototype);
    const session=new SimulationSession(makeWorld());
    expect(session.upsertService(freightService({id:'__proto__'})).ok).toBe(true);
    advanceSeconds(session,3);
    const snapshot=session.snapshot();
    expect(Object.prototype.hasOwnProperty.call(snapshot.management.serviceStates,'__proto__')).toBe(true);
    expect(snapshot.management.serviceStates['__proto__'].calls).toBeGreaterThan(0);
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(prototypeBefore);
    expect((Object.prototype as any).phase).toBeUndefined();
  });

  it.each(['__proto__', 'constructor'])('routes and charges an imported train ID %s like an ordinary train', (trainId) => {
    const world = makeWorld();
    world.trains[0].id = trainId;
    const imported = new SimulationSession(world);
    const ordinary = new SimulationSession(makeWorld());
    expect(imported.upsertService(freightService({ trainId })).ok).toBe(true);
    ordinary.upsertService(freightService());
    advanceSeconds(imported, 10); advanceSeconds(ordinary, 10);

    const routes = imported.presentationRoutes();
    expect(Object.getPrototypeOf(routes)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(routes, trainId)).toBe(true);
    expect(routes[trainId].length).toBeGreaterThan(0);
    expect(imported.getTrainSnapshots()[0]).toEqual({ ...ordinary.getTrainSnapshots()[0], trainId });
    const current = imported.snapshot(), reference = ordinary.snapshot();
    expect(current.trains[0].operations.lifetimeRunningCost).toBeGreaterThan(0);
    expect(current.trains[0].operations).toEqual(reference.trains[0].operations);
    expect(current.company.cash).toBe(reference.company.cash);
  });

  it('loads, drives, delivers profitably and reverses without input; goods and cash remain conserved', () => {
    const source = makeWorld();
    const untouched = clonePlainData(source);
    const session = new SimulationSession(source);
    expect(session.upsertService(freightService())).toEqual({ ok: true, errors: [] });
    advanceSeconds(session, 75);
    const snapshot = session.snapshot();
    const state = snapshot.management.serviceStates['forest-service'];
    expect(state.calls).toBeGreaterThanOrEqual(3);
    expect(state.completedCycles).toBeGreaterThanOrEqual(1);
    expect(snapshot.trains[0].operations.lifetimeDeliveredUnits).toBeGreaterThan(0);
    const inventoryUnits = snapshot.economy.facilities.reduce((sum, facility) => sum + (facility.inventories.logs?.quantity ?? 0), 0);
    const forest = snapshot.economy.facilities.find((facility) => facility.id === 'managed-forest');
    const sawmill = snapshot.economy.facilities.find((facility) => facility.id === 'sawmill');
    expect(inventoryUnits + (snapshot.trains[0].cargo?.units ?? 0) + sawmill.inventories.logs.recentOutflow)
      .toBe(120 + forest.inventories.logs.recentInflow);
    expect(validateCompanyState(snapshot.company)).toEqual({ valid: true });
    expect(snapshot.company.cash).toBe(snapshot.company.ledger.reduce((sum, entry) => sum + entry.amount, 0));
    expect(snapshot.company.ledger.some((entry) => entry.category === 'delivery-revenue')).toBe(true);
    expect(snapshot.company.ledger.some((entry) => entry.category === 'train-running-cost')).toBe(true);
    expect(source).toEqual(untouched);
    expect(Object.isFrozen(snapshot.management.services)).toBe(true);
    expect(validateWorldData(snapshot).compatible).toBe(true);
  });

  it('does not move opposing trains into an occupied single-track block', () => {
    const world = makeWorld();
    const other = makeFreightTrainDef({ id: 'train-2', facing: -1, trackT: 1 });
    if (other.dynamics.mode === 'on-rail') other.dynamics.distance = 1000;
    world.trains.push(other);
    const session = new SimulationSession(world);
    session.upsertService(freightService());
    session.upsertService(freightService({ id: 'return-service', name: 'Opposing freight', trainId: 'train-2', stops: [...freightService().stops].reverse() }));
    advanceSeconds(session, 30);
    const snapshot = session.snapshot();
    expect(snapshot.trains.map((train) => train.trackT)).toEqual([0, 1]);
    expect(snapshot.management.serviceStates['forest-service'].stoppedReason.code).toBe('track-occupied');
    expect(snapshot.management.serviceStates['return-service'].stoppedReason.code).toBe('track-occupied');
    expect(snapshot.management.serviceStates['forest-service'].stoppedReason.remedy).toMatch(/passing loop/);
  });

  it('reserves a shared corridor deterministically by priority and exposes the waiting train', () => {
    const world = makeWorld();
    const central = world.tracks[0];
    const left = clonePlainData(central);
    left.uuid = 'left-depot';
    for (const key of ['p0', 'p1', 'p2', 'p3'] as const) left[key].x -= 1000;
    const right = clonePlainData(central);
    right.uuid = 'right-depot';
    for (const key of ['p0', 'p1', 'p2', 'p3'] as const) right[key].x += 1000;
    world.tracks.push(left, right);
    world.trains[0].trackUUID = left.uuid;
    if (world.trains[0].dynamics.mode === 'on-rail') {
      world.trains[0].dynamics.trackUUID = left.uuid;
      world.trains[0].dynamics.distance = 500;
    }
    const other = makeFreightTrainDef({ id: 'train-2', trackUUID: right.uuid, trackT: 0.5, facing: -1 });
    if (other.dynamics.mode === 'on-rail') other.dynamics.distance = 500;
    world.trains.push(other);
    const session = new SimulationSession(world);
    session.upsertService(freightService({ priority: 100 }));
    session.upsertService(freightService({ id: 'other-service', trainId: 'train-2', priority: 1 }));
    advanceSeconds(session, 8);
    expect(session.snapshot().management.serviceStates['other-service'].stoppedReason?.code).toBe('track-occupied');
    expect(session.snapshot().trains[0].trackUUID).not.toBe('right-depot');
  });

  it('respects no-transfer rules rather than loading near every industry it passes', () => {
    const session = new SimulationSession(makeWorld());
    session.upsertService(freightService({ stops: freightService().stops.map((stop) => ({ ...stop, loadRule: 'none' })) }));
    advanceSeconds(session, 40);
    expect(session.snapshot().trains[0].cargo).toBeNull();
    const forest = session.snapshot().economy.facilities.find((facility) => facility.id === 'managed-forest');
    expect(forest.inventories.logs.quantity).toBe(120 + forest.inventories.logs.recentInflow);
  });

  it('keeps a paused railway and its economy unchanged and supports all clock speeds', () => {
    const session = new SimulationSession(makeWorld());
    session.setSpeed(0);
    const paused = session.snapshot();
    session.advance(1000);
    expect(session.snapshot()).toEqual(paused);
    session.setSpeed(4);
    session.advance(1000);
    expect(session.snapshot().management.clockSeconds).toBe(4);
    expect(session.snapshot().economy.tick).toBe(4);
    expect(() => session.setSpeed(3 as any)).toThrow();
  });

  it('applies expert operating pressure and sandbox expense waiver through the same rules', () => {
    const expert = makeWorld(); expert.generationConfig.gameDifficulty = 'expert';
    const expertSession = new SimulationSession(expert);
    expertSession.upsertService(freightService());
    advanceSeconds(expertSession, 25);
    expect(expertSession.snapshot().company.ledger.some((entry) => entry.category === 'train-running-cost' && entry.amount === -25)).toBe(true);
    const sandbox = makeWorld(); sandbox.generationConfig.gameDifficulty = 'sandbox';
    const sandboxSession = new SimulationSession(sandbox);
    sandboxSession.upsertService(freightService());
    advanceSeconds(sandboxSession, 25);
    expect(sandboxSession.snapshot().company.ledger.some((entry) => entry.category === 'train-running-cost')).toBe(false);
    expect(sandboxSession.snapshot().management.serviceStates['forest-service'].distanceWorldUnits).toBeGreaterThan(500);
  });

  it('completes a regional recycling project from an authoritative consignment and awards its grant once', () => {
    const world = makeWorld();
    world.economy.facilities = ['recycling-works', 'prefabrication-plant'].map((id, index) => {
      const definition = getFacilityDefinition(id);
      const x = index === 0 ? -500 : 500;
      return { id, definitionId: id, name: definition.displayName, x, y: 0, railAccess: { x, y: 0, radius: 32.5 },
        inventories: Object.fromEntries(definition.inventory.map((slot) => [slot.productId, { productId: slot.productId,
          quantity: slot.productId === 'steel' && index === 0 ? 100 : 0, reservedQuantity: 0,
          capacity: slot.capacity, recentInflow: 0, recentOutflow: 0, targetStock: slot.targetStock }])),
        activeRecipeId: definition.recipeIds[0] ?? null, recipeProgressTicks: 0 };
    });
    world.region = acceptProject(createRegionState(world), 'recycling');
    world.region = applyRegionEvent(world.region, { id: 'earlier-scrap', kind: 'freight-delivery', tick: 0,
      productId: 'scrap', units: 60, destinationFacilityId: 'recycling-works' }).state;
    const session = new SimulationSession(world);
    expect(session.upsertService(freightService({ stops: [
      { targetId: 'recycling-works', targetKind: 'facility', loadRule: 'full', maxWaitSeconds: 60 },
      { targetId: 'prefabrication-plant', targetKind: 'facility', loadRule: 'unload', maxWaitSeconds: 60 },
    ] })).ok).toBe(true);
    advanceSeconds(session, 75);
    const result = session.snapshot();
    expect(result.region.projects.find((project) => project.definitionId === 'recycling').completedAtTick).not.toBeNull();
    expect(result.company.ledger.filter((entry) => entry.referenceId === 'project:recycling')).toHaveLength(1);
    expect(result.region.productionBonusBpsByDefinition['recycling-works']).toBe(3000);
    expect(validateWorldData(result).compatible).toBe(true);
    const restored = new SimulationSession(result);
    advanceSeconds(restored, 25);
    expect(restored.snapshot().company.ledger.filter((entry) => entry.referenceId === 'project:recycling')).toHaveLength(1);
  });

  it('uses the same loaded mass and complete length as the fleet presentation', () => {
    const train = makeFreightTrainDef({ vehicleFamilyId: 'mixed-diesel', cargo: {
      productId: 'logs', units: 10, loadedUnits: 10, originFacilityId: 'managed-forest',
    } });
    const empty = consistSpecification({ ...train, cargo: null });
    const loaded = consistSpecification(train);
    expect(loaded.totalLengthMetres).toBeCloseTo(39.8);
    expect(loaded.massKg).toBeGreaterThan(empty.massKg);
    expect(loaded.wagonFamilyId).toBe('flatbed');
    expect(loaded.passengerCapacity).toBe(0);
  });

  it('stops unaffordable services before giving them free movement', () => {
    const world = makeWorld();
    world.company = createCompanyState(10);
    const session = new SimulationSession(world);
    session.upsertService(freightService());
    advanceSeconds(session, 10);
    expect(session.snapshot().trains[0].trackT).toBe(0);
    expect(session.snapshot().management.serviceStates['forest-service'].stoppedReason.code).toBe('insufficient-cash');
  });

  it('parks unassigned trains and treats them as occupied infrastructure', () => {
    const world = makeWorld();
    const other = makeFreightTrainDef({ id: 'parked-train', trackT: 0.7 });
    if (other.dynamics.mode === 'on-rail') { other.dynamics.distance = 700; other.dynamics.speedMps = 12; }
    world.trains.push(other);
    const session = new SimulationSession(world);
    session.upsertService(freightService());
    advanceSeconds(session, 20);
    const snapshot = session.snapshot();
    expect(snapshot.trains.find((train) => train.id === 'parked-train').dynamics).toEqual(expect.objectContaining({ distance: 700, speedMps: 0 }));
    expect(snapshot.management.serviceStates['forest-service'].stoppedReason).toEqual(expect.objectContaining({ code: 'track-occupied', relatedEntityId: 'parked-train' }));
    expect(validateWorldData(snapshot).compatible).toBe(true);
  });

  it('uses an available passing loop instead of waiting behind an occupied main line', () => {
    const world = makeWorld();
    const fitted = fitPassingLoop({ start: { x: 0, y: 0 }, end: { x: 5000, y: 0 }, idPrefix: 'test-loop' });
    if (!fitted.ok) throw new Error('The passing-loop fixture must fit.');
    world.tracks = fitted.template.tracks.map((track) => ({ ...track,
      verticalProfile: { profileVersion: 1 as const, knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }] },
      structures: [{ type: 'surface' as const, startT: 0, endT: 1, startElevation: 0, endElevation: 0 }], paidBuildCost: 0 }));
    world.junctions = fitted.template.junctions;
    world.economy.facilities.forEach((facility) => {
      const x = facility.id === 'managed-forest' ? 0 : 5000;
      facility.x = x; facility.y = 0; facility.railAccess = { x, y: 0, radius: 32.5 };
    });
    world.trains[0].trackUUID = world.tracks[0].uuid;
    if (world.trains[0].dynamics.mode === 'on-rail') world.trains[0].dynamics.trackUUID = world.tracks[0].uuid;
    const parked = makeFreightTrainDef({ id: 'parked-main', trackUUID: fitted.template.mainTrackId, trackT: 0.5 });
    if (parked.dynamics.mode === 'on-rail') parked.dynamics.distance = 1750;
    world.trains.push(parked);
    const session = new SimulationSession(world);
    session.upsertService(freightService());
    let visitedLoop = false;
    for (let index = 0; index < 440; index += 1) {
      session.advance(250);
      const train = session.getTrainSnapshots().find((candidate) => candidate.trainId === 'train-1');
      if (fitted.template.loopTrackIds.includes(train.trackUUID)) visitedLoop = true;
      expect(train.trackUUID).not.toBe(fitted.template.mainTrackId);
    }
    expect(visitedLoop).toBe(true);
    expect(session.snapshot().trains[0].operations.lifetimeDeliveredUnits).toBeGreaterThan(0);
    expect(session.snapshot().trains[1].dynamics).toEqual(expect.objectContaining({ distance: 1750, speedMps: 0 }));
    expect(validateWorldData(session.snapshot()).compatible).toBe(true);
  });

  it('moves destination cohorts, posts fare revenue exactly once and applies real vehicle capacity', () => {
    const world = makeWorld();
    world.trains[0].vehicleFamilyId = 'regional-dmu';
    world.stations.push({ id: 'station-a', name: 'West', trackUUID: world.tracks[0].uuid, trackT: 0, passengerSpawnRate: 600, platformLengthMetres: 100 },
      { id: 'station-b', name: 'East', trackUUID: world.tracks[0].uuid, trackT: 1, passengerSpawnRate: 600, platformLengthMetres: 100 });
    const session = new SimulationSession(world);
    const service = freightService({ kind: 'passenger', stops: world.stations.map((station) => ({ targetId: station.id,
      targetKind: 'station', loadRule: 'available', maxWaitSeconds: 8 })) });
    expect(session.upsertService(service).ok).toBe(true);
    advanceSeconds(session, 90);
    const snapshot = session.snapshot();
    expect(snapshot.management.passengers.arrived).toBeGreaterThan(0);
    expect(snapshot.company.ledger.filter((entry) => entry.category === 'delivery-revenue').reduce((sum, entry) => sum + entry.amount, 0))
      .toBe(snapshot.management.passengers.revenue);
    expect(snapshot.management.passengers.cohorts.filter((cohort) => cohort.trainId === 'train-1').reduce((sum, cohort) => sum + cohort.count, 0)).toBeLessThanOrEqual(120);
    expect(snapshot.company.ledger.some((entry) => entry.category === 'train-running-cost' && entry.amount === -13)).toBe(true);
  });

  it('explains unsuitable electric routes and undersized passenger platforms', () => {
    const electric = makeWorld();
    electric.trains[0].vehicleFamilyId = 'electric-freight';
    const electricSession = new SimulationSession(electric);
    electricSession.upsertService(freightService());
    advanceSeconds(electricSession, 20);
    expect(electricSession.snapshot().management.serviceStates['forest-service'].stoppedReason.message).toMatch(/wires/);
    const passenger = makeWorld();
    passenger.trains[0].vehicleFamilyId = 'regional-dmu';
    passenger.stations = [{ id: 'tiny', name: 'Tiny', trackUUID: passenger.tracks[0].uuid, trackT: 0, passengerSpawnRate: 6, platformLengthMetres: 20 },
      { id: 'large', name: 'Large', trackUUID: passenger.tracks[0].uuid, trackT: 1, passengerSpawnRate: 6, platformLengthMetres: 120 }];
    const passengerSession = new SimulationSession(passenger);
    passengerSession.upsertService(freightService({ kind: 'passenger', stops: passenger.stations.map((station) => ({ targetId: station.id,
      targetKind: 'station', loadRule: 'available', maxWaitSeconds: 8 })) }));
    advanceSeconds(passengerSession, 2);
    expect(passengerSession.snapshot().management.serviceStates['forest-service'].stoppedReason.code).toBe('platform-too-short');
    expect(passengerSession.snapshot().management.passengers.arrived).toBe(0);
  });

  it('persists service progress and rejects stale construction replacements', () => {
    const session = new SimulationSession(makeWorld());
    session.upsertService(freightService());
    advanceSeconds(session, 15);
    const snapshot = session.snapshot();
    const restored = new SimulationSession(snapshot);
    expect(restored.snapshot().management).toEqual(snapshot.management);
    const stale = makeWorld(); stale.id = snapshot.id;
    expect(() => session.replaceWorld(stale)).toThrow(/older world revision/);
    advanceSeconds(session, 25);
    advanceSeconds(restored, 25);
    expect(restored.snapshot()).toEqual(session.snapshot());
  });
});

describe('pure graph and detached rehearsal', () => {
  it('carries turnout reservations through coincident ports and forbids branch shortcuts', () => {
    const world = makeWorld();
    const branch = clonePlainData(world.tracks[0]);
    branch.uuid = 'left';
    branch.p0 = { x: 500, y: 0 }; branch.p1 = { x: 700, y: 20 }; branch.p2 = { x: 850, y: 100 }; branch.p3 = { x: 1000, y: 100 };
    const right = clonePlainData(branch); right.uuid = 'right';
    for (const key of ['p0', 'p1', 'p2', 'p3'] as const) right[key].y *= -1;
    const graph = new RailGraph([...world.tracks, branch, right], [{ uuid: 'turnout', mainTrackUUID: world.tracks[0].uuid,
      leftTrackUUID: 'left', rightTrackUUID: 'right', position: 1, branchState: 'left' }]);
    const selected = graph.shortestRoute({ trackUUID: world.tracks[0].uuid, distance: 0 }, { trackUUID: 'left', distance: 100 });
    expect(selected.junctionIds).toEqual(['turnout']);
    expect(selected.legs.map((leg) => leg.trackUUID)).toEqual([world.tracks[0].uuid, 'left']);
    expect(graph.shortestRoute({ trackUUID: 'left', distance: 100 }, { trackUUID: 'right', distance: 100 })).toBeNull();
    expect(graph.shortestRoute({ trackUUID: world.tracks[0].uuid, distance: 500 }, { trackUUID: world.tracks[0].uuid, distance: 100 }, 1)).toBeNull();
  });
  it('routes across reversed track ports and ignores visual crossings without a connection', () => {
    const world = makeWorld();
    const branch = clonePlainData(world.tracks[0]);
    branch.uuid = 'reversed-branch';
    branch.p0 = { x: 1500, y: 0 }; branch.p1 = { x: 1167, y: 0 }; branch.p2 = { x: 833, y: 0 }; branch.p3 = { x: 500, y: 0 };
    const graph = new RailGraph([...world.tracks, branch]);
    const route = graph.shortestRoute({ trackUUID: world.tracks[0].uuid, distance: 0 }, { trackUUID: branch.uuid, distance: 0 });
    expect(route.length).toBeCloseTo(2000, 4);
    expect(route.legs.map((leg) => leg.direction)).toEqual([1, -1]);
    const isolated = clonePlainData(branch);
    isolated.uuid = 'crossing';
    isolated.p0 = { x: 0, y: -500 }; isolated.p1 = { x: 0, y: -167 }; isolated.p2 = { x: 0, y: 167 }; isolated.p3 = { x: 0, y: 500 };
    const disconnected = new RailGraph([...world.tracks, isolated]);
    expect(disconnected.shortestRoute({ trackUUID: world.tracks[0].uuid, distance: 0 }, { trackUUID: isolated.uuid, distance: 0 })).toBeNull();
  });

  it('uses the live rules for ghost movement, economy and throughput without mutating live state', () => {
    const configured = new SimulationSession(makeWorld());
    configured.upsertService(freightService());
    const source = configured.snapshot();
    const before = clonePlainData(source);
    const result = runRehearsal({ requestId: 'parity', world: source, horizonSeconds: 120, sampleIntervalSeconds: 1 });
    expect(result.status).toBe('complete');
    expect(result.engineering.completedCycles).toBeGreaterThanOrEqual(1);
    expect(result.engineering.deliveredUnits).toBeGreaterThan(0);
    expect(result.samples[result.samples.length - 1].trains[0].trackT).toBe(0);
    const live = new SimulationSession(source);
    advanceSeconds(live, result.elapsedSeconds);
    expect(result.samples[result.samples.length - 1].trains).toEqual(live.getTrainSnapshots());
    const entries = live.snapshot().company.ledger.slice(source.company.ledger.length);
    expect(result.engineering.runningCosts).toBe(entries.filter((entry) => entry.category === 'train-running-cost').reduce((sum, entry) => sum - entry.amount, 0));
    expect(source).toEqual(before);
    expect(configured.snapshot()).toEqual(source);
    expect(result.forecast.assumptions).toEqual(expect.arrayContaining([expect.stringContaining('uncertainty')]));
  });

  it('supports cancellation and rejects stale blueprints and occupied-track demolition', () => {
    const world = makeWorld();
    const rehearsal = createRehearsal({ requestId: 'cancel', world, horizonSeconds: 60 });
    rehearsal.step(1); rehearsal.cancel();
    expect(rehearsal.step()).toBe(true);
    expect(rehearsal.result().status).toBe('cancelled');
    const draft = { blueprintVersion: 1 as const, id: 'draft', name: 'Draft', sourceWorldId: world.id, sourceRevision: -1,
      tracks: [], junctions: [], stations: [], trains: [], services: [], removedTrackIds: [world.tracks[0].uuid], constructionCost: 0 };
    const invalid = runRehearsal({ requestId: 'stale', world, draft });
    expect(invalid.status).toBe('invalid');
    expect(invalid.errors.join(' ')).toMatch(/stale/);
    expect(invalid.errors.join(' ')).toMatch(/occupied track/);
  });
});
