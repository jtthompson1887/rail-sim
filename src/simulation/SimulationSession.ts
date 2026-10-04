import type { TrainDef } from '../config/WorldData';
import { LOCOMOTIVE_PHYSICS } from '../config/VehicleTypes';
import { proposeCargoTick, type CargoTransferStatus } from '../freight/CargoSystem';
import { capacityForProduct, getFreightSet } from '../freight/FreightSetCatalog';
import { proposeRunningCosts } from '../freight/RunningCostSystem';
import type { TrainRuntimeSnapshot } from '../freight/TrainRuntime';
import { advanceFacilityRecipe } from '../economy/IndustrySystem';
import { advanceMarketTick } from '../economy/MarketSystem';
import { getProduct, getRecipe } from '../economy/ProductCatalog';
import { postLedgerEntry } from '../economy/FinanceLedger';
import { ConsistDynamicsSolver } from '../physics/ConsistDynamicsSolver';
import { createDerailmentHazardState } from '../physics/DerailmentEvaluator';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';
import { generatePassengerDemand, arrivePassengers, boardPassengers, unloadPassengers } from '../region/PassengerSystem';
import { advanceRegionalEconomy } from '../region/RegionalEconomy';
import { applyRegionEvent, type RegionEvent } from '../region/RegionalProjects';
import { getPoweredVehicleFamily, availableTractiveEffortN, physicsForVehicleFamily, vehicleFamilyRouteBlocker, consistSpecification } from '../region/VehicleRoster';
import { getGameDifficulty } from '../region/GamePresets';
import { clonePlainData, equalPlainData } from '../utils/PlainData';
import { RailGraph, type RailLocation, type RailRoute } from './RailGraph';
import {
  createManagementState, createServiceRuntimeState,
  type ManagedWorld, type ServiceDefinition, type ServiceRuntimeState, type ServiceStop,
  type SimulationAdvanceResult, type SimulationEvent, type SimulationSpeed,
  type SimulationTrainSnapshot, type StoppedReason,
} from './SimulationTypes';

export const SIMULATION_STEP_SECONDS = 1 / 20;
const WORLD_UNITS_PER_METRE = TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre;
const ARRIVAL_EPSILON = 0.01;
type Journey = { route: RailRoute; legIndex: number; remainingDistance: number };

export function freezeSimulationData<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(freezeSimulationData);
    Object.freeze(value);
  }
  return value;
}

/** Owns every authoritative operation; snapshots never alias a caller's world. */
export class SimulationSession {
  private world: ManagedWorld;
  private graph: RailGraph;
  private accumulatorSeconds = 0;
  private economyRemainderSeconds = 0;
  private readonly journeys = new Map<string, Journey>();
  private readonly reservations = new Map<string, string>();
  private readonly externalRuntime = new Map<string, TrainRuntimeSnapshot>();
  private readonly stopLocations = new Map<string, RailLocation | null>();
  private readonly dynamics = new ConsistDynamicsSolver();
  private events: SimulationEvent[] = [];
  private changedSinceAdvance = false;

  constructor(world: ManagedWorld) {
    this.world = clonePlainData(world);
    this.world.management = this.world.management ?? createManagementState();
    this.graph = new RailGraph(this.world.tracks, this.world.junctions);
    this.economyRemainderSeconds = this.world.management.clockSeconds % 1;
    this.normalizeRuntime();
  }

  snapshot(): ManagedWorld { return freezeSimulationData(clonePlainData(this.world)); }
  get clockSeconds(): number { return this.world.management.clockSeconds; }
  rehearsalProgress(): readonly { serviceId: string; completedCycles: number; stoppedReason: StoppedReason | null }[] {
    return freezeSimulationData(this.world.management.services.map(service => {
      const state=this.world.management.serviceStates[service.id];
      return { serviceId:service.id,completedCycles:state.completedCycles,stoppedReason:clonePlainData(state.stoppedReason) };
    }));
  }
  get railGraph(): RailGraph { return this.graph; }
  get controlledTrainIds(): ReadonlySet<string> {
    return new Set(this.world.management.services.map((service) => service.trainId));
  }

  /** Presentation follows the selected detour, including a leading car before its centre crosses a turnout. */
  presentationRoutes(): Readonly<Record<string, readonly string[]>> {
    const routes: Record<string, readonly string[]> = Object.create(null);
    for (const service of this.world.management.services) {
      const journey = this.journeys.get(service.id);
      if (journey) routes[service.trainId] = journey.route.legs.map((leg) => leg.trackUUID);
    }
    return freezeSimulationData(routes);
  }

  setSpeed(speed: SimulationSpeed): void {
    if (![0, 1, 2, 4].includes(speed)) throw new RangeError('Simulation speed must be 0, 1, 2 or 4.');
    if (this.world.management.speed === speed) return;
    this.world.management.speed = speed;
    this.touchRevision();
  }

