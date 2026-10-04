import { clonePlainData } from '../utils/PlainData';
import { postLedgerEntry } from '../economy/FinanceLedger';
import { RailGraph } from './RailGraph';
import { SimulationSession } from './SimulationSession';
import type { BlueprintDraft, ManagedWorld, RehearsalRequest, RehearsalResult, SimulationEvent } from './SimulationTypes';
import { getPoweredVehicleFamily } from '../region/VehicleRoster';

export function blueprintIsCurrent(draft: BlueprintDraft, world: ManagedWorld): boolean {
  return draft.sourceWorldId === world.id && draft.sourceRevision === world.revision;
}

/** Apply the reviewed change set to a detached world; never touch the live session. */
export function prepareRehearsalWorld(request: RehearsalRequest): { world: ManagedWorld; errors: string[] } {
  const world = clonePlainData(request.world);
  const draft = request.draft;
  const errors: string[] = [];
  if (!draft) return { world, errors };
  if (!blueprintIsCurrent(draft, world)) errors.push('This design is stale. Refresh its construction quote against the current railway.');
  if (!Number.isSafeInteger(draft.constructionCost) || draft.constructionCost < 0) errors.push('Construction cost must be a non-negative integer.');
  const removed = new Set(draft.removedTrackIds ?? []);
  if (world.trains.some((train) => removed.has(train.trackUUID))) errors.push('An occupied track cannot be removed. Move its trains first.');
  const appendUnique = <T>(existing: T[], additions: T[], key: (value: T) => string, kind: string) => {
    const ids = new Set(existing.map(key));
    for (const addition of additions) {
      if (ids.has(key(addition))) errors.push(`A proposed ${kind} ID already exists: ${key(addition)}.`);
      else { ids.add(key(addition)); existing.push(clonePlainData(addition)); }
    }
  };
  world.tracks = world.tracks.filter((track) => !removed.has(track.uuid));
  appendUnique(world.tracks, draft.tracks, (track) => track.uuid, 'track');
  appendUnique(world.junctions, draft.junctions, (junction) => junction.uuid, 'junction');
  appendUnique(world.stations, draft.stations, (station) => station.id, 'station');
  appendUnique(world.trains, draft.trains, (train) => train.id, 'train');
  const graph = new RailGraph(world.tracks, world.junctions);
  const vehicleCost = draft.trains.reduce((sum, train) => {
    const family = train.vehicleFamilyId && getPoweredVehicleFamily(train.vehicleFamilyId);
    return sum + (family ? family.purchasePrice + (family.passengerCapacity > 0 ? 0 : 20000) : 0);
  }, 0);
  if (vehicleCost > draft.constructionCost) errors.push('Refresh this design’s construction and vehicle quote before rehearsing it.');
  for (const [category, amount, referenceId] of [
    ['construction-capex', Math.max(0, draft.constructionCost - vehicleCost), `blueprint:${draft.id}`],
    ['vehicle-capex', vehicleCost, `blueprint-vehicles:${draft.id}`],
  ] as const) if (amount > 0) {
    const debit = postLedgerEntry(world.company, { category, magnitude: amount,
      tick: world.economy.tick, referenceId, direction: 'forward' });
    if (!debit.ok) errors.push('The company cannot afford the proposed construction.');
    else world.company = clonePlainData(debit.company);
  }
  for (const train of world.trains) if (!graph.trackByUUID(train.trackUUID)) errors.push(`Train ${train.id} needs connected track.`);
  if (errors.length) return { world, errors };
  const session = new SimulationSession(world);
  for (const service of draft.services) {
    const added = session.upsertService(service);
    errors.push(...added.errors);
  }
  return { world: session.snapshot(), errors };
}

