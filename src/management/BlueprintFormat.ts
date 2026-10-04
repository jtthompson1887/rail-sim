import type { WorldData } from '../config/WorldData';
import type { BlueprintDraft } from '../simulation/SimulationTypes';
import { clonePlainData } from '../utils/PlainData';
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const safe=(v:unknown):v is number=>finite(v)&&Number.isSafeInteger(v)&&v>=0;
const fraction=(v:unknown):v is number=>finite(v)&&v>=0&&v<=1;
const unique=(items:Record<string,any>[],key:string)=>new Set(items.map(i=>i[key])).size===items.length;
/** Validate a local file completely before replacing an editable draft or saving it. */
export function validateBlueprintDraft(value:unknown):value is BlueprintDraft{
  if(!record(value)||value.blueprintVersion!==1||!id(value.id)||!id(value.name)||!id(value.sourceWorldId)||!safe(value.sourceRevision)||!safe(value.constructionCost))return false;
  for(const [key,max]of [['tracks',2000],['junctions',500],['stations',200],['trains',200],['services',200]] as const)if(!Array.isArray(value[key])||value[key].length>max||!value[key].every(record))return false;
  if(value.tracks.some((t:any)=>!id(t.uuid)||t.geometryVersion!==1||['p0','p1','p2','p3'].some(p=>!record(t[p])||!finite(t[p].x)||!finite(t[p].y))||!record(t.verticalProfile)||t.verticalProfile.profileVersion!==1||!Array.isArray(t.verticalProfile.knots)||t.verticalProfile.knots.length<2||t.verticalProfile.knots.length>8192||t.verticalProfile.knots.some((k:any)=>!record(k)||!fraction(k.t)||!finite(k.elevation))||!Array.isArray(t.structures)||t.structures.length>8192||t.structures.some((s:any)=>!record(s)||!['surface','cut','fill','bridge','tunnel'].includes(s.type)||!fraction(s.startT)||!fraction(s.endT)||!finite(s.startElevation)||!finite(s.endElevation))||!safe(t.paidBuildCost)||(t.electrified!==undefined&&typeof t.electrified!=='boolean')))return false;
  if(value.junctions.some((j:any)=>!id(j.uuid)||!id(j.mainTrackUUID)||!id(j.leftTrackUUID)||!id(j.rightTrackUUID)||!fraction(j.position)||!['left','right'].includes(j.branchState)))return false;
  if(value.stations.some((s:any)=>!id(s.id)||!id(s.name)||!id(s.trackUUID)||!fraction(s.trackT)||!finite(s.passengerSpawnRate)||s.passengerSpawnRate<0||(s.platformLengthMetres!==undefined&&(!safe(s.platformLengthMetres)||s.platformLengthMetres<30||s.platformLengthMetres>300))))return false;
  if(value.trains.some((t:any)=>!id(t.id)||!id(t.freightSetId)||!id(t.vehicleFamilyId)||!id(t.trackUUID)||!fraction(t.trackT)||![1,-1].includes(t.facing)||!record(t.operations)||!record(t.dynamics)))return false;
  if(value.services.some((s:any)=>!id(s.id)||!id(s.name)||!id(s.trainId)||!['freight','passenger'].includes(s.kind)||typeof s.enabled!=='boolean'||!finite(s.frequencySeconds)||s.frequencySeconds<0||!finite(s.departureOffsetSeconds)||s.departureOffsetSeconds<0||!finite(s.priority)||s.priority<0||!Array.isArray(s.stops)||s.stops.length<2||s.stops.length>20||s.stops.some((stop:any)=>!record(stop)||!id(stop.targetId)||!['facility','station'].includes(stop.targetKind)||!['available','full','unload','none'].includes(stop.loadRule)||!finite(stop.maxWaitSeconds)||stop.maxWaitSeconds<0||stop.maxWaitSeconds>3600)))return false;
  if(!unique(value.tracks,'uuid')||!unique(value.junctions,'uuid')||!unique(value.stations,'id')||!unique(value.trains,'id')||!unique(value.services,'id'))return false;
  return value.removedTrackIds===undefined||(Array.isArray(value.removedTrackIds)&&value.removedTrackIds.every(id));
}
/** Keep every internal reference consistent when a blueprint becomes a fresh local copy. */
export function copyBlueprint(source:BlueprintDraft,world:Pick<WorldData,'id'|'revision'>):BlueprintDraft{
  if(!validateBlueprintDraft(source))throw new Error('Choose a complete version 1 railway blueprint.');
  const result=clonePlainData(source);const tracks=new Map(source.tracks.map(t=>[t.uuid,crypto.randomUUID()])),stations=new Map(source.stations.map(s=>[s.id,crypto.randomUUID()])),trains=new Map(source.trains.map(t=>[t.id,crypto.randomUUID()]));
  result.id=crypto.randomUUID();result.sourceWorldId=world.id;result.sourceRevision=world.revision;
  result.tracks.forEach(t=>t.uuid=tracks.get(t.uuid)!);
  result.junctions.forEach(j=>{j.uuid=crypto.randomUUID();for(const key of ['mainTrackUUID','leftTrackUUID','rightTrackUUID'] as const)j[key]=tracks.get(j[key])??j[key];});
  result.stations.forEach(s=>{s.id=stations.get(s.id)!;s.trackUUID=tracks.get(s.trackUUID)??s.trackUUID;});
  result.trains.forEach(t=>{t.id=trains.get(t.id)!;t.trackUUID=tracks.get(t.trackUUID)??t.trackUUID;if(t.dynamics.mode==='on-rail'){t.dynamics.trackUUID=t.trackUUID;t.dynamics.consistId='consist-'+t.id;}});
  result.services.forEach(s=>{s.id=crypto.randomUUID();s.trainId=trains.get(s.trainId)??s.trainId;s.stops.forEach(stop=>{if(stop.targetKind==='station')stop.targetId=stations.get(stop.targetId)??stop.targetId;});});
  return result;
}