  upsertService(service: ServiceDefinition): { ok: boolean; errors: string[] } {
    const errors = validateServiceDefinition(service);
    if (!this.world.trains.some((train) => train.id === service.trainId)) errors.push('Choose a train that exists in this world.');
    if (this.world.management.services.some((existing) => existing.id !== service.id && existing.trainId === service.trainId)) {
      errors.push('This train already belongs to another service.');
    }
    for (const stop of service.stops ?? []) {
      if (!this.stopLocation(stop)) errors.push(`Connect ${stop.targetId} to the railway before starting this service.`);
    }
    const assignedTrain = this.world.trains.find((train) => train.id === service.trainId);
    const family = assignedTrain?.vehicleFamilyId && getPoweredVehicleFamily(assignedTrain.vehicleFamilyId);
    if (service.kind === 'passenger' && family && family.passengerCapacity <= 0) errors.push('Choose a passenger unit for this service.');
    if (errors.length) return { ok: false, errors: [...new Set(errors)] };
    const prior = this.world.management.services.find((candidate) => candidate.id === service.id);
    if (prior && equalPlainData({ ...prior, enabled: true }, { ...service, enabled: true })) {
      if (prior.enabled === service.enabled) return { ok: true, errors: [] };
      prior.enabled = service.enabled;
      this.releaseJourney(service.id); this.stopTrain(service.trainId);
      const state=this.world.management.serviceStates[service.id];
      if (!service.enabled) state.stoppedReason=this.reason('disabled','This service is paused.','Resume this service when ready.');
      else if(state.stoppedReason?.code==='disabled')state.stoppedReason=null;
      this.touchRevision();
      return {ok:true,errors:[]};
    }
    if (prior && prior.trainId !== service.trainId) this.stopTrain(prior.trainId);
    this.releaseJourney(service.id);
    this.world.management.services = this.world.management.services.filter((candidate) => candidate.id !== service.id);
    this.world.management.services.push(clonePlainData(service));
    this.world.management.services.sort((a, b) => a.id.localeCompare(b.id));
    Object.defineProperty(this.world.management.serviceStates, service.id, { enumerable: true, configurable: true, writable: true, value: {
      ...createServiceRuntimeState(), nextDepartureSeconds: this.nextScheduledDeparture(service, this.world.management.clockSeconds),
    } });
    this.stopTrain(service.trainId);
    this.touchRevision();
    return { ok: true, errors: [] };
  }

  removeService(serviceId: string): boolean {
    const service = this.world.management.services.find((candidate) => candidate.id === serviceId);
    if (!service) return false;
    const train = this.world.trains.find((candidate) => candidate.id === service.trainId);
    const station = service.stops.find((stop) => stop.targetKind === 'station');
    if (station) this.world.management.passengers = unloadPassengers(this.world.management.passengers, service.trainId, station.targetId);
    if (train) this.stopTrain(train.id);
    this.world.management.services = this.world.management.services.filter((candidate) => candidate.id !== serviceId);
    delete this.world.management.serviceStates[serviceId];
    this.releaseJourney(serviceId);
    this.touchRevision();
    return true;
  }

  /** Install accepted construction or finance commands; discard stale routes immediately. */
  replaceWorld(world: ManagedWorld): void {
    if (world.id !== this.world.id) throw new Error('A session cannot change world identity.');
    if (world.revision < this.world.revision) throw new Error('Cannot replace a session with an older world revision.');
    this.world = clonePlainData(world);
    this.world.management = this.world.management ?? createManagementState();
    this.graph = new RailGraph(this.world.tracks, this.world.junctions);
    this.stopLocations.clear();
    this.journeys.clear(); this.reservations.clear();
    this.economyRemainderSeconds = this.world.management.clockSeconds % 1;
    this.accumulatorSeconds = 0;
    this.normalizeRuntime();
  }

  setExternalRuntime(runtime: readonly TrainRuntimeSnapshot[]): void {
    this.externalRuntime.clear();
    const controlled = this.controlledTrainIds;
    for (const frame of runtime) {
      if (controlled.has(frame.trainId)) continue;
      const frozenFrame = clonePlainData(frame);
      // Regional play parks unassigned trains. Legacy driving uses its existing runtime path.
      (frozenFrame as { speedWorldUnitsPerSecond: number }).speedWorldUnitsPerSecond = 0;
      (frozenFrame as { throttle: number }).throttle = 0;
      if (frozenFrame.dynamics?.mode === 'on-rail') frozenFrame.dynamics.speedMps = 0;
      this.externalRuntime.set(frame.trainId, frozenFrame);
    }
  }

