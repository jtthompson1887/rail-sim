export interface PassengerStation { id: string; x: number; y: number; demandPerMinute: number }
export interface PassengerService { id: string; stops: readonly string[]; bidirectional?: boolean }
export interface PassengerLeg { serviceId: string; from: string; to: string }
export interface PassengerCohort {
  id: string;
  originStationId: string;
  destinationStationId: string;
  count: number;
  waitingAt: string | null;
  trainId: string | null;
  itinerary: PassengerLeg[];
  farePerPassenger: number;
  createdTick: number;
}
export interface PassengerState {
  version: 1;
  cohorts: PassengerCohort[];
  demandRemainders: Record<string, number>;
  lastDemandTick: number;
  nextCohortId: number;
  generated: number;
  arrived: number;
  revenue: number;
}
export interface PassengerArrivalEvent {
  id: string;
  kind: 'passenger-arrival';
  tick: number;
  stationId: string;
  originStationId: string;
  passengers: number;
  revenue: number;
}
export const createPassengerState = (): PassengerState => ({ version: 1, cohorts: [], demandRemainders: {}, lastDemandTick: -1, nextCohortId: 1, generated: 0, arrived: 0, revenue: 0 });
const clone = (state: PassengerState): PassengerState => ({ ...state, demandRemainders: { ...state.demandRemainders }, cohorts: state.cohorts.map(c => ({ ...c, itinerary: c.itinerary.map(l => ({ ...l })) })) });

/** Fewest boardings, then deterministic service/station order; a leg may pass intermediate stops. */
export function findPassengerJourney(origin: string, destination: string, services: readonly PassengerService[]): PassengerLeg[] | null {
  if (origin === destination) return [];
  const queue: { at: string; legs: PassengerLeg[] }[] = [{ at: origin, legs: [] }];
  const seen = new Set([origin]);
  const ordered = [...services].sort((a, b) => a.id.localeCompare(b.id));
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const service of ordered) {
      const index = service.stops.indexOf(current.at);
      if (index < 0) continue;
      const destinations = service.stops.filter((id, i) => id !== current.at && (service.bidirectional !== false || i > index));
      for (const to of destinations) {
        if (seen.has(to)) continue;
        const legs = [...current.legs, { serviceId: service.id, from: current.at, to }];
        if (to === destination) return legs;
        seen.add(to);
        queue.push({ at: to, legs });
      }
    }
  }
  return null;
}

export function generatePassengerDemand(state: PassengerState, input: {
  tick: number;
  intervalSeconds: number;
  stations: readonly PassengerStation[];
  services: readonly PassengerService[];
}): PassengerState {
  if (!Number.isSafeInteger(input.tick) || input.tick <= state.lastDemandTick || !Number.isFinite(input.intervalSeconds) || input.intervalSeconds <= 0) return state;
  const next = clone(state);
  next.lastDemandTick = input.tick;
  const stations = [...input.stations].filter(s => Number.isFinite(s.x) && Number.isFinite(s.y)).sort((a, b) => a.id.localeCompare(b.id));
  // Replan waiting cohorts so adding a connection immediately makes latent demand usable.
  next.cohorts.forEach(c => {
    if (c.waitingAt !== null) c.itinerary = findPassengerJourney(c.waitingAt, c.destinationStationId, input.services) ?? [];
  });
  for (const origin of stations) {
    const destinations = stations.filter(s => s.id !== origin.id);
    if (destinations.length === 0 || !Number.isFinite(origin.demandPerMinute) || origin.demandPerMinute <= 0) continue;
    const waiting = next.cohorts.filter(c => c.waitingAt === origin.id).reduce((sum, c) => sum + c.count, 0);
    let room = Math.max(0, 1_000 - waiting);
    for (const destination of destinations) {
      const key = JSON.stringify([origin.id, destination.id]);
      const demand = (next.demandRemainders[key] ?? 0) + origin.demandPerMinute * input.intervalSeconds / 60 / destinations.length;
      const wholeDemand = Math.floor(demand + 1e-9);
      const count = Math.min(room, wholeDemand);
      next.demandRemainders[key] = Math.max(0, demand - wholeDemand);
      if (!Number.isSafeInteger(count) || count <= 0) continue;
      room -= count;
      const itinerary = findPassengerJourney(origin.id, destination.id, input.services) ?? [];
      const farePerPassenger = Math.max(5, Math.round(Math.hypot(origin.x - destination.x, origin.y - destination.y) / 250) + 5);
      // Merge compatible queued cohorts to keep long-running games bounded by OD pairs.
      const existing = next.cohorts.find(c => c.waitingAt === origin.id && c.originStationId === origin.id && c.destinationStationId === destination.id && c.farePerPassenger === farePerPassenger);
      if (existing) existing.count += count;
      else next.cohorts.push({ id: `passengers-${next.nextCohortId++}`, originStationId: origin.id, destinationStationId: destination.id, count, waitingAt: origin.id, trainId: null, itinerary, farePerPassenger, createdTick: input.tick });
      next.generated += count;
    }
  }
  return next;
}

