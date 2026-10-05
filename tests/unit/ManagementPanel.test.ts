import { ManagementPanel, RailwayPanelActions } from '../../src/ui/ManagementPanel';
import { createManagementState } from '../../src/simulation/SimulationTypes';
import { SimulationSession } from '../../src/simulation/SimulationSession';
import { makeFirstFreightRouteWorld } from '../fixtures/FirstFreightRouteFixture';
import { emptyBlueprint, sketchPassingLoop, quoteBlueprint } from '../../src/management/BlueprintService';
import { validateBlueprintDraft, copyBlueprint } from '../../src/management/BlueprintFormat';
import { clonePlainData } from '../../src/utils/PlainData';
import { createRegionState } from '../../src/region/RegionalProjects';
import { createRiversideRegion } from '../../src/region/RiversideRegion';
import type { ServiceDefinition } from '../../src/simulation/SimulationTypes';
import { createFleetProposal, debitPurchase } from '../../src/management/RailwayPurchases';

const click=(action:string)=>{(document.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();};
const value=(name:string,v:string)=>{(document.querySelector(`[name="${name}"]`) as HTMLInputElement).value=v;};
const terrain={getHeightAt:()=>20};
afterEach(()=>{document.body.replaceChildren();});
describe('railway management actions',()=>{
  it.each(['mousedown','touchstart'])('keeps a %s on Fleet controls out of the canvas handlers while allowing navigation',event=>{
    const world=makeFirstFreightRouteWorld();world.management=createManagementState();
    const panel=new ManagementPanel({world:()=>world,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    panel.showFleet();const behindPanel=jest.fn();window.addEventListener(event,behindPanel);
    try{
      const company=document.querySelector<HTMLButtonElement>('[data-action="tab"][data-id="company"]')!;
      company.dispatchEvent(new Event(event,{bubbles:true,cancelable:true}));company.click();
      expect(behindPanel).not.toHaveBeenCalled();expect(document.querySelector('h2')?.textContent).toBe('Your railway company');
      expect(document.querySelector('[data-action="save"]')).not.toBeNull();
    }finally{window.removeEventListener(event,behindPanel);panel.destroy();}
  });
  it('focuses pressed buttons without scrolling them and reports an in-progress save',async()=>{
    const world=makeFirstFreightRouteWorld();world.management=createManagementState();
    let finishSave!:(saved:boolean)=>void;const save=jest.fn(()=>new Promise<boolean>(resolve=>{finishSave=resolve;}));
    const panel=new ManagementPanel({world:()=>world,save,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    panel.showCompany();const button=document.querySelector<HTMLButtonElement>('[data-action="save"]')!;
    const focus=jest.spyOn(button,'focus');
    const press=new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0});button.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);expect(focus).toHaveBeenCalledWith({preventScroll:true});
    expect(document.activeElement).toBe(button);button.click();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Saving world…');
    finishSave(true);await Promise.resolve();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('World saved.');
    focus.mockRestore();panel.destroy();
  });
  it('opens Fleet directly with newly built tracks and the total price including freight wagons',()=>{
    const world=makeFirstFreightRouteWorld();world.management=createManagementState();
    const panel=new ManagementPanel({world:()=>world,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    const added=clonePlainData(world.tracks[0]);added.uuid='newly-built';world.tracks.push(added);
    panel.showFleet();
    expect(document.querySelector('.rp-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-id="fleet"]')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[name="fleet-track"]')?.textContent).toContain('Track 2');
    expect(document.querySelector('[data-testid="fleet-purchase-price"]')?.textContent).toBe('£75,000');
    value('family','regional-dmu');document.querySelector('[name="family"]')!.dispatchEvent(new Event('change'));
    expect(document.querySelector('[data-testid="fleet-purchase-price"]')?.textContent).toBe('£100,000');
    expect(document.querySelector('[data-fleet-feedback] [role="status"]')?.textContent).toContain('Choose a train');
    panel.destroy();
  });
  it('shows a placement rejection without spending and preserves the choices needed to correct it',()=>{
    const world=makeFirstFreightRouteWorld();world.management=createManagementState();world.trains=[];
    const buyTrain=jest.fn((family,set,track,t)=>{
      const proposal=createFleetProposal(world,family,set,track,t);
      if(!debitPurchase(world,'vehicle-capex',proposal.price,'vehicle:'+proposal.train.id))return 'Not enough cash for this train. Choose a cheaper family.';
      world.trains.push(proposal.train);return 'Train purchased and placed. Assign its stops in Services.';
    });
    const panel=new ManagementPanel({world:()=>world,buyTrain,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    panel.showFleet();value('family','electric-freight');const before=clonePlainData(world);
    const feedback=document.querySelector('[role="status"]') as HTMLElement;feedback.scrollIntoView=jest.fn();
    click('buy');
    expect(feedback.textContent).toContain('Electrify the depot track');expect(feedback.scrollIntoView).toHaveBeenCalled();
    expect(world).toEqual(before);expect((document.querySelector('[name="family"]') as HTMLSelectElement).value).toBe('electric-freight');
    value('family','diesel-shunter');click('buy');
    expect(feedback.textContent).toContain('Train purchased');expect(world.trains).toHaveLength(1);
    expect(world.company.cash).toBe(before.company.cash-75_000);
    const purchased=clonePlainData(world);click('buy');
    expect(feedback.textContent).toContain('clear depot track');expect(world).toEqual(purchased);
    panel.destroy();
  });
  it('explains Brookford’s supplied roster when the Vehicle shortcut is requested',()=>{
    const world=makeFirstFreightRouteWorld();world.management=createManagementState();world.generationConfig.seed='riverside-brookford-v1';
    const panel=new ManagementPanel({world:()=>world,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    panel.showFleet();expect(document.querySelector('[data-id="services"]')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Brookford supplies two trains');
    expect(document.querySelector('[data-action="buy"]')).toBeNull();panel.destroy();
  });
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

describe('Riverside service timetables',()=>{
  const mount=()=>{
    const session=new SimulationSession(createRiversideRegion());
    const service=jest.fn((definition:ServiceDefinition)=>{
      const result=session.upsertService(definition);return result.ok?'Service started.':result.errors[0];
    });
    const focus=jest.fn();
    const panel=new ManagementPanel({world:()=>session.snapshot(),service,focus,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    const toggle=document.querySelector('.rp-toggle') as HTMLButtonElement;
    if(toggle.getAttribute('aria-expanded')!=='true')toggle.click();
    return {session,service,focus,panel};
  };
  const edit=(id:string)=>{(document.querySelector(`[data-action="edit-timetable"][data-id="${id}"]`) as HTMLButtonElement).click();};

  it('saves passenger timing and priority through the real session while preserving its train, stops and other service fields',()=>{
    const {session,service,panel}=mount();
    const original=session.snapshot().management.services.find(s=>s.id==='valley-local')!;
    edit(original.id);
    expect((document.querySelector('[name="edit-frequency"]') as HTMLInputElement).value).toBe('70');
    expect((document.querySelector('[name="edit-offset"]') as HTMLInputElement).value).toBe('22');
    expect(document.querySelector('[name="edit-loadRule"]')).toBeNull();
    value('edit-frequency','120');value('edit-offset','45');value('edit-priority','3');click('save-timetable');
    const expected={...original,frequencySeconds:120,departureOffsetSeconds:45,priority:3};
    expect(service).toHaveBeenCalledWith(expected);
    expect(session.snapshot().management.services.find(s=>s.id===original.id)).toEqual(expected);
    expect(document.querySelector('[name="edit-frequency"]')).toBeNull();
    expect(document.querySelector('.rp-status')!.textContent).toContain('Timetable applied');
    panel.destroy();
  });

  it('changes only the freight loading stop and keeps its unloading destination intact',()=>{
    const {session,service,panel}=mount();
    const original=session.snapshot().management.services.find(s=>s.id==='mill-goods')!;
    edit(original.id);value('edit-loadRule','available');value('edit-maxWait','25');
    value('edit-frequency','0');value('edit-offset','86400');value('edit-priority','100');click('save-timetable');
    const expected={...original,frequencySeconds:0,departureOffsetSeconds:86400,priority:100,stops:[{...original.stops[0],loadRule:'available',maxWaitSeconds:25},original.stops[1]]};
    expect(service).toHaveBeenCalledWith(expected);
    expect(session.snapshot().management.services.find(s=>s.id===original.id)).toEqual(expected);
    panel.destroy();
  });

  it('keeps active and blurred edits through clock refresh, navigation and collapse, then cancels without changing the service',()=>{
    const {session,service,panel}=mount();const original=session.snapshot().management.services;
    edit('valley-local');value('edit-frequency','180');value('edit-offset','60');
    const input=document.querySelector('[name="edit-frequency"]') as HTMLInputElement;
    input.focus();session.setSpeed(1);panel.refresh(1000,true);
    expect(input.isConnected).toBe(true);expect(input.value).toBe('180');
    input.blur();panel.refresh(2000,true);expect(input.isConnected).toBe(true);expect(input.value).toBe('180');
    (document.querySelector('[data-action="tab"][data-id="projects"]') as HTMLButtonElement).click();
    (document.querySelector('[data-action="tab"][data-id="services"]') as HTMLButtonElement).click();
    expect((document.querySelector('[name="edit-offset"]') as HTMLInputElement).value).toBe('60');
    (document.querySelector('.rp-toggle') as HTMLButtonElement).click();(document.querySelector('.rp-toggle') as HTMLButtonElement).click();
    expect((document.querySelector('[name="edit-frequency"]') as HTMLInputElement).value).toBe('180');
    click('cancel-timetable');expect(service).not.toHaveBeenCalled();expect(session.snapshot().management.services).toEqual(original);
    edit('valley-local');expect((document.querySelector('[name="edit-frequency"]') as HTMLInputElement).value).toBe('70');
    panel.destroy();
  });

  it.each([
    ['frequency','','Departure interval'],
    ['offset','-1','Departure offset'],
    ['priority','2.5','whole number'],
    ['maxWait','3601','Maximum loading wait'],
  ])('rejects invalid %s without losing the entered values or changing a service',(field,invalid,message)=>{
    const {session,service,panel}=mount();const original=session.snapshot().management.services;
    edit('mill-goods');value('edit-frequency','190');value('edit-'+field,invalid);click('save-timetable');
    expect(service).not.toHaveBeenCalled();expect(session.snapshot().management.services).toEqual(original);
    expect(document.querySelector('.rp-timetable-error')!.textContent).toContain(message);
    expect((document.querySelector(`[name="edit-${field}"]`) as HTMLInputElement).value).toBe(invalid);
    expect(document.querySelector('[name="edit-'+field+'"]')!.getAttribute('aria-invalid')).toBe('true');
    panel.refresh(1000,true);expect(document.querySelector('.rp-timetable')).not.toBeNull();
    panel.destroy();
  });

  it('keeps an editor open when the action rejects a valid timetable',()=>{
    const world=createRiversideRegion();const original=clonePlainData(world.management!.services);
    const service=jest.fn().mockReturnValue('Service could not be saved. Review its stops.');
    const panel=new ManagementPanel({world:()=>world,service,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    const toggle=document.querySelector('.rp-toggle') as HTMLButtonElement;if(toggle.getAttribute('aria-expanded')!=='true')toggle.click();
    edit('valley-local');value('edit-frequency','190');click('save-timetable');
    expect(service).toHaveBeenCalledTimes(1);expect(world.management!.services).toEqual(original);
    expect(document.querySelector('.rp-timetable-error')!.textContent).toContain('could not be saved');
    expect((document.querySelector('[name="edit-frequency"]') as HTMLInputElement).value).toBe('190');
    panel.destroy();
  });

  it('shows the real paused obstruction and focuses a blocking train only when the reference identifies a train',()=>{
    const world=createRiversideRegion(),focus=jest.fn();
    const reason={code:'track-occupied' as const,message:'Mill goods occupies the route to the next stop.',remedy:'Adjust departure times or build a separate route.',relatedEntityId:'brookford-freight'};
    world.management!.serviceStates['valley-local'].stoppedReason=reason;
    const panel=new ManagementPanel({world:()=>world,focus,cancelRehearsal:jest.fn()} as unknown as RailwayPanelActions);
    const toggle=document.querySelector('.rp-toggle') as HTMLButtonElement;if(toggle.getAttribute('aria-expanded')!=='true')toggle.click();
    expect(document.querySelector('.rp-body')!.textContent).toContain('Paused · Mill goods occupies');
    expect(document.querySelector('.rp-body')!.textContent).toContain(reason.remedy);
    expect(document.querySelector('.rp-body')!.textContent).not.toContain('brookford-freight');
    click('focus-blocking-train');expect(focus).toHaveBeenCalledWith('brookford-freight');
    reason.relatedEntityId='river-single';panel.refresh(1000,true);
    expect(document.querySelector('[data-action="focus-blocking-train"]')).toBeNull();
    panel.destroy();
  });
});
