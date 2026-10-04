import type { TrackDef, WorldData } from '../config/WorldData';
import type { BlueprintDraft } from '../simulation/SimulationTypes';
import { ConstructionAnalyzer } from '../systems/ConstructionAnalyzer';
import type { TerrainHeightSource } from '../systems/ConstructionAnalyzer';
import { deriveAutomaticCubic } from '../systems/TrackGeometry';
import { sampleConstructionCurve } from '../systems/ConstructionCurveSampler';
import { hasConstructionClearance, isValidClearanceTurnout, type ClearanceTrack, type ClearanceTurnout } from '../systems/TrackClearance';
import { ENDPOINT_CONNECTION_COST } from '../config/ConstructionConfig';
import { postLedgerEntry } from '../economy/FinanceLedger';
import { clonePlainData } from '../utils/PlainData';
import { fitPassingLoop } from './RailwayTemplates';
import { createFleetProposal, createPlatformProposal, debitPurchase } from './RailwayPurchases';
import { SimulationSession } from '../simulation/SimulationSession';
import { validateWorldData } from '../config/WorldData';
import { validateBlueprintDraft } from './BlueprintFormat';
import { TrackArcLengthIndex } from '../physics/TrackArcLengthIndex';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';

export function emptyBlueprint(world: WorldData, name = 'My railway improvement'): BlueprintDraft {
  return { blueprintVersion: 1, id: crypto.randomUUID(), name, sourceWorldId: world.id,
    sourceRevision: world.revision, tracks: [], junctions: [], stations: [], trains: [], services: [], constructionCost: 0 };
}

/** Detached geometry editing. No quotes, money, live rails or saves change while drawing. */
export function transformBlueprint(draft: BlueprintDraft, angle: number, x: number, y: number): BlueprintDraft {
  const result = clonePlainData(draft);
  const origin = draft.tracks[0]?.p0 ?? { x: 0, y: 0 };
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (const track of result.tracks) {
    for (const key of ['p0', 'p1', 'p2', 'p3'] as const) {
      const dx = track[key].x - origin.x, dy = track[key].y - origin.y;
      track[key] = { x: origin.x + x + dx * cos - dy * sin, y: origin.y + y + dx * sin + dy * cos };
    }
  }
  return result;
}

export function sketchConnection(world: WorldData, terrain: TerrainHeightSource,
  start: { x: number; y: number }, end: { x: number; y: number }, bend = 0): BlueprintDraft {
  const draft = emptyBlueprint(world);
  const geometry = deriveAutomaticCubic({ start, end });
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const normal = { x: -(end.y - start.y) / Math.max(1, length), y: (end.x - start.x) / Math.max(1, length) };
  geometry.p1.x += normal.x * bend; geometry.p1.y += normal.y * bend;
  geometry.p2.x += normal.x * bend; geometry.p2.y += normal.y * bend;
  const proposal = new ConstructionAnalyzer(terrain).analyze(geometry);
  draft.tracks.push({ uuid: crypto.randomUUID(), ...geometry, verticalProfile: proposal.verticalProfile,
    structures: proposal.structures, paidBuildCost: proposal.costs.total });
  return draft;
}

export type BlueprintQuote = { valid: boolean; draft: BlueprintDraft; errors: string[]; totalCost: number; cashAfter: number; stationCost: number; vehicleCost: number };
const issuedQuotes = new WeakMap<BlueprintQuote, { quote: string; construction: string }>();
const constructionState = (world: WorldData): string => JSON.stringify({ id: world.id, revision: world.revision, tracks: world.tracks, junctions: world.junctions, trains: world.trains, company: world.company });

export function sketchPassingLoop(world: WorldData, terrain: TerrainHeightSource, start: { x: number; y: number }, end: { x: number; y: number }, side: 1 | -1 = 1): { ok: true; draft: BlueprintDraft } | { ok: false; message: string } {
  const draft = emptyBlueprint(world, 'Passing loop');
  const fitted = fitPassingLoop({ start, end, side, idPrefix: draft.id });
  if (fitted.ok === false) return fitted;
  const analyzer = new ConstructionAnalyzer(terrain);
  draft.tracks = fitted.template.tracks.map(track => {
    const proposal = analyzer.analyze(track);
    return { ...track, verticalProfile: proposal.verticalProfile, structures: proposal.structures, paidBuildCost: proposal.costs.total };
  });
  draft.junctions = fitted.template.junctions;
  return { ok: true, draft };
}

