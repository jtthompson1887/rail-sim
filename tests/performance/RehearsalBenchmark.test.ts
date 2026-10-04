import { SimulationSession } from '../../src/simulation/SimulationSession';
import { runRehearsal } from '../../src/simulation/Rehearsal';
import { createCompanyState } from '../../src/economy/FinanceLedger';
import { clonePlainData } from '../../src/utils/PlainData';
import { makeFirstFreightRouteWorld, makeFreightTrainDef } from '../fixtures/FirstFreightRouteFixture';

describe('regional rehearsal benchmark', () => {
  it('rehearses 50 active services on a 2,000-segment graph without touching the source', () => {
    const world = makeFirstFreightRouteWorld();
    const track = clonePlainData(world.tracks[0]);
    const facilities = clonePlainData(world.economy.facilities);
    world.tracks = []; world.trains = []; world.economy.facilities = [];
    world.company = createCompanyState(10_000_000);
    for (let index = 0; index < 2_000; index++) {
      const copy = clonePlainData(track); copy.uuid = `track-${index}`;
      for (const key of ['p0','p1','p2','p3'] as const) copy[key].y += index * 500;
      world.tracks.push(copy);
      if (index >= 50) continue;
      world.trains.push(makeFreightTrainDef({ id:`train-${index}`, trackUUID:copy.uuid, vehicleFamilyId:'mixed-diesel' }));
      for (const original of facilities) {
        const facility = clonePlainData(original); facility.id += `-${index}`;
        facility.y += index * 500; facility.railAccess.y += index * 500;
        world.economy.facilities.push(facility);
      }
    }
    const session = new SimulationSession(world);
    for (let index = 0; index < 50; index++) expect(session.upsertService({
      id:`service-${index}`, name:`Timber ${index}`, trainId:`train-${index}`, kind:'freight', enabled:true,
      frequencySeconds:0, departureOffsetSeconds:0, priority:1,
      stops:[{targetId:`managed-forest-${index}`,targetKind:'facility',loadRule:'available',maxWaitSeconds:0},
        {targetId:`sawmill-${index}`,targetKind:'facility',loadRule:'unload',maxWaitSeconds:0}],
    }).ok).toBe(true);
    const source = session.snapshot(); const unchanged = clonePlainData(source);
    const started = performance.now();
    const result = runRehearsal({requestId:'regional-benchmark',world:source,horizonSeconds:10,sampleIntervalSeconds:1});
    const durationMs = performance.now() - started;
    expect(result.status).toBe('complete'); expect(result.elapsedSeconds).toBeCloseTo(10);
    expect(result.samples.every(sample=>sample.trains.length===50)).toBe(true);
    expect(result.samples.some(sample=>sample.trains.filter(train=>train.speedMps>0).length===50)).toBe(true);
    expect(source).toEqual(unchanged);
    expect(Number.isFinite(durationMs)).toBe(true);
    console.info(JSON.stringify({benchmark:'rehearsal',services:50,trackSegments:2_000,simulationSeconds:10,durationMs,
      scope:'domain performance; excludes rendering, 500-vehicle consists and device FPS'}));
  }, 60_000);
});
