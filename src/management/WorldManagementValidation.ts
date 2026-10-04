import { validatePassengerState } from '../region/PassengerSystem';
import { validateRegionState } from '../region/RegionalProjects';
import { getPoweredVehicleFamily } from '../region/VehicleRoster';
import { validateBlueprintDraft } from './BlueprintFormat';
/** Validate optional additive management data before any imported save becomes live. */
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const safe = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value);
export function validateManagementData(raw: Record<string, any>): boolean {
  if (![raw.trains,raw.tracks,raw.stations].every(value=>value===undefined||Array.isArray(value))) return false;
  for (const train of raw.trains ?? []) {
    if (!record(train)) return false;
    if (train.vehicleFamilyId !== undefined && !getPoweredVehicleFamily(train.vehicleFamilyId)) return false;
    if (train.livery !== undefined && !/^#[0-9a-f]{6}$/i.test(train.livery)) return false;
  }
  for (const track of raw.tracks ?? []) if (!record(track) || (track.electrified !== undefined && typeof track.electrified !== 'boolean')) return false;
  for (const station of raw.stations ?? []) if (!record(station) || (station.platformLengthMetres !== undefined
    && (!safe(station.platformLengthMetres) || station.platformLengthMetres < 30 || station.platformLengthMetres > 300))) return false;
  const management = raw.management;
  if (management !== undefined) {
    if (!record(management) || management.managementVersion !== 1 || !finite(management.clockSeconds) || management.clockSeconds>Number.MAX_SAFE_INTEGER
      || ![0, 1, 2, 4].includes(management.speed) || !Array.isArray(management.services)
      || management.services.length > 200 || !record(management.serviceStates)) return false;
    const serviceIds = new Set<string>();
    const trainIds = new Set<string>();
    for (const service of management.services) {
      if (!record(service) || !id(service.id) || serviceIds.has(service.id) || !id(service.name)
        || !id(service.trainId) || trainIds.has(service.trainId) || !['freight', 'passenger'].includes(service.kind)
        || !Array.isArray(service.stops) || service.stops.length < 2 || service.stops.length > 20
        || !finite(service.frequencySeconds) || !finite(service.departureOffsetSeconds)
        || service.frequencySeconds>86400 || service.departureOffsetSeconds>86400
        || !finite(service.priority) || service.priority>1000 || typeof service.enabled !== 'boolean'
        || !Object.prototype.hasOwnProperty.call(management.serviceStates,service.id)) return false;
      serviceIds.add(service.id); trainIds.add(service.trainId);
      for (const stop of service.stops) {
        if (!record(stop) || !id(stop.targetId) || !['facility', 'station'].includes(stop.targetKind)
          || !['full', 'available', 'unload', 'none'].includes(stop.loadRule)
          || !finite(stop.maxWaitSeconds) || stop.maxWaitSeconds > 3600) return false;
      }
    }
    for (const [serviceId, state] of Object.entries(management.serviceStates)) {
      if (!serviceIds.has(serviceId) || !record(state)
        || !safe(state.nextStopIndex) || state.nextStopIndex>=management.services.find(s=>s.id===serviceId).stops.length
        || !['travelling', 'dwelling', 'blocked', 'scheduled'].includes(state.phase)
        || !finite(state.dwellSeconds) || !finite(state.nextDepartureSeconds) || !safe(state.calls)
        || !safe(state.completedCycles) || !finite(state.distanceWorldUnits) || !finite(state.delaySeconds)
        || (state.stoppedReason!==null && (!record(state.stoppedReason) || !id(state.stoppedReason.code)
          || !id(state.stoppedReason.message) || !id(state.stoppedReason.remedy)
          || (state.stoppedReason.relatedEntityId!==undefined && !id(state.stoppedReason.relatedEntityId))))) return false;
    }
    if (!validatePassengerState(management.passengers)) return false;
  }
  if (raw.blueprints !== undefined && (!Array.isArray(raw.blueprints) || raw.blueprints.length > 20
    || raw.blueprints.some(draft=>!validateBlueprintDraft(draft)))) return false;
  if (raw.region !== undefined && !validateRegionState(raw.region)) return false;
  if (raw.companyStyle !== undefined && (!record(raw.companyStyle) || !id(raw.companyStyle.name)
    || !/^#[0-9a-f]{6}$/i.test(raw.companyStyle.colour))) return false;
  return true;
}