export function createRehearsal(request: RehearsalRequest): {
  step: (budgetSeconds?: number) => boolean;
  cancel: () => void;
  result: () => RehearsalResult;
} {
  const prepared = prepareRehearsalWorld(request);
  const session = new SimulationSession(prepared.world);
  session.setSpeed(1);
  const initial = session.snapshot();
  const horizon = Math.min(3600, Math.max(1, Number.isFinite(request.horizonSeconds) ? request.horizonSeconds : 300));
  const sampleInterval = Math.max(0.25, Number.isFinite(request.sampleIntervalSeconds) ? request.sampleIntervalSeconds : 2);
  const initialClock = initial.management.clockSeconds;
  const initialLedgerLength = initial.company.ledger.length;
  const completedCyclesBefore = Object.values(initial.management.serviceStates).reduce((sum, state) => sum + state.completedCycles, 0);
  const deliveries: SimulationEvent[] = [];
  const blockers = new Map<string, RehearsalResult['engineering']['blockers'][number]>();
  let elapsed = 0;
  let nextSample = 0;
  let cancelled = false;
  const samples: RehearsalResult['samples'] = [];
  const invalid = prepared.errors.length > 0;
  const sample = () => samples.push({ clockSeconds: session.clockSeconds, trains: session.getTrainSnapshots() });
  if (!invalid) sample();
  return {
    step(budgetSeconds = 5): boolean {
      if (cancelled || invalid || elapsed >= horizon) return true;
      const through = Math.min(horizon, elapsed + Math.max(0.05, budgetSeconds));
      while (elapsed + 1e-8 < through) {
        const dt = Math.min(0.25, through - elapsed);
        session.advance(dt * 1000);
        deliveries.push(...session.drainEvents());
        elapsed = Math.round((elapsed + dt) * 1e8) / 1e8;
        const progress = session.rehearsalProgress();
        for (const state of progress) {
          if (!state.stoppedReason || ['loading', 'unloading', 'scheduled', 'disabled'].includes(state.stoppedReason.code)) continue;
          const reason = state.stoppedReason;
          const key = `${state.serviceId}:${reason.code}:${reason.relatedEntityId ?? ''}`;
          const prior = blockers.get(key);
          blockers.set(key, { serviceId: state.serviceId, reason: clonePlainData(reason), seconds: (prior?.seconds ?? 0) + dt });
        }
        if (elapsed >= nextSample + sampleInterval || elapsed >= horizon) { sample(); nextSample = elapsed; }
        const cycles = progress.reduce((sum, state) => sum + state.completedCycles, 0);
        if (progress.length > 0 && progress.every((state) =>
          state.completedCycles > (initial.management.serviceStates[state.serviceId]?.completedCycles ?? 0))) {
          // One complete cycle for every proposed service is the v1 rehearsal horizon.
          if (cycles > completedCyclesBefore) { if (samples[samples.length - 1].clockSeconds !== session.clockSeconds) sample(); return true; }
        }
      }
      return elapsed >= horizon;
    },
    cancel() { cancelled = true; },
    result(): RehearsalResult {
      const final = session.snapshot();
      const newEntries = final.company.ledger.slice(initialLedgerLength);
      const completedCycles = Object.values(final.management.serviceStates).reduce((sum, state) => sum + state.completedCycles, 0) - completedCyclesBefore;
      return { requestId: request.requestId, sourceRevision: request.world.revision,
        status: invalid ? 'invalid' : cancelled ? 'cancelled' : 'complete', elapsedSeconds: final.management.clockSeconds - initialClock,
        samples: clonePlainData(samples),
        engineering: {
          deliveredUnits: deliveries.reduce((sum, event) => sum + (event.type === 'freight-delivery' ? event.units : 0), 0),
          passengersDelivered: deliveries.reduce((sum, event) => sum + (event.type === 'passenger-delivery' ? event.units : 0), 0),
          runningCosts: newEntries.reduce((sum, entry) => sum + (entry.category === 'train-running-cost' ? -entry.amount : 0), 0),
          revenue: newEntries.reduce((sum, entry) => sum + (entry.category === 'delivery-revenue' ? entry.amount : 0), 0),
          completedCycles, waitingSeconds: [...blockers.values()].reduce((sum, blocker) => sum + blocker.seconds, 0),
          blockers: clonePlainData([...blockers.values()]),
        },
        forecast: { label: 'Demand forecast', assumptions: ['Rehearsal starts from the current region and uses the live production, demand and market rules. Projects already accepted can complete during the run and apply their usual effects.',
          'Only the current railway and this draft are included. New player decisions, construction outside the draft and speculative growth are not simulated.',
          'The 80–120% demand range is an illustrative uncertainty band, not calibrated or separately simulated. Route connectivity and block conflicts use the shared simulation.'], demandRange: [0.8, 1.2] },
        errors: [...prepared.errors],
      };
    },
  };
}

export function runRehearsal(request: RehearsalRequest, isCancelled: () => boolean = () => false): RehearsalResult {
  const rehearsal = createRehearsal(request);
  while (true) {
    if (isCancelled()) { rehearsal.cancel(); break; }
    if (rehearsal.step()) break;
  }
  return rehearsal.result();
}