export function quoteBlueprint(world: WorldData, draft: BlueprintDraft, terrain: TerrainHeightSource): BlueprintQuote {
  if (!validateBlueprintDraft(draft)) throw new Error('Choose a complete version 1 railway blueprint.');
  const priced = clonePlainData(draft), errors: string[] = [];
  if (draft.sourceWorldId !== world.id) errors.push('This sketch belongs to another region.');
  const analyzer = new ConstructionAnalyzer(terrain);
  const ids = new Set(world.tracks.map(t => t.uuid));
  const all = [...world.tracks];
  const clearanceTracks: ClearanceTrack[] = [];
  for (const track of [...world.tracks, ...priced.tracks]) {
    const sampled = sampleConstructionCurve(track);
    if (sampled.ok) clearanceTracks.push({ trackUUID: track.uuid, geometry: track, curveSamples: sampled.samples });
    else errors.push('A track has invalid geometry. Shorten or reshape it.');
  }
  const turnouts: ClearanceTurnout[] = [...world.junctions, ...priced.junctions].map(junction => ({ junction, tracks: clearanceTracks }));
  const junctionIds = new Set(world.junctions.map(junction => junction.uuid));
  for (const junction of priced.junctions) {
    if (junctionIds.has(junction.uuid)) errors.push('A junction in this sketch already exists.');
    junctionIds.add(junction.uuid);
    if (!isValidClearanceTurnout({ junction, tracks: clearanceTracks })) errors.push('A turnout needs three distinct aligned endpoint tracks whose branches separate within 320 world units.');
    if (world.trains.some(train => [junction.mainTrackUUID, junction.leftTrackUUID, junction.rightTrackUUID].includes(train.trackUUID))) errors.push('Move trains off the turnout tracks before changing the junction.');
  }
  let totalCost = 0;
  for (const track of priced.tracks) {
    if (ids.has(track.uuid)) { errors.push('A track in this sketch already exists.'); continue; }
    ids.add(track.uuid);
    const detail = analyzer.analyzeDetailed(track);
    if (!detail.proposal.valid) { errors.push(detail.proposal.remedy); continue; }
    const existing = all.map(t => clearanceTracks.find(candidate => candidate.trackUUID === t.uuid));
    if (existing.some(track => !track)) { errors.push('An existing track has invalid geometry.'); continue; }
    const connections: Array<{kind:'endpoint-connection';existingTrackUUID:string;existingEndpoint:'start'|'end';newEndpoint:'start'|'end';point:{x:number;y:number}}> = [];
    for (const previous of all) for (const [a, aKey] of [['start', 'p0'], ['end', 'p3']] as const)
      for (const [b, bKey] of [['start', 'p0'], ['end', 'p3']] as const)
        if (Math.hypot(previous[aKey].x - track[bKey].x, previous[aKey].y - track[bKey].y) < 0.00001)
          connections.push({kind:'endpoint-connection',existingTrackUUID:previous.uuid,existingEndpoint:a,newEndpoint:b,point:track[bKey]});
    if (!hasConstructionClearance({ trackUUID: track.uuid, geometry: track, curveSamples: detail.curveSamples }, existing, connections, turnouts)) {
      errors.push('Rails overlap. Move the sketch or connect at an aligned open endpoint.'); continue;
    }
    track.verticalProfile = clonePlainData(detail.proposal.verticalProfile);
    track.structures = clonePlainData(detail.proposal.structures);
    const wireCost = track.electrified
      ? Math.ceil(new TrackArcLengthIndex(track, TRAIN_PHYSICS_CONFIG.arcSampleSpacing).length
        / TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre * 30) : 0;
    track.paidBuildCost = detail.proposal.costs.total + connections.length * ENDPOINT_CONNECTION_COST + wireCost;
    totalCost += track.paidBuildCost;
    all.push(track);
  }
  if (priced.removedTrackIds?.length) errors.push('Review occupied infrastructure with the demolition controls before removing track.');
  const previewWorld = clonePlainData(world);
  previewWorld.tracks.push(...clonePlainData(priced.tracks));
  previewWorld.junctions.push(...clonePlainData(priced.junctions));
  let stationCost=0,vehicleCost=0;
  for (const [i,station] of priced.stations.entries()) {
    if (previewWorld.stations.some(s=>s.id===station.id)) { errors.push('A platform in this sketch already exists.'); continue; }
    try {
      const p=createPlatformProposal(previewWorld,station.name,station.trackUUID,station.trackT,station.platformLengthMetres??120);
      priced.stations[i]={...p.station,id:station.id};previewWorld.stations.push(priced.stations[i]);stationCost+=p.price;
    } catch(error) { errors.push(error instanceof Error?error.message:'Invalid platform.'); }
  }
  for (const [i,train] of priced.trains.entries()) {
    if (previewWorld.trains.some(t=>t.id===train.id)) { errors.push('A train in this sketch already exists.'); continue; }
    try {
      const p=createFleetProposal(previewWorld,train.vehicleFamilyId??'',train.freightSetId,train.trackUUID,train.trackT);
      p.train.id=train.id;if(p.train.dynamics.mode==='on-rail')p.train.dynamics.consistId='consist-'+train.id;
      priced.trains[i]=p.train;previewWorld.trains.push(p.train);vehicleCost+=p.price;
    } catch(error) { errors.push(error instanceof Error?error.message:'Invalid train.'); }
  }
  totalCost+=stationCost+vehicleCost;
  if (!errors.length) {
    const session=new SimulationSession(previewWorld);
    for(const service of priced.services) errors.push(...session.upsertService(service).errors);
    if(!validateWorldData(session.snapshot()).compatible)errors.push('Review the proposed railway, platforms and train placement before building.');
  }
  if (totalCost > world.company.cash) errors.push('Reduce the plan or build it in stages to keep within your cash.');
  priced.constructionCost = totalCost;
  priced.sourceRevision = world.revision;
  const quote = { valid: errors.length === 0, draft: priced, errors, totalCost, cashAfter: world.company.cash - totalCost, stationCost, vehicleCost };
  issuedQuotes.set(quote, { quote: JSON.stringify(quote), construction: constructionState(world) });
  return quote;
}

