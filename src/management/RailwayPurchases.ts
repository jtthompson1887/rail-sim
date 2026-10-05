import type { TrainDef, WorldData, WorldStationDef } from '../config/WorldData';
import { getPoweredVehicleFamily, consistSpecification, type PoweredVehicleFamily } from '../region/VehicleRoster';
import { getFreightSet } from '../freight/FreightSetCatalog';
import { TrackArcLengthIndex } from '../physics/TrackArcLengthIndex';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';
import { postLedgerEntry } from '../economy/FinanceLedger';

export function fleetPurchasePrice(family: PoweredVehicleFamily): number {
  return family.purchasePrice + (family.passengerCapacity > 0 ? 0 : 20_000);
}

export function createFleetProposal(world: WorldData, familyId: string, setId: string, trackId: string, trackT: number): { train: TrainDef; price: number } {
  const family = getPoweredVehicleFamily(familyId), set = getFreightSet(setId), track = world.tracks.find(t => t.uuid === trackId);
  if (!family || !set || !track || !Number.isFinite(trackT) || trackT < 0 || trackT > 1) throw new Error('Choose a vehicle, wagon set and depot track.');
  if (family.traction === 'electric' && !track.electrified) throw new Error('Electrify the depot track before placing this electric train.');
  const index = new TrackArcLengthIndex(track, TRAIN_PHYSICS_CONFIG.arcSampleSpacing);
  const distance = index.distanceAtParameter(trackT), length = consistSpecification({vehicleFamilyId:family.id,freightSetId:setId,cargo:null}).totalLengthMetres * TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre;
  if (index.length < length + 200) throw new Error('Choose a longer depot track for this train.');
  if (distance<length/2 || index.length-distance<length/2) throw new Error('Move the train further inside the depot track so its whole consist fits.');
  if (world.trains.some(t => t.dynamics.mode === 'on-rail' && t.trackUUID === trackId && Math.abs(t.dynamics.distance - distance) < length + 200)) throw new Error('Move the existing train or choose a clear depot track.');
  const id = crypto.randomUUID();
  return { price: fleetPurchasePrice(family), train: {
    id, freightSetId: setId, vehicleFamilyId: family.id, livery: world.companyStyle?.colour ?? '#dfb75c', trackUUID: trackId, trackT, facing: 1, cargo: null,
    operations: { currentTripRevenue: 0, currentTripRunningCost: 0, lastTripRevenue: 0, lastTripRunningCost: 0, lifetimeDeliveredUnits: 0, lifetimeRevenue: 0, lifetimeRunningCost: 0 },
    dynamics: { mode: 'on-rail', trackUUID: trackId, distance, direction: 1, speedMps: 0, consistId: 'consist-' + id, consistOrder: 0 },
  } };
}
export function createPlatformProposal(world: WorldData, name: string, trackId: string, trackT: number, length: number): { station: WorldStationDef; price: number } {
  const track=world.tracks.find(t=>t.uuid===trackId);
  if(!track || !name.trim() || !Number.isFinite(trackT) || trackT<0 || trackT>1 || !Number.isSafeInteger(length) || length<30 || length>300)throw new Error('Choose a track, station name and platform length between 30 and 300 metres.');
  const index=new TrackArcLengthIndex(track,TRAIN_PHYSICS_CONFIG.arcSampleSpacing),distance=index.distanceAtParameter(trackT),half=length*TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre/2;
  if(distance<half||index.length-distance<half)throw new Error('Move the platform away from the track ends, or choose a shorter platform.');
  if(world.stations.some(s=>s.trackUUID===trackId&&Math.abs(index.distanceAtParameter(s.trackT)-distance)<half+(s.platformLengthMetres??120)*TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre/2))throw new Error('This platform overlaps an existing station. Move it along the track.');
  return{price:5_000+length*100,station:{id:crypto.randomUUID(),name:name.trim().slice(0,80),trackUUID:trackId,trackT,platformLengthMetres:length,passengerSpawnRate:8}};
}
export function debitPurchase(world: WorldData, category: 'vehicle-capex'|'construction-capex', amount: number, referenceId: string): boolean {
  const debit=postLedgerEntry(world.company,{category,magnitude:amount,tick:world.economy.tick,referenceId,direction:'forward'});
  if(!debit.ok)return false;world.company=debit.company;return true;
}
