import { WorldManager } from '../../src/managers/WorldManager';
import { SimulationSession } from '../../src/simulation/SimulationSession';
import type { ServiceDefinition } from '../../src/simulation/SimulationTypes';
import { emptyBlueprint, quoteBlueprint, applyBlueprintPurchase } from '../../src/management/BlueprintService';
import { prepareRehearsalWorld } from '../../src/simulation/Rehearsal';
import { validateWorldData } from '../../src/config/WorldData';
import { clonePlainData } from '../../src/utils/PlainData';
import { makeFirstFreightRouteWorld } from '../fixtures/FirstFreightRouteFixture';

const service: ServiceDefinition={id:'timber',name:'Timber',trainId:'train-1',kind:'freight',
  stops:[{targetId:'managed-forest',targetKind:'facility',loadRule:'available',maxWaitSeconds:30},
    {targetId:'sawmill',targetKind:'facility',loadRule:'unload',maxWaitSeconds:30}],
  frequencySeconds:0,departureOffsetSeconds:0,priority:1,enabled:true};
const running=()=>{
  const session=new SimulationSession(makeFirstFreightRouteWorld());
  expect(session.upsertService(service).ok).toBe(true);
  for(let i=0;i<24;i++)session.advance(250);
  return session;
};

afterEach(()=>{WorldManager.reset();});
describe('authoritative railway integration boundaries',()=>{
  it('installs a valid session atomically while rejecting stale, altered construction and unbalanced money',()=>{
    const session=running(),world=clonePlainData(session.snapshot());
    (WorldManager as any)._world=world;
    const expected=world.revision;session.advance(250);const next=session.snapshot();
    expect(WorldManager.applySimulationSnapshot(expected,next)).toBe(true);
    expect(WorldManager.world).toBe(world);expect(world).toEqual(next);
    const installed=clonePlainData(world);
    expect(WorldManager.applySimulationSnapshot(expected,next)).toBe(false);
    const money=clonePlainData(next);money.company.cash++;
    expect(WorldManager.applySimulationSnapshot(world.revision,money)).toBe(false);
    const geometry=clonePlainData(next);geometry.tracks[0].p1.y++;
    expect(WorldManager.applySimulationSnapshot(world.revision,geometry)).toBe(false);
    expect(world).toEqual(installed);
    expect(WorldManager.applyManagementChange(world.revision,candidate=>{candidate.company.cash++;return true;})).toBe(false);
    expect(world).toEqual(installed);
  });

  it('commits a draft service edit with exactly the same stopped train and cargo as its rehearsal',()=>{
    const session=running(),world=clonePlainData(session.snapshot());
    expect(world.trains[0].dynamics.mode).toBe('on-rail');
    if(world.trains[0].dynamics.mode==='on-rail')expect(world.trains[0].dynamics.speedMps).toBeGreaterThan(0);
    const draft=emptyBlueprint(world);draft.services.push({...service,name:'Reviewed timber'});
    const quote=quoteBlueprint(world,draft,{getHeightAt:()=>20});expect(quote.errors).toEqual([]);
    const rehearsed=prepareRehearsalWorld({requestId:'parity',world,draft:quote.draft});expect(rehearsed.errors).toEqual([]);
    expect(applyBlueprintPurchase(world,quote)).toBe(true);
    expect(world.trains).toEqual(rehearsed.world.trains);
    expect(world.management).toEqual(rehearsed.world.management);
    expect(world.company).toEqual(rehearsed.world.company);
    expect(validateWorldData(world).compatible).toBe(true);
  });

  it('rejects a corrupt stop cursor or missing own runtime before opening an imported world',()=>{
    const valid=running().snapshot(),bad=clonePlainData(valid);
    bad.management.serviceStates.timber.nextStopIndex=service.stops.length;
    expect(validateWorldData(bad).compatible).toBe(false);
    const missing=clonePlainData(valid);delete missing.management.serviceStates.timber;
    expect(validateWorldData(missing).compatible).toBe(false);
  });
});