export function boardPassengers(state: PassengerState, input: {
  trainId: string; stationId: string; serviceId: string; remainingStops: readonly string[]; capacity: number; tick: number;
}): { state: PassengerState; boarded: number } {
  if (!Number.isSafeInteger(input.capacity) || input.capacity <= 0) return { state, boarded: 0 };
  const next = clone(state);
  const occupied = next.cohorts.filter(c => c.trainId === input.trainId).reduce((sum, c) => sum + c.count, 0);
  let room = Math.max(0, input.capacity - occupied);
  let boarded = 0;
  for (const cohort of [...next.cohorts].sort((a, b) => a.createdTick - b.createdTick || a.id.localeCompare(b.id))) {
    const leg = cohort.itinerary[0];
    if (!room || cohort.waitingAt !== input.stationId || !leg || leg.serviceId !== input.serviceId || !input.remainingStops.includes(leg.to)) continue;
    const count = Math.min(room, cohort.count);
    if (count === cohort.count) { cohort.waitingAt = null; cohort.trainId = input.trainId; }
    else {
      cohort.count -= count;
      next.cohorts.push({ ...cohort, id: `passengers-${next.nextCohortId++}`, count, waitingAt: null, trainId: input.trainId, itinerary: cohort.itinerary.map(l => ({ ...l })) });
    }
    room -= count;
    boarded += count;
  }
  return { state: next, boarded };
}

export function arrivePassengers(state: PassengerState, input: {
  trainId: string; stationId: string; tick: number;
}): { state: PassengerState; events: PassengerArrivalEvent[]; revenue: number; transferred: number } {
  const next = clone(state);
  const events: PassengerArrivalEvent[] = [];
  let revenue = 0;
  let transferred = 0;
  next.cohorts = next.cohorts.filter(cohort => {
    if (cohort.trainId !== input.trainId) return true;
    if (cohort.destinationStationId === input.stationId) {
      const fare = cohort.count * cohort.farePerPassenger;
      events.push({ id: `arrival:${cohort.id}`, kind: 'passenger-arrival', tick: input.tick, stationId: input.stationId, originStationId: cohort.originStationId, passengers: cohort.count, revenue: fare });
      next.arrived += cohort.count;
      revenue += fare;
      return false;
    }
    if (cohort.itinerary[0]?.to === input.stationId) {
      cohort.itinerary.shift();
      cohort.trainId = null;
      cohort.waitingAt = input.stationId;
      transferred += cohort.count;
    }
    return true;
  });
  next.revenue += revenue;
  return { state: next, events, revenue, transferred };
}

/** Cancelled services return riders to a station without losing them or paying a fare. */
export function unloadPassengers(state: PassengerState, trainId: string, stationId: string): PassengerState {
  const next = clone(state);
  next.cohorts.forEach(c => { if (c.trainId === trainId) { c.trainId = null; c.waitingAt = stationId; c.itinerary = []; } });
  return next;
}

export function passengerCounts(state: PassengerState): { waiting: number; onboard: number; arrived: number; generated: number } {
  return { waiting: state.cohorts.filter(c => c.waitingAt !== null).reduce((n, c) => n + c.count, 0), onboard: state.cohorts.filter(c => c.trainId !== null).reduce((n, c) => n + c.count, 0), arrived: state.arrived, generated: state.generated };
}

export function validatePassengerState(raw: unknown): raw is PassengerState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const state = raw as PassengerState;
  const whole = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  if (state.version !== 1 || !Array.isArray(state.cohorts) || !whole(state.generated) || !whole(state.arrived) || !whole(state.revenue) || !whole(state.nextCohortId) || state.nextCohortId < 1 || !Number.isSafeInteger(state.lastDemandTick) || state.lastDemandTick < -1 || !state.demandRemainders || typeof state.demandRemainders !== 'object' || Array.isArray(state.demandRemainders)) return false;
  if (Object.values(state.demandRemainders).some(value => !Number.isFinite(value) || value < 0 || value >= 1)) return false;
  const ids = new Set<string>();
  let remaining = 0;
  for (const c of state.cohorts) {
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id) || typeof c.originStationId !== 'string' || !c.originStationId || typeof c.destinationStationId !== 'string' || !c.destinationStationId || c.originStationId === c.destinationStationId || !whole(c.count) || c.count === 0 || !whole(c.farePerPassenger) || !whole(c.createdTick) || !Array.isArray(c.itinerary)) return false;
    const identity = /^passengers-([1-9]\d*)$/.exec(c.id);
    if (!identity || !Number.isSafeInteger(Number(identity[1])) || Number(identity[1]) >= state.nextCohortId) return false;
    const waiting = typeof c.waitingAt === 'string' && c.waitingAt.length > 0 && c.trainId === null;
    const onboard = typeof c.trainId === 'string' && c.trainId.length > 0 && c.waitingAt === null;
    if (!waiting && !onboard) return false;
    if (c.itinerary.some(leg => !leg || typeof leg.serviceId !== 'string' || !leg.serviceId || typeof leg.from !== 'string' || !leg.from || typeof leg.to !== 'string' || !leg.to || leg.from === leg.to)) return false;
    ids.add(c.id);
    remaining += c.count;
  }
  return Number.isSafeInteger(remaining) && state.generated === remaining + state.arrived;
}
