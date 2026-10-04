import { ManagementPanel, RailwayPanelActions } from '../../src/ui/ManagementPanel';
import { createManagementState } from '../../src/simulation/SimulationTypes';
import { SimulationSession } from '../../src/simulation/SimulationSession';
import { makeFirstFreightRouteWorld } from '../fixtures/FirstFreightRouteFixture';
import { emptyBlueprint, sketchPassingLoop, quoteBlueprint } from '../../src/management/BlueprintService';
import { validateBlueprintDraft, copyBlueprint } from '../../src/management/BlueprintFormat';
import { clonePlainData } from '../../src/utils/PlainData';
import { createRegionState } from '../../src/region/RegionalProjects';

const click=(action:string)=>{(document.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();};
const value=(name:string,v:string)=>{(document.querySelector(`[name="${name}"]`) as HTMLInputElement).value=v;};
const terrain={getHeightAt:()=>20};
afterEach(()=>{document.body.replaceChildren();});
describe('railway management actions',()=>{
  it('offers only local project stations and preserves an accepted station when refreshing and updating',()=>{
    const world=makeFirstFreightRouteWorld();world.management=createManagementState();world.region=createRegionState(world);
    const project=world.region.projects.find(p=>p.definitionId==='housing')!;
    project.x=0;project.y=0;project.accepted=true;project.stationId='local';
    const remote=clonePlainData(world.tracks[0]);remote.uuid='remote-track';
    for(const key of ['p0','p1','p2','p3'] as const)remote[key].x+=4_000;
    world.tracks.push(remote);world.stations=[
      {id:'local',name:'Town platform',trackUUID:world.tracks[0].uuid,trackT:.5,platformLengthMetres:30,passengerSpawnRate:8},
      {id:'remote',name:'Distant platform',trackUUID:remote.uuid,trackT:.5,platformLengthMetres:30,passengerSpawnRate:8},
      {id:'missing-track',name:'Disconnected platform',trackUUID:'absent',trackT:.5,platformLengthMetres:30,passengerSpawnRate:8},
    ];
    const acceptProject=jest.fn().mockReturnValue('Updated');
    const panel=new ManagementPanel({world:()=>world,acceptProject,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    (document.querySelector('.rp-head button') as HTMLButtonElement).click();
    (document.querySelector('[data-action="tab"][data-id="projects"]') as HTMLButtonElement).click();
    const choices=()=>document.querySelector('[name="project-housing"]') as HTMLSelectElement;
    expect([...choices().options].map(o=>o.value)).toEqual(['','local']);
    expect(choices().value).toBe('local');
    expect(choices().options[0].text).toBe('Nearby arrivals');
    panel.refresh(1000,true);expect(choices().value).toBe('local');
    (document.querySelector('[data-action="project"][data-id="housing"]') as HTMLButtonElement).click();
    expect(acceptProject).toHaveBeenCalledWith('housing','local');expect(choices().value).toBe('local');
    project.stationId=null;panel.refresh(2000,true);expect(choices().value).toBe('');
    (document.querySelector('[data-action="project"][data-id="housing"]') as HTMLButtonElement).click();
    expect(acceptProject).toHaveBeenLastCalledWith('housing',null);
    panel.destroy();
  });
  it('keeps a paused service draft and navigation buttons stable after focus leaves its form',()=>{
    const world=makeFirstFreightRouteWorld();world.management=createManagementState();world.management.speed=0;
    const panel=new ManagementPanel({world:()=>world,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    (document.querySelector('.rp-head button') as HTMLButtonElement).click();
    value('service-name','Hillside shuttle');
    const name=document.querySelector('[name="service-name"]') as HTMLInputElement;
    const plans=document.querySelector('[data-action="tab"][data-id="plans"]');
    name.blur();panel.refresh(1000);panel.refresh(2000);
    expect(name.isConnected).toBe(true);expect(name.value).toBe('Hillside shuttle');expect(plans!.isConnected).toBe(true);
    panel.destroy();
  });
  it('creates a real freight shuttle with unloading defaults; repeated clock refresh preserves a focused form',async()=>{
    const world=makeFirstFreightRouteWorld();world.management=createManagementState();const session=new SimulationSession(world);
    const actions={world:()=>session.snapshot(),speed:s=>session.setSpeed(s),service:s=>{const result=session.upsertService(s);return result.ok?'Started':result.errors[0];},cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions;
    const panel=new ManagementPanel(actions);(document.querySelector('.rp-head button') as HTMLButtonElement).click();
    value('service-name','Forest shuttle');value('stop-0','facility:managed-forest');value('stop-1','facility:sawmill');
    const input=document.querySelector('[name="service-name"]') as HTMLInputElement;input.focus();panel.refresh(1000);expect(input.isConnected).toBe(true);expect(input.value).toBe('Forest shuttle');
    click('create-service');await Promise.resolve();const service=session.snapshot().management.services[0];expect(service.stops[0].loadRule).toBe('available');expect(service.stops[1].loadRule).toBe('unload');
    for(let i=0;i<400;i++)session.advance(250);
    expect(session.snapshot().trains[0].operations.lifetimeDeliveredUnits).toBeGreaterThan(0);expect(session.snapshot().company.ledger.some(e=>e.category==='delivery-revenue')).toBe(true);
    panel.destroy();expect(actions.cancelRehearsal).toHaveBeenCalled();
  });
  it('keeps malformed local files out of editable and persisted blueprint state',()=>{
    expect(validateBlueprintDraft({blueprintVersion:1,tracks:[],services:[]})).toBe(false);
    const world=makeFirstFreightRouteWorld(),draft=emptyBlueprint(world);expect(validateBlueprintDraft(draft)).toBe(true);
    for(const key of ['tracks','junctions','stations','trains','services']){const bad=clonePlainData(draft) as any;bad[key]=[null];expect(validateBlueprintDraft(bad)).toBe(false);expect(()=>copyBlueprint(bad,world)).toThrow('complete version');}
  });
  it('copies a combined passing-loop blueprint without broken internal train, station, service or junction references',()=>{
    const world=makeFirstFreightRouteWorld();world.tracks=[];world.trains=[];
    const loop=sketchPassingLoop(world,terrain,{x:0,y:0},{x:4000,y:0});if(loop.ok===false)throw new Error(loop.message);const d=loop.draft,track=d.tracks[0];
    d.stations.push({id:'planned-station',name:'New',trackUUID:track.uuid,trackT:.5,passengerSpawnRate:8,platformLengthMetres:30});
    const train=makeFirstFreightRouteWorld().trains[0];train.id='planned-train';train.vehicleFamilyId='regional-dmu';train.trackUUID=track.uuid;train.dynamics={mode:'on-rail',trackUUID:track.uuid,distance:200,direction:1,speedMps:0,consistId:'consist-planned',consistOrder:0};d.trains.push(train);
    d.services.push({id:'planned-service',name:'New',trainId:train.id,kind:'passenger',stops:[{targetId:'planned-station',targetKind:'station',loadRule:'none',maxWaitSeconds:30},{targetId:'other-existing',targetKind:'station',loadRule:'none',maxWaitSeconds:30}],frequencySeconds:0,departureOffsetSeconds:0,priority:1,enabled:true});
    const copied=copyBlueprint(d,world),ids=new Set(copied.tracks.map(t=>t.uuid));expect(copied.id).not.toBe(d.id);expect(d.tracks[0].uuid).toBe(track.uuid);
    copied.junctions.forEach(j=>[j.mainTrackUUID,j.leftTrackUUID,j.rightTrackUUID].forEach(id=>expect(ids.has(id)).toBe(true)));
    expect(ids.has(copied.trains[0].trackUUID)).toBe(true);expect(copied.trains[0].dynamics).toMatchObject({trackUUID:copied.trains[0].trackUUID});expect(copied.services[0].trainId).toBe(copied.trains[0].id);expect(copied.services[0].stops[0].targetId).toBe(copied.stations[0].id);expect(copied.services[0].stops[1].targetId).toBe('other-existing');
  });
});
