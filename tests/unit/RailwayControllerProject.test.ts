import { RailwayController } from '../../src/management/RailwayController';
import { WorldManager } from '../../src/managers/WorldManager';
import { createManagementState } from '../../src/simulation/SimulationTypes';
import { createRegionState } from '../../src/region/RegionalProjects';
import { clonePlainData } from '../../src/utils/PlainData';
import { makeFirstFreightRouteWorld } from '../fixtures/FirstFreightRouteFixture';

function controllerFixture(){
  const world=makeFirstFreightRouteWorld();world.management=createManagementState();world.region=createRegionState(world);
  const project=world.region.projects.find(p=>p.definitionId==='housing')!;
  project.anchorFacilityId=world.economy.facilities[0].id;project.x=0;project.y=0;
  const remote=clonePlainData(world.tracks[0]);remote.uuid='remote-track';
  for(const key of ['p0','p1','p2','p3'] as const)remote[key].x+=4_000;
  world.tracks.push(remote);world.stations=[
    {id:'local',name:'Town',trackUUID:world.tracks[0].uuid,trackT:.5,platformLengthMetres:30,passengerSpawnRate:8},
    {id:'remote',name:'Distant',trackUUID:remote.uuid,trackT:.5,platformLengthMetres:30,passengerSpawnRate:8},
    {id:'unlocatable',name:'Orphan',trackUUID:'absent',trackT:.5,platformLengthMetres:30,passengerSpawnRate:8},
  ];
  jest.spyOn(WorldManager,'world','get').mockReturnValue(world);
  const controller=Object.create(RailwayController.prototype) as any;
  controller.mutate=jest.fn((change:(candidate:typeof world)=>boolean)=>change(world));
  return {world,project,controller};
}

afterEach(()=>jest.restoreAllMocks());
describe('project passenger station acceptance boundary',()=>{
  it.each([
    ['remote','within 120 metres'],
    ['absent','existing passenger station'],
    ['unlocatable','Reconnect its track'],
  ])('rejects %s before accepting a project or mutating its state',(id,message)=>{
    const {world,controller}=controllerFixture(),before=clonePlainData(world);
    expect(controller.project('housing',id)).toContain(message);
    expect(controller.mutate).not.toHaveBeenCalled();expect(world).toEqual(before);
  });
  it('accepts a local platform and preserves its binding on subsequent updates',()=>{
    const {controller,project}=controllerFixture();
    expect(controller.project('housing','local')).toContain('Project accepted');
    // Acceptance replaces the detached region; inspect its current project, not the old object.
    const housing=()=>WorldManager.world!.region!.projects.find(p=>p.definitionId==='housing')!;
    expect(project.accepted).toBe(false);expect(housing()).toMatchObject({accepted:true,stationId:'local'});
    expect(controller.project('housing','local')).toContain('Project accepted');
    expect(housing()).toMatchObject({accepted:true,stationId:'local'});
    expect(controller.project('housing',null)).toContain('Project accepted');
    expect(housing()).toMatchObject({accepted:true,stationId:null});
  });
});