  /** Elapsed real time is bounded; sleeping or backgrounding never earns offline progress. */
  advance(deltaMs: number): SimulationAdvanceResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError('Elapsed time must be finite and non-negative.');
    const management = this.world.management;
    this.accumulatorSeconds += Math.min(deltaMs / 1000, 1) * management.speed;
    let steps = 0;
    while (this.accumulatorSeconds + 1e-9 >= SIMULATION_STEP_SECONDS) {
      this.fixedStep();
      this.accumulatorSeconds -= SIMULATION_STEP_SECONDS;
      steps += 1;
    }
    const changed = steps > 0 || this.changedSinceAdvance;
    this.changedSinceAdvance = false;
    return freezeSimulationData({ steps, changed, events: clonePlainData(this.events), trains: this.getTrainSnapshots() });
  }

  drainEvents(): readonly SimulationEvent[] {
    const events = freezeSimulationData(clonePlainData(this.events));
    this.events = [];
    return events;
  }

  getTrainSnapshots(): readonly SimulationTrainSnapshot[] {
    const serviceByTrain = new Map(this.world.management.services.map((service) => [service.trainId, service]));
    return freezeSimulationData(this.world.trains.map((train) => {
      const track = this.graph.trackByUUID(train.trackUUID);
      if (!track) return null;
      const distance = train.dynamics.mode === 'on-rail' ? train.dynamics.distance : track.index.distanceAtParameter(train.trackT);
      const pose = track.index.poseAtDistance(distance);
      const service = serviceByTrain.get(train.id);
      return { trainId: train.id, trackUUID: train.trackUUID, distance, trackT: train.trackT, facing: train.facing,
        speedMps: train.dynamics.mode === 'on-rail' ? train.dynamics.speedMps : 0,
        x: train.dynamics.mode === 'free-body' ? train.dynamics.x : pose.point.x,
        y: train.dynamics.mode === 'free-body' ? train.dynamics.y : pose.point.y,
        angleRad: train.dynamics.mode === 'free-body' ? train.dynamics.angleRad : Math.atan2(pose.tangent.y, pose.tangent.x) + (train.facing === -1 ? Math.PI : 0),
        derailed: train.dynamics.mode === 'free-body',
        serviceId: service?.id ?? null,
        stoppedReason: service ? clonePlainData(this.world.management.serviceStates[service.id]?.stoppedReason ?? null) : null };
    }).filter(Boolean));
  }

  private fixedStep(): void {
    const management = this.world.management;
    management.clockSeconds = Math.round((management.clockSeconds + SIMULATION_STEP_SECONDS) * 1e8) / 1e8;
    const ordered = [...management.services].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const service of ordered) this.advanceService(service, SIMULATION_STEP_SECONDS);
    this.economyRemainderSeconds += SIMULATION_STEP_SECONDS;
    if (this.economyRemainderSeconds + 1e-9 >= 1) {
      this.economyRemainderSeconds -= 1;
      this.tickEconomy();
    }
    this.touchRevision();
  }

  private advanceService(service: ServiceDefinition, dt: number): void {
    const state = this.world.management.serviceStates[service.id];
    const train = this.world.trains.find((candidate) => candidate.id === service.trainId);
    if (!train) { this.block(state, 'missing-train', 'The assigned train is unavailable.', 'Assign an existing train.'); return; }
    if (!service.enabled) {
      this.stopTrain(train.id); this.releaseJourney(service.id);
      state.stoppedReason = this.reason('disabled', 'This service is paused.', 'Resume this service when ready.'); return;
    }
    if (train.dynamics.mode !== 'on-rail') {
      this.block(state, 'derailed', 'The train is off the railway.', 'Recover the train onto connected track.', train.id); return;
    }
    const difficulty = getGameDifficulty(this.world.generationConfig.gameDifficulty ?? 'standard');
    const operatingRate = Math.ceil(((train.vehicleFamilyId && getPoweredVehicleFamily(train.vehicleFamilyId)?.runningCostPerTick)
      || getFreightSet(train.freightSetId)?.runningCostPerActiveTick || 20) * difficulty.runningCostMultiplier);
    if (state.phase !== 'dwelling' && this.world.company.cash < operatingRate) {
      this.stopTrain(train.id); this.releaseJourney(service.id);
      this.block(state, 'insufficient-cash', 'There is no cash to operate this service.', 'Pause expensive services or restructure the company.'); return;
    }
    const stop = service.stops[state.nextStopIndex];
    if (!stop) { this.block(state, 'route-disconnected', 'The service has no valid stop.', 'Edit its stops.'); return; }
    const target = this.stopLocation(stop);
    if (!target || !this.graph.trackByUUID(train.trackUUID)) {
      this.stopTrain(train.id); this.releaseJourney(service.id);
      this.block(state, 'route-disconnected', 'The next stop is disconnected from the railway.', 'Connect the missing track or choose another stop.', stop.targetId); return;
    }
    const currentFamily = train.vehicleFamilyId && getPoweredVehicleFamily(train.vehicleFamilyId);
    const currentStation = stop.targetKind === 'station' && this.world.stations.find((candidate) => candidate.id === stop.targetId);
    if (currentFamily && currentStation && currentFamily.lengthMetres > (currentStation.platformLengthMetres ?? 120)) {
      this.stopTrain(train.id); this.releaseJourney(service.id);
      this.block(state, 'platform-too-short', 'This train is longer than the next platform.', 'Extend the platform or choose a shorter passenger unit.', stop.targetId); return;
    }
    if (state.phase === 'dwelling') {
      state.dwellSeconds += dt;
      if (service.kind === 'passenger' && stop.targetKind === 'station') this.boardAtStation(service, stop);
      const ready = this.readyToLeave(service, state, train, stop);
      if (!ready) return;
      if (this.world.management.clockSeconds + 1e-8 < state.nextDepartureSeconds) {
        state.stoppedReason = this.reason('scheduled', `Departure in ${Math.ceil(state.nextDepartureSeconds - this.world.management.clockSeconds)} seconds.`, 'Adjust the service frequency or departure offset.'); return;
      }
      this.leaveStop(service, state);
      return;
    }
    if (state.phase === 'scheduled' && this.world.management.clockSeconds < state.nextDepartureSeconds) {
      this.stopTrain(train.id);
      state.stoppedReason = this.reason('scheduled', `Departure in ${Math.ceil(state.nextDepartureSeconds - this.world.management.clockSeconds)} seconds.`, 'Adjust the service frequency or departure offset.'); return;
    }
    const position = { trackUUID: train.trackUUID, distance: train.dynamics.distance };
    if (position.trackUUID === target.trackUUID && Math.abs(position.distance - target.distance) <= ARRIVAL_EPSILON) {
      this.arriveAtStop(service, state, train, stop); return;
    }
    let journey = this.journeys.get(service.id);
    if (!journey) {
      const initialDirection = train.dynamics.speedMps > 0.01 ? train.facing : undefined;
      let route = this.graph.shortestRoute(position, target, initialDirection);
      if (!route || !route.legs.length) {
        this.stopTrain(train.id);
        this.block(state, 'route-disconnected', 'There is no connected route to the next stop.', 'Build the missing connection or change the service stops.', stop.targetId); return;
      }
      const family = train.vehicleFamilyId && getPoweredVehicleFamily(train.vehicleFamilyId);
      if (family) {
        const station = stop.targetKind === 'station' && this.world.stations.find((candidate) => candidate.id === stop.targetId);
        let familyBlocker = vehicleFamilyRouteBlocker(family, {
          electrified: route.legs.every((leg) => this.graph.trackByUUID(leg.trackUUID)?.definition.electrified === true),
          shortestPlatformMetres: station ? station.platformLengthMetres ?? 120 : undefined,
          passengerService: service.kind === 'passenger',
        });
        if (familyBlocker && family.traction === 'electric' && familyBlocker.includes('wires')) {
          const wiredRoute = this.graph.shortestRoute(position, target, initialDirection,
            new Set(this.world.tracks.filter((track) => !track.electrified).map((track) => track.uuid)));
          if (wiredRoute) { route = wiredRoute; familyBlocker = null; }
        }
        if (familyBlocker) {
          this.stopTrain(train.id);
          this.block(state, familyBlocker.includes('platform') ? 'platform-too-short' : 'unsuitable-train', familyBlocker,
            family.traction === 'electric' ? 'Electrify every segment or assign a diesel train.' : 'Choose suitable rolling stock or extend the platform.', stop.targetId);
          return;
        }
      }
      let occupied = this.reserveRoute(service, route);
      if (occupied) {
        const unavailable = new Set<string>();
        for (const candidate of this.world.trains) {
          if (candidate.id === train.id || candidate.dynamics.mode !== 'on-rail') continue;
          this.graph.tracksOccupiedByBody({ trackUUID: candidate.trackUUID, distance: candidate.dynamics.distance },
            consistSpecification(candidate).totalLengthMetres * WORLD_UNITS_PER_METRE).forEach((trackId) => unavailable.add(trackId));
        }
        if (family?.traction === 'electric') this.world.tracks.filter((track) => !track.electrified).forEach((track) => unavailable.add(track.uuid));
        for (const [key, owner] of this.reservations) if (owner !== service.id && key.startsWith('track:')) unavailable.add(key.slice(6));
        const alternative = this.graph.shortestRoute(position, target, initialDirection, unavailable);
        if (alternative) {
          const alternativeBlocker = this.reserveRoute(service, alternative);
          if (!alternativeBlocker) { route = alternative; occupied = null; }
        }
      }
      if (occupied) {
        this.stopTrain(train.id); state.delaySeconds += dt;
        state.stoppedReason = occupied; state.phase = 'blocked'; return;
      }
      journey = { route, legIndex: 0, remainingDistance: route.length };
      this.journeys.set(service.id, journey);
      state.phase = 'travelling'; state.stoppedReason = null;
      train.facing = route.legs[0].direction;
      train.dynamics.direction = train.facing;
    }
    state.phase = 'travelling'; state.stoppedReason = null;
    const speed = Math.abs(train.dynamics.speedMps);
    const curve = Math.abs(this.graph.trackByUUID(train.trackUUID).index.poseAtDistance(train.dynamics.distance).curvature) * WORLD_UNITS_PER_METRE;
    const curveLimit = curve > 1e-9 ? Math.sqrt(2 / curve) : 18;
    const family = train.vehicleFamilyId && getPoweredVehicleFamily(train.vehicleFamilyId);
    const maximumSpeed = Math.min(family ? family.maxSpeedKph / 3.6 : service.kind === 'passenger' ? 18 : 12, curveLimit);
    const specification = consistSpecification(train);
    const baseDefinition = family ? physicsForVehicleFamily(family.id) : LOCOMOTIVE_PHYSICS;
    const definition = { ...baseDefinition, massKg: specification.massKg, bodyLength: specification.totalLengthMetres * WORLD_UNITS_PER_METRE,
      maxTractiveEffortN: family ? availableTractiveEffortN(family, speed) : baseDefinition.maxTractiveEffortN };
    const deceleration = Math.max(0.2, definition.maxBrakeForceN / definition.massKg);
    const stopLimit = Math.sqrt(Math.max(0, 2 * deceleration * journey.remainingDistance / WORLD_UNITS_PER_METRE));
    const targetSpeed = Math.min(maximumSpeed, stopLimit);
    const throttle = speed < targetSpeed - 0.1 ? 1 : 0;
    const brake = speed > targetSpeed + 0.05 ? 1 : 0;
    const dynamics = this.dynamics.step({ id: train.id, couplers: [], vehicles: [{ mode: 'on-rail', vehicleId: train.id,
      centre: { trackUUID: train.trackUUID, distance: train.dynamics.distance, direction: train.facing }, speedMps: speed,
      hazard: createDerailmentHazardState(train.id) }] }, new Map([[train.id, definition]]),
    { throttle, brake, emergencyBrake: false }, this.graph, dt);
    const nextSpeed = Math.max(0, Math.min(maximumSpeed, dynamics.state.vehicles[0].speedMps));
    const movement = Math.min(journey.remainingDistance, (speed + nextSpeed) / 2 * dt * WORLD_UNITS_PER_METRE);
    if (movement < 1e-10 && speed === 0 && throttle > 0) {
      state.delaySeconds += dt;
      state.stoppedReason = this.reason('unsuitable-train', 'This train cannot climb the gradient with its current load.', 'Use more power, a lighter train or a gentler gradient.', train.trackUUID);
    }
    this.moveAlongJourney(train, journey, movement);
    state.distanceWorldUnits = Math.round((state.distanceWorldUnits + movement) * 1e8) / 1e8;
    train.dynamics.speedMps = nextSpeed;
    if (journey.remainingDistance <= ARRIVAL_EPSILON) this.arriveAtStop(service, state, train, stop);
  }

  private moveAlongJourney(train: TrainDef, journey: Journey, rawDistance: number): void {
    if (train.dynamics.mode !== 'on-rail') return;
    let distance = rawDistance;
    while (distance > 1e-9 && journey.legIndex < journey.route.legs.length) {
      const leg = journey.route.legs[journey.legIndex];
      if (train.trackUUID !== leg.trackUUID || train.dynamics.direction !== leg.direction) {
        train.trackUUID = leg.trackUUID; train.dynamics.trackUUID = leg.trackUUID;
        train.dynamics.distance = leg.distance; train.facing = leg.direction; train.dynamics.direction = leg.direction;
      }
      const available = Math.abs(leg.endDistance - train.dynamics.distance);
      const moved = Math.min(available, distance);
      train.dynamics.distance += moved * leg.direction;
      journey.remainingDistance = Math.max(0, journey.remainingDistance - moved);
      distance -= moved;
      if (available - moved <= 1e-7) journey.legIndex += 1;
      else break;
    }
    train.trackT = this.graph.parameterAt({ trackUUID: train.trackUUID, distance: train.dynamics.distance });
  }

  private arriveAtStop(service: ServiceDefinition, state: ServiceRuntimeState, train: TrainDef, stop: ServiceStop): void {
    const target = this.stopLocation(stop);
    if (target && train.dynamics.mode === 'on-rail') {
      train.trackUUID = target.trackUUID; train.dynamics.trackUUID = target.trackUUID; train.dynamics.distance = target.distance;
      train.trackT = this.graph.parameterAt(target);
    }
    this.stopTrain(train.id); this.releaseJourney(service.id);
    if (state.nextStopIndex === 0 && state.calls >= service.stops.length) state.completedCycles += 1;
    state.phase = 'dwelling'; state.dwellSeconds = 0; state.calls += 1;
    state.stoppedReason = this.reason(stop.loadRule === 'unload' ? 'unloading' : 'loading',
      `Calling at ${this.stopName(stop)}.`, 'This service leaves automatically when its stop rule is satisfied.', stop.targetId);
    this.events.push({ type: 'service-call', serviceId: service.id, trainId: train.id,
      targetId: stop.targetId, targetKind: stop.targetKind, clockSeconds: this.world.management.clockSeconds });
    if (service.kind === 'passenger' && stop.targetKind === 'station') {
      const arrival = arrivePassengers(this.world.management.passengers, { trainId: train.id, stationId: stop.targetId, tick: this.world.economy.tick });
      const posted = arrival.revenue > 0 ? postLedgerEntry(this.world.company, {
        magnitude: arrival.revenue, category: 'delivery-revenue', tick: this.world.economy.tick,
        referenceId: `passengers:${service.id}:${state.calls}`, direction: 'forward',
      }) : null;
      if (!posted || posted.ok) {
        this.world.management.passengers = arrival.state;
        if (posted?.ok) this.world.company = clonePlainData(posted.company);
        arrival.events.forEach((event) => {
          this.events.push({ type: 'passenger-arrival', ...event });
          this.applyRegionalEvent(event);
        });
        arrival.events.forEach((event) => this.events.push({ type: 'passenger-delivery', serviceId: service.id, trainId: train.id,
          originStationId: event.originStationId, destinationStationId: event.stationId,
          units: event.passengers, revenue: event.revenue, clockSeconds: this.world.management.clockSeconds }));
      }
      this.boardAtStation(service, stop);
    }
  }

  private boardAtStation(service: ServiceDefinition, stop: ServiceStop): void {
    const state = this.world.management.serviceStates[service.id];
    const remainingStops = [...service.stops.slice(state.nextStopIndex + 1), ...service.stops.slice(0, state.nextStopIndex)]
      .filter((target) => target.targetKind === 'station').map((target) => target.targetId);
    const boarding = boardPassengers(this.world.management.passengers, { trainId: service.trainId, stationId: stop.targetId,
      serviceId: service.id, remainingStops, capacity: this.passengerCapacity(service.trainId), tick: this.world.economy.tick });
    this.world.management.passengers = boarding.state;
  }

  private readyToLeave(service: ServiceDefinition, state: ServiceRuntimeState, train: TrainDef, stop: ServiceStop): boolean {
    if (state.dwellSeconds < 2) return false;
    if (service.kind === 'passenger') return state.dwellSeconds >= Math.min(8, Math.max(2, stop.maxWaitSeconds));
    if (stop.loadRule === 'none') return true;
    if (stop.loadRule === 'unload') return train.cargo === null || state.dwellSeconds >= stop.maxWaitSeconds;
    const set = getFreightSet(train.freightSetId);
    const product = train.cargo && getProduct(train.cargo.productId);
    const capacity = set && product ? capacityForProduct(set, product) : null;
    const full = capacity?.ok && (train.cargo?.units ?? 0) >= capacity.capacityUnits;
    if (full || state.dwellSeconds >= stop.maxWaitSeconds) return true;
    if (stop.loadRule === 'available' && train.cargo !== null && state.dwellSeconds >= 3) return true;
    return false;
  }

  private leaveStop(service: ServiceDefinition, state: ServiceRuntimeState): void {
    state.nextStopIndex = (state.nextStopIndex + 1) % service.stops.length;
    if (state.nextStopIndex === 0) {
      state.nextDepartureSeconds = this.nextScheduledDeparture(service, this.world.management.clockSeconds + 0.01);
    }
    state.phase = 'travelling'; state.dwellSeconds = 0; state.stoppedReason = null;
  }

  private tickEconomy(): void {
    this.world.economy.tick += 1;
    const runtime = this.runtimeFrames();
    const serviceByTrain = new Map(this.world.management.services.map((service) => [service.trainId, service]));
    for (const trainId of this.world.trains.map((train) => train.id).sort()) {
      const service = serviceByTrain.get(trainId);
      if (service?.kind === 'passenger') continue;
      const serviceState = service && this.world.management.serviceStates[service.id];
      const stop = service && service.stops[serviceState.nextStopIndex];
      if (service && (!service.enabled || serviceState.phase !== 'dwelling' || stop.targetKind !== 'facility' || stop.loadRule === 'none')) continue;
      const authoritative = this.world.trains.find((train) => train.id === trainId);
      // Stop rules are directional; unloading must never start a new consignment.
      if (stop && (stop.loadRule === 'unload' ? authoritative.cargo === null : authoritative.cargo?.originFacilityId && authoritative.cargo.originFacilityId !== stop.targetId)) continue;
      const originalFacilities = this.world.economy.facilities;
      const scopedEconomy = stop ? { ...this.world.economy, facilities: originalFacilities.filter((facility) => facility.id === stop.targetId) } : this.world.economy;
      const cargo = proposeCargoTick({ operating: true, company: this.world.company, economy: scopedEconomy,
        trains: [authoritative], freightProgress: this.world.freightProgress,
        runtime: runtime.filter((frame) => frame.trainId === trainId) });
      this.world.company = clonePlainData(cargo.company);
      this.world.freightProgress = clonePlainData(cargo.freightProgress);
      const changedById = new Map(cargo.economy.facilities.map((facility) => [facility.id, facility]));
      this.world.economy.facilities = originalFacilities.map((facility) => clonePlainData(changedById.get(facility.id) ?? facility));
      this.world.trains = this.world.trains.map((train) => train.id === trainId ? clonePlainData(cargo.trains[0]) : train);
      cargo.completedDeliveries.forEach((event) => {
        const originFacilityId = authoritative.cargo?.originFacilityId;
        this.events.push({ type: 'freight-delivery', ...event, originFacilityId });
        this.applyRegionalEvent({ id: `delivery:${event.trainId}:${event.tick}:${event.destinationFacilityId}`, kind: 'freight-delivery',
          tick: event.tick, productId: event.productId, units: event.units, destinationFacilityId: event.destinationFacilityId, originFacilityId });
      });
      if (serviceState && cargo.statuses[0]) this.explainCargo(serviceState, cargo.statuses[0]);
    }
    const costMultiplier = getGameDifficulty(this.world.generationConfig.gameDifficulty ?? 'standard').runningCostMultiplier;
    const rateByTrainId: Record<string, number> = Object.create(null);
    for (const train of this.world.trains) {
      rateByTrainId[train.id] = Math.ceil(((train.vehicleFamilyId && getPoweredVehicleFamily(train.vehicleFamilyId)?.runningCostPerTick)
        || getFreightSet(train.freightSetId)?.runningCostPerActiveTick || 20) * costMultiplier);
    }
    const costs = proposeRunningCosts({ tick: this.world.economy.tick, company: this.world.company, trains: this.world.trains,
      runtime: costMultiplier === 0 ? [] : runtime,
      rateByTrainId });
    this.world.company = clonePlainData(costs.company);
    this.world.trains = clonePlainData([...costs.trains]);
    costs.stopTrainIds.forEach((trainId) => {
      this.stopTrain(trainId);
      const service = serviceByTrain.get(trainId);
      if (service) {
        this.releaseJourney(service.id);
        this.block(this.world.management.serviceStates[service.id], 'insufficient-cash', 'Running costs exceed available cash.', 'Pause expensive services or restructure the company.');
      }
    });
    this.world.economy.facilities = [...this.world.economy.facilities].sort((a, b) => a.id.localeCompare(b.id)).map((facility) => {
      const recipe = facility.activeRecipeId && getRecipe(facility.activeRecipeId);
      return recipe ? advanceFacilityRecipe(facility, recipe).facility : facility;
    });
    this.world.economy.market = advanceMarketTick(this.world.economy.market, this.world.generationConfig.seed, this.world.economy.tick);
    if (this.world.region) {
      const regional = advanceRegionalEconomy(this.world.region, this.world.economy);
      this.world.region = regional.region; this.world.economy = regional.economy;
    }
    const stations = this.world.stations.map((station) => {
      const location = this.graph.stationLocation(station);
      const pose = location && this.graph.trackByUUID(location.trackUUID)?.index.poseAtDistance(location.distance);
      return pose ? { id: station.id, ...pose.point, demandPerMinute: Math.max(0, station.passengerSpawnRate)
        * (1 + (this.world.region?.passengerDemandBonusBps ?? 0) / 10_000) } : null;
    }).filter(Boolean);
    this.world.management.passengers = generatePassengerDemand(this.world.management.passengers, { tick: this.world.economy.tick,
      intervalSeconds: 1, stations, services: this.world.management.services.filter((service) => service.enabled && service.kind === 'passenger')
        .map((service) => ({ id: service.id, stops: service.stops.map((stop) => stop.targetId), bidirectional: true })) });
  }

  private runtimeFrames(): TrainRuntimeSnapshot[] {
    const controlled = this.controlledTrainIds;
    return this.getTrainSnapshots().map((frame) => {
      const external = !controlled.has(frame.trainId) && this.externalRuntime.get(frame.trainId);
      if (external) {
        const train = this.world.trains.find((candidate) => candidate.id === frame.trainId);
        if (external.trackUUID && this.graph.trackByUUID(external.trackUUID) && Number.isFinite(external.trackT)) {
          train.trackUUID = external.trackUUID; train.trackT = external.trackT; train.facing = external.facing;
          if (external.dynamics) train.dynamics = clonePlainData(external.dynamics);
        }
        return external;
      }
      const train = this.world.trains.find((candidate) => candidate.id === frame.trainId);
      const state = frame.serviceId && this.world.management.serviceStates[frame.serviceId];
      const moving = state?.phase === 'travelling' && this.world.management.services.find(service=>service.id===frame.serviceId)?.enabled;
      return { trainId: frame.trainId, trackUUID: frame.trackUUID, trackT: frame.trackT, facing: frame.facing,
        x: frame.x, y: frame.y, speedWorldUnitsPerSecond: frame.speedMps * WORLD_UNITS_PER_METRE,
        throttle: moving ? 1 : 0, derailed: train.dynamics.mode !== 'on-rail', dynamics: clonePlainData(train.dynamics) } as TrainRuntimeSnapshot;
    });
  }

  private reserveRoute(service: ServiceDefinition, route: RailRoute): StoppedReason | null {
    const trackIds = route.occupiedTrackUUIDs;
    const occupiedByTrain = this.world.trains.filter((train) => train.id !== service.trainId && train.dynamics.mode === 'on-rail')
      .map((train) => ({ train, tracks: this.graph.tracksOccupiedByBody({ trackUUID: train.trackUUID,
        distance: train.dynamics.mode === 'on-rail' ? train.dynamics.distance : 0 },
      consistSpecification(train).totalLengthMetres * WORLD_UNITS_PER_METRE) }));
    // Whole-track blocks deliberately favor safety. A passing loop needs distinct connected segments.
    for (const trackId of trackIds) {
      const reservedBy = this.reservations.get(`track:${trackId}`);
      const otherTrain = occupiedByTrain.find((candidate) => candidate.tracks.has(trackId))?.train;
      if ((reservedBy && reservedBy !== service.id) || otherTrain) {
        const otherService = this.world.management.services.find((candidate) => candidate.id === reservedBy || candidate.trainId === otherTrain?.id);
        return this.reason('track-occupied', `${otherService?.name ?? 'Another train'} occupies the route to the next stop.`,
          'Build a passing loop with separate track sections, move the stopped train or adjust departure times.', otherTrain?.id ?? otherService?.trainId ?? trackId);
      }
    }
    for (const junctionId of route.junctionIds) {
      const owner = this.reservations.get(`junction:${junctionId}`);
      if (owner && owner !== service.id) return this.reason('junction-occupied', 'Another service has reserved this junction.', 'Wait for it to clear or change the departure offset.', junctionId);
    }
    trackIds.forEach((id) => this.reservations.set(`track:${id}`, service.id));
    route.junctionIds.forEach((id) => this.reservations.set(`junction:${id}`, service.id));
    return null;
  }

  private releaseJourney(serviceId: string): void {
    this.journeys.delete(serviceId);
    for (const [key, owner] of this.reservations) if (owner === serviceId) this.reservations.delete(key);
  }

  private stopLocation(stop: ServiceStop): RailLocation | null {
    const key = `${stop.targetKind}:${stop.targetId}`;
    if (this.stopLocations.has(key)) return this.stopLocations.get(key);
    let location: RailLocation | null;
    if (stop.targetKind === 'facility') {
      const facility = this.world.economy.facilities.find((candidate) => candidate.id === stop.targetId);
      location = facility ? this.graph.facilityLocation(facility) : null;
    } else {
      const station = this.world.stations.find((candidate) => candidate.id === stop.targetId);
      location = station ? this.graph.stationLocation(station) : null;
    }
    this.stopLocations.set(key, location);
    return location;
  }
  private stopName(stop: ServiceStop): string {
    return (stop.targetKind === 'facility' ? this.world.economy.facilities : this.world.stations).find((candidate) => candidate.id === stop.targetId)?.name ?? stop.targetId;
  }
  private nextScheduledDeparture(service: ServiceDefinition, clock: number): number {
    if (service.frequencySeconds <= 0) return clock;
    const offset = service.departureOffsetSeconds;
    return clock <= offset ? offset : offset + Math.ceil((clock - offset) / service.frequencySeconds) * service.frequencySeconds;
  }
  private normalizeRuntime(): void {
    const controlled = this.controlledTrainIds;
    for (const service of this.world.management.services) {
      if (!Object.prototype.hasOwnProperty.call(this.world.management.serviceStates, service.id)) {
        Object.defineProperty(this.world.management.serviceStates, service.id, {
          enumerable: true, configurable: true, writable: true, value: createServiceRuntimeState(),
        });
      }
      const state = this.world.management.serviceStates[service.id];
    }
    for (const train of this.world.trains) {
      if (train.dynamics.mode !== 'on-rail') continue;
      if (!controlled.has(train.id)) train.dynamics.speedMps = 0;
      const track = this.graph.trackByUUID(train.trackUUID);
      if (!track) continue;
      train.dynamics.trackUUID = train.trackUUID;
      train.dynamics.distance = Math.max(0, Math.min(track.index.length, train.dynamics.distance));
      train.trackT = this.graph.parameterAt({ trackUUID: train.trackUUID, distance: train.dynamics.distance });
    }
  }
  private passengerCapacity(trainId: string): number {
    const train = this.world.trains.find((candidate) => candidate.id === trainId);
    const family = train?.vehicleFamilyId && getPoweredVehicleFamily(train.vehicleFamilyId);
    return family ? family.passengerCapacity : 80;
  }
  private applyRegionalEvent(event: RegionEvent): void {
    if (!this.world.region) return;
    if (event.kind === 'passenger-arrival') {
      const stationId = event.stationId;
      const station = this.world.stations.find(candidate => candidate.id === stationId);
      if (!station || !Number.isFinite(station.trackT) || station.trackT < 0 || station.trackT > 1) return;
      const location = this.graph.stationLocation(station);
      const track = location && this.graph.trackByUUID(location.trackUUID);
      if (!location || !track || track.index.length <= 0) return;
      const point = track.index.poseAtDistance(location.distance).point;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      event = { ...event, x: point.x, y: point.y };
    }
    const result = applyRegionEvent(this.world.region, event);
    let company = this.world.company;
    for (const outcome of result.outcomes) {
      if (company.ledger.some((entry) => entry.referenceId === outcome.id && entry.category === 'contract-bonus')) continue;
      const posted = postLedgerEntry(company, { category: 'contract-bonus', magnitude: outcome.grant,
        tick: outcome.tick, referenceId: outcome.id, direction: 'forward' });
      if (!posted.ok) return;
      company = posted.company;
    }
    this.world.company = clonePlainData(company);
    this.world.region = result.state;
  }
  private stopTrain(trainId: string): void {
    const train = this.world.trains.find((candidate) => candidate.id === trainId);
    if (train?.dynamics.mode === 'on-rail') train.dynamics.speedMps = 0;
  }
  private reason(code: StoppedReason['code'], message: string, remedy: string, relatedEntityId?: string): StoppedReason {
    return { code, message, remedy, ...(relatedEntityId ? { relatedEntityId } : {}) };
  }
  private block(state: ServiceRuntimeState, code: StoppedReason['code'], message: string, remedy: string, relatedEntityId?: string): void {
    state.phase = 'blocked'; state.stoppedReason = this.reason(code, message, remedy, relatedEntityId);
  }
  private explainCargo(state: ServiceRuntimeState, status: CargoTransferStatus): void {
    if (status.blocker === 'source-empty') state.stoppedReason = this.reason('no-supply', 'Waiting for the source to produce cargo.', 'Wait, supply its inputs or reduce this stop’s maximum waiting time.', status.facilityId);
    else if (status.blocker === 'destination-full') state.stoppedReason = this.reason('destination-full', 'The destination inventory is full.', 'Improve onward transport or allow time for processing.', status.facilityId);
    else if (status.kind === 'loading' || status.kind === 'unloading') state.stoppedReason = this.reason(status.kind,
      `${status.kind === 'loading' ? 'Loading' : 'Unloading'} ${status.batchUnits} units per second.`, 'This train departs automatically under its stop rule.', status.facilityId);
  }
  private touchRevision(): void {
    this.world.operationsRevision += 1; this.world.revision = this.world.constructionRevision + this.world.operationsRevision;
    this.changedSinceAdvance = true;
  }
}

