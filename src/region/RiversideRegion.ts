import { createEmptyWorld, type WorldData, type TrackDef, type TrainDef, type StarterOpportunityDef } from '../config/WorldData';
import { WorldGenerationConfig } from '../config/WorldGeneration';
import { getFacilityDefinition } from '../economy/ProductCatalog';
import { LAUNCH_PRODUCTS } from '../economy/InitialEconomyContent';
import { createManagementState, createServiceRuntimeState, type ServiceDefinition, type BlueprintDraft } from '../simulation/SimulationTypes';
import { createRegionState, acceptProject, connectProjectStation } from './RegionalProjects';
import { TrackArcLengthIndex } from '../physics/TrackArcLengthIndex';
import { ENDPOINT_CONNECTION_COST } from '../config/ConstructionConfig';
import { emptyBlueprint } from '../management/BlueprintService';
import { createCompanyState } from '../economy/FinanceLedger';

export const RIVERSIDE_SEED = 'riverside-brookford-v1';
export const isRiverside = (world: Pick<WorldData, 'generationConfig'> | null | undefined): boolean => world?.generationConfig.seed === RIVERSIDE_SEED;
export const riverCentre = (x: number): number => 2700 + 180 * Math.sin(x / 1100);

/** This authored valley is also the construction heightmap, not painted water over dry ground. */
export function riversideHeight(x: number, y: number): number {
  const distance = Math.abs(y - riverCentre(x));
  if (distance < 150) return -18;
  if (distance < 250) return -18 + (distance - 150) * .36;
  return 18 + Math.max(0, 800 - y) * .045;
}

function rail(uuid: string, x1: number, y1: number, x2: number, y2: number): TrackDef {
  return { uuid, geometryVersion: 1, p0: {x:x1,y:y1}, p1:{x:x1+(x2-x1)/3,y:y1}, p2:{x:x2-(x2-x1)/3,y:y2}, p3:{x:x2,y:y2},
    verticalProfile:{profileVersion:1,knots:[{t:0,elevation:18},{t:1,elevation:18}]},
    structures:[{type:'surface',startT:0,endT:1,startElevation:18,endElevation:18}],paidBuildCost:0 };
}

/** Split the authored platform curves without moving their station or train positions. */
function railSection(uuid: string, original: TrackDef, start: number, end: number): TrackDef {
  const point=(t:number)=>{
    const s=1-t;
    return {x:s*s*s*original.p0.x+3*s*s*t*original.p1.x+3*s*t*t*original.p2.x+t*t*t*original.p3.x,
      y:s*s*s*original.p0.y+3*s*s*t*original.p1.y+3*s*t*t*original.p2.y+t*t*t*original.p3.y};
  };
  const tangent=(t:number)=>({x:3*(1-t)**2*(original.p1.x-original.p0.x)+6*(1-t)*t*(original.p2.x-original.p1.x)+3*t*t*(original.p3.x-original.p2.x),
    y:3*(1-t)**2*(original.p1.y-original.p0.y)+6*(1-t)*t*(original.p2.y-original.p1.y)+3*t*t*(original.p3.y-original.p2.y)});
  const p0=point(start),p3=point(end),a=tangent(start),b=tangent(end),span=(end-start)/3;
  return {...rail(uuid,p0.x,p0.y,p3.x,p3.y),p1:{x:p0.x+a.x*span,y:p0.y+a.y*span},p2:{x:p3.x-b.x*span,y:p3.y-b.y*span}};
}

/** A real northern bypass of both shared throats, purchased through the normal blueprint flow. */
export function createRiversideReliefDraft(world: WorldData): BlueprintDraft {
  if(!isRiverside(world))throw new Error('Choose the Brookford region for the northern relief line.');
  const west=world.tracks.find(track=>track.uuid==='west-passenger-approach');
  const east=world.tracks.find(track=>track.uuid==='east-passenger-approach');
  if(!west||!east)throw new Error('The northern relief line needs its original passenger approaches.');
  const draft=emptyBlueprint(world,'Northern relief line');
  const start=west.p3,end=east.p0,y=1850,entryEnd=start.x+600,exitStart=end.x-600;
  const entry=rail(`${draft.id}:north-entry`,start.x,start.y,entryEnd,y);
  entry.p1={x:start.x+200,y:start.y+200*(west.p3.y-west.p2.y)/(west.p3.x-west.p2.x)};
  const standing=rail(`${draft.id}:north-line`,entryEnd,y,exitStart,y);
  const exit=rail(`${draft.id}:north-exit`,exitStart,y,end.x,end.y);
  exit.p2={x:end.x-200,y:end.y-200*(east.p1.y-east.p0.y)/(east.p1.x-east.p0.x)};
  draft.tracks=[entry,standing,exit];
  draft.junctions=[{uuid:`${draft.id}:north-west`,mainTrackUUID:west.uuid,leftTrackUUID:entry.uuid,rightTrackUUID:'west-passenger-link',position:1,branchState:'right'},
    {uuid:`${draft.id}:north-east`,mainTrackUUID:east.uuid,leftTrackUUID:exit.uuid,rightTrackUUID:'east-passenger-link',position:0,branchState:'right'}];
  return draft;
}