export function applyBlueprintPurchase(world: WorldData, quote: BlueprintQuote): boolean {
  if (!quote.valid || quote.draft.sourceRevision !== world.revision || quote.draft.sourceWorldId !== world.id) return false;
  const issued = issuedQuotes.get(quote);
  if (!issued || issued.quote !== JSON.stringify(quote) || issued.construction !== constructionState(world)) return false;
  const next=clonePlainData(world);
  const constructionCost=quote.totalCost-quote.vehicleCost;
  if (constructionCost) {
    const posted = postLedgerEntry(next.company, { category: 'construction-capex', magnitude: constructionCost,
      tick: world.economy.tick, referenceId: 'blueprint:' + quote.draft.id, direction: 'forward' });
    if (!posted.ok) return false;
    next.company = posted.company;
  }
  if(quote.vehicleCost && !debitPurchase(next,'vehicle-capex',quote.vehicleCost,'blueprint-vehicles:'+quote.draft.id))return false;
  next.tracks.push(...clonePlainData(quote.draft.tracks));
  next.junctions.push(...clonePlainData(quote.draft.junctions));
  next.stations.push(...clonePlainData(quote.draft.stations));
  next.trains.push(...clonePlainData(quote.draft.trains));
  if(quote.draft.services.length){const session=new SimulationSession(next);for(const service of quote.draft.services)if(!session.upsertService(service).ok)return false;const snapshot=session.snapshot();next.management=clonePlainData(snapshot.management);next.trains=clonePlainData(snapshot.trains);}
  if(!validateWorldData(next).compatible)return false;
  Object.assign(world,next);
  issuedQuotes.delete(quote);
  return true;
}