export function validateServiceDefinition(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Invalid service.'];
  const service = value as ServiceDefinition;
  const errors: string[] = [];
  if (typeof service.id !== 'string' || !service.id.trim() || typeof service.name !== 'string' || !service.name.trim()) errors.push('Give the service an ID and name.');
  if (typeof service.trainId !== 'string' || !service.trainId.trim()) errors.push('Assign a train.');
  if (!['freight', 'passenger'].includes(service.kind)) errors.push('Choose freight or passenger service.');
  if (typeof service.enabled !== 'boolean') errors.push('Invalid service enabled state.');
  if (!Number.isFinite(service.frequencySeconds) || service.frequencySeconds < 0 || service.frequencySeconds > 86400
    || !Number.isFinite(service.departureOffsetSeconds) || service.departureOffsetSeconds < 0 || service.departureOffsetSeconds > 86400
    || !Number.isSafeInteger(service.priority) || service.priority < 0 || service.priority > 100) errors.push('Use valid frequency, offset and priority values.');
  if (!Array.isArray(service.stops) || service.stops.length < 2 || service.stops.length > 20) errors.push('Choose between two and 20 stops.');
  else for (const stop of service.stops) {
    if (!stop || typeof stop.targetId !== 'string' || !stop.targetId.trim()
      || !['facility', 'station'].includes(stop.targetKind) || !['full', 'available', 'unload', 'none'].includes(stop.loadRule)
      || !Number.isFinite(stop.maxWaitSeconds) || stop.maxWaitSeconds < 0 || stop.maxWaitSeconds > 3600
      || (service.kind === 'freight' && stop.targetKind !== 'facility') || (service.kind === 'passenger' && stop.targetKind !== 'station')) errors.push('Use valid stops and waiting rules for this service.');
  }
  return [...new Set(errors)];
}