function opportunity(): StarterOpportunityDef {
  const track=rail('survey',850,2150,5200,2150);
  const costs={track:26000,earthworks:0,bridge:0,tunnel:0,total:26000};
  const detour=[rail('survey-a',850,2150,3000,1450),rail('survey-b',3000,1450,5200,2150)];
  return {opportunityVersion:1,resolvedAttempt:1,
    sites:[{id:'mill',label:'Brookford Mill',x:850,y:2150,footprintRadius:WorldGenerationConfig.SITE_FOOTPRINT_RADIUS},
      {id:'town',label:'Brookford Goods Yard',x:5200,y:2150,footprintRadius:WorldGenerationConfig.SITE_FOOTPRINT_RADIUS}],
    corridors:[{id:'valley',waypoints:[track.p0,track.p3],estimatedCost:costs.total,dominantTradeoff:'short-steep',
      feasibilityWitness:{witnessVersion:1,segments:[{geometry:track,verticalProfile:track.verticalProfile,structures:track.structures,costs,topologyCost:0}],totalCost:costs.total}},
      {id:'riverside',waypoints:[detour[0].p0,detour[0].p3,detour[1].p3],estimatedCost:52000+ENDPOINT_CONNECTION_COST,dominantTradeoff:'long-flat',
      feasibilityWitness:{witnessVersion:1,segments:detour.map((t,i)=>({geometry:t,verticalProfile:t.verticalProfile,structures:t.structures,costs,topologyCost:i===0?0:ENDPOINT_CONNECTION_COST})),totalCost:52000+ENDPOINT_CONNECTION_COST}}],
    recommendedCamera:{x:3150,y:1950,zoom:.34}};
}

function vehicle(id: string, track: TrackDef, t: number, family: string): TrainDef {
  const distance=new TrackArcLengthIndex(track,4).distanceAtParameter(t);
  return {id,trackUUID:track.uuid,trackT:t,facing:1,freightSetId:'flatbed-freight-set',vehicleFamilyId:family,livery:'#265e58',cargo:null,
    dynamics:{mode:'on-rail',trackUUID:track.uuid,distance,direction:1,speedMps:0,consistId:`consist-${id}`,consistOrder:0},
    operations:{currentTripRevenue:0,currentTripRunningCost:0,lastTripRevenue:0,lastTripRunningCost:0,lifetimeDeliveredUnits:0,lifetimeRevenue:0,lifetimeRunningCost:0}};
}

