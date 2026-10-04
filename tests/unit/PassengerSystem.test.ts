import { arrivePassengers, boardPassengers, createPassengerState, findPassengerJourney, generatePassengerDemand, passengerCounts, unloadPassengers, validatePassengerState } from '../../src/region/PassengerSystem';

const stations = [{ id: 'A', x: 0, y: 0, demandPerMinute: 10 }, { id: 'B', x: 1_000, y: 0, demandPerMinute: 0 }, { id: 'C', x: 2_000, y: 0, demandPerMinute: 0 }];
const services = [{ id: 'local', stops: ['A', 'B'] }, { id: 'connection', stops: ['B', 'C'] }];
const generate = () => generatePassengerDemand(createPassengerState(), { tick: 1, intervalSeconds: 60, stations, services });

describe('passenger destination cohorts', () => {
  it('chooses fewest transfers deterministically and respects directed services', () => {
    expect(findPassengerJourney('A', 'C', services)).toEqual([{ serviceId: 'local', from: 'A', to: 'B' }, { serviceId: 'connection', from: 'B', to: 'C' }]);
    expect(findPassengerJourney('A', 'C', [...services, { id: 'express', stops: ['A', 'C'] }])).toEqual([{ serviceId: 'express', from: 'A', to: 'C' }]);
    expect(findPassengerJourney('B', 'A', [{ id: 'oneway', stops: ['A', 'B'], bidirectional: false }])).toBeNull();
  });
  it('conserves people through capacity limits, partial boarding, transfers and arrivals', () => {
    let state = generate();
    const original = state;
    const first = boardPassengers(state, { trainId: 'train', stationId: 'A', serviceId: 'local', remainingStops: ['B'], capacity: 7, tick: 1 });
    expect(first.boarded).toBe(7);
    state = first.state;
    expect(passengerCounts(state)).toEqual({ waiting: 3, onboard: 7, arrived: 0, generated: 10 });
    const arrived = arrivePassengers(state, { trainId: 'train', stationId: 'B', tick: 2 });
    expect(arrived.transferred).toBe(2);
    expect(arrived.events.reduce((sum, e) => sum + e.passengers, 0)).toBe(5);
    expect(passengerCounts(arrived.state)).toEqual({ waiting: 5, onboard: 0, arrived: 5, generated: 10 });
    const onward = boardPassengers(arrived.state, { trainId: 'second', stationId: 'B', serviceId: 'connection', remainingStops: ['C'], capacity: 20, tick: 2 });
    expect(onward.boarded).toBe(2);
    const completed = arrivePassengers(onward.state, { trainId: 'second', stationId: 'C', tick: 3 });
    expect(passengerCounts(completed.state)).toEqual({ waiting: 3, onboard: 0, arrived: 7, generated: 10 });
    expect(completed.revenue).toBe(2 * 13);
    expect(original).toEqual(generate());
  });
  it('only pays at final destination, once, including after a save round trip', () => {
    let state = generatePassengerDemand(createPassengerState(), { tick: 1, intervalSeconds: 60, stations: [stations[0], stations[2]], services });
    state = boardPassengers(state, { trainId: 'one', stationId: 'A', serviceId: 'local', remainingStops: ['B'], capacity: 30, tick: 1 }).state;
    const transfer = arrivePassengers(state, { trainId: 'one', stationId: 'B', tick: 2 });
    expect(transfer.revenue).toBe(0);
    expect(transfer.events).toEqual([]);
    state = boardPassengers(transfer.state, { trainId: 'two', stationId: 'B', serviceId: 'connection', remainingStops: ['C'], capacity: 30, tick: 2 }).state;
    const delivered = arrivePassengers(state, { trainId: 'two', stationId: 'C', tick: 3 });
    expect(delivered.revenue).toBe(130);
    const repeated = arrivePassengers(JSON.parse(JSON.stringify(delivered.state)), { trainId: 'two', stationId: 'C', tick: 3 });
    expect(repeated.revenue).toBe(0);
    expect(repeated.events).toEqual([]);
  });
  it('retains fractional demand and does not replay demand ticks', () => {
    let state = createPassengerState();
    for (let tick = 1; tick <= 60; tick++) state = generatePassengerDemand(state, { tick, intervalSeconds: 1, stations: [stations[0], stations[1]], services });
    expect(state.generated).toBe(10);
    expect(generatePassengerDemand(state, { tick: 60, intervalSeconds: 60, stations, services })).toBe(state);
  });
  it('keeps disconnected demand waiting, replans new services, and recovers cancellation', () => {
    let state = generatePassengerDemand(createPassengerState(), { tick: 1, intervalSeconds: 60, stations, services: [] });
    expect(state.cohorts.every(c => c.itinerary.length === 0)).toBe(true);
    state = generatePassengerDemand(state, { tick: 2, intervalSeconds: 0.01, stations, services });
    expect(state.cohorts.every(c => c.itinerary.length > 0)).toBe(true);
    state = boardPassengers(state, { trainId: 'one', stationId: 'A', serviceId: 'local', remainingStops: ['B'], capacity: 30, tick: 2 }).state;
    state = unloadPassengers(state, 'one', 'A');
    expect(passengerCounts(state)).toEqual({ waiting: 10, onboard: 0, arrived: 0, generated: 10 });
    expect(state.revenue).toBe(0);
  });
  it('bounds waiting queues without generating and then deleting people', () => {
    const state = generatePassengerDemand(createPassengerState(), { tick: 1, intervalSeconds: 1_000_000, stations, services: [] });
    expect(passengerCounts(state)).toEqual({ waiting: 1_000, onboard: 0, arrived: 0, generated: 1_000 });
  });
  it('validates persisted conservation and rejects ambiguous locations and duplicate identities', () => {
    const state = generate();
    expect(validatePassengerState(JSON.parse(JSON.stringify(state)))).toBe(true);
    expect(validatePassengerState({ ...state, generated: 0 })).toBe(false);
    expect(validatePassengerState({ ...state, cohorts: [...state.cohorts, state.cohorts[0]] })).toBe(false);
    state.cohorts[0].trainId = 'train';
    expect(validatePassengerState(state)).toBe(false);
  });
});