/** A starting railway, finite contract stock and two real services. No project progress is pre-awarded. */
export function createRiversideRegion(): WorldData {
  const world=createEmptyWorld('Brookford · A railway by the river',RIVERSIDE_SEED,'temperate',opportunity());
  world.company=createCompanyState(65000);
  world.generationConfig.landscapePreset='lowlands';
  world.generationConfig.gameDifficulty='standard';
  world.companyStyle={name:'Brookford Railway',colour:'#265e58'};
  const westPlatform=rail('west-platform',450,1650,2000,2000),eastPlatform=rail('town-platform',3800,2000,5700,1650);
  world.tracks=[rail('mill-siding',450,2150,2000,2000),railSection('west-platform',westPlatform,0,.5),
    rail('river-single',2000,2000,3800,2000),railSection('town-platform',eastPlatform,.5,1),rail('goods-siding',3800,2000,5700,2150),
    railSection('west-passenger-approach',westPlatform,.5,.65),railSection('west-passenger-link',westPlatform,.65,1),
    railSection('east-passenger-link',eastPlatform,0,.35),railSection('east-passenger-approach',eastPlatform,.35,.5)];
  // The two end throats have real connections; central single track is the visible capacity constraint.
  world.junctions=[{uuid:'west-throat',mainTrackUUID:'river-single',leftTrackUUID:'mill-siding',rightTrackUUID:'west-passenger-link',position:0,branchState:'left'},
    {uuid:'east-throat',mainTrackUUID:'river-single',leftTrackUUID:'goods-siding',rightTrackUUID:'east-passenger-link',position:1,branchState:'left'}];
  const location=(track:TrackDef,t:number)=>new TrackArcLengthIndex(track,4).poseAtDistance(new TrackArcLengthIndex(track,4).distanceAtParameter(t)).point;
  world.economy.facilities=['prefabrication-plant','town-construction-market'].map((id,i)=>{
    const definition=getFacilityDefinition(id)!;
    const p=location(world.tracks[i===0?0:4],i===0?.3:.75);
    return {id,definitionId:id,name:i===0?'Brookford Mill & Timber Works':'Brookford Goods Yard',x:p.x,y:p.y,railAccess:{...p,radius:70},
      inventories:Object.fromEntries(definition.inventory.map(slot=>[slot.productId,{productId:slot.productId,quantity:i===0&&slot.productId==='building-modules'?80:0,
        reservedQuantity:0,capacity:slot.capacity,targetStock:slot.targetStock,recentInflow:0,recentOutflow:0}])),activeRecipeId:definition.recipeIds[0]??null,recipeProgressTicks:0};
  });
  for(const product of LAUNCH_PRODUCTS)world.economy.market.regionalDemandBpsByProduct[product.id]=10000;
  world.trains=[vehicle('brookford-freight',world.tracks[0],.3,'mixed-diesel'),vehicle('brookford-passenger',world.tracks[1],.6,'regional-dmu')];
  world.stations=[{id:'mill-halt',name:'Mill Lane',trackUUID:'west-platform',trackT:.6,passengerSpawnRate:12,platformLengthMetres:60},
    {id:'brookford',name:'Brookford',trackUUID:'town-platform',trackT:.5,passengerSpawnRate:8,platformLengthMetres:60}];
  const stops=(a:string,b:string,kind:'freight'|'passenger'):ServiceDefinition['stops']=>[{targetId:a,targetKind:kind==='freight'?'facility':'station',loadRule:kind==='freight'?'full':'none',maxWaitSeconds:14},
    {targetId:b,targetKind:kind==='freight'?'facility':'station',loadRule:kind==='freight'?'unload':'none',maxWaitSeconds:14}];
  world.management=createManagementState();
  world.management.speed=0;
  world.management.services=[{id:'mill-goods',name:'Mill goods',trainId:'brookford-freight',kind:'freight',stops:stops('prefabrication-plant','town-construction-market','freight'),frequencySeconds:95,departureOffsetSeconds:0,priority:1,enabled:true},
    {id:'valley-local',name:'Valley local',trainId:'brookford-passenger',kind:'passenger',stops:stops('mill-halt','brookford','passenger'),frequencySeconds:70,departureOffsetSeconds:22,priority:2,enabled:true}];
  world.management.serviceStates=Object.fromEntries(world.management.services.map(s=>[s.id,createServiceRuntimeState()]));
  world.region=connectProjectStation(acceptProject(createRegionState(world),'housing'),'housing','brookford');
  world.blueprints=[];
  // Fixed groves and riverside trees deliberately leave track approaches and the future loop clear.
  let random=781;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/4294967296;};
  for(const [cx,cy,count,radius] of [[800,700,55,510],[2600,580,64,560],[5900,1100,55,470],[3100,3550,60,650],[900,3360,30,340]]){
    for(let i=0;i<count;i++){const angle=next()*Math.PI*2,r=Math.sqrt(next())*radius;world.scenery.push({id:`grove-${world.scenery.length}`,type:next()>.3?'tree_oak':'tree_birch',x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r,rotation:0,scale:(1.4+next()*1.3)*.65,variant:i%3});}
  }
  for(let x=200;x<6200;x+=135){const y=riverCentre(x)-300-next()*80;world.scenery.push({id:`bank-${x}`,type:'tree_oak',x,y,rotation:0,scale:(1.1+next())*.65,variant:0});}
  return world;
}
