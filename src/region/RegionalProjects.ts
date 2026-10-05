import type { WorldData } from '../config/WorldData';
import type { TrackGeometryDef } from '../systems/TrackGeometry';
import { TrackArcLengthIndex } from '../physics/TrackArcLengthIndex';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';

export const REGIONAL_PROJECT_CATCHMENT_RADIUS = 1_200;

export type RegionalProjectKind = 'housing' | 'factory' | 'port' | 'visitor' | 'recycling';
export type ProjectRequirement =
  | { id: string; kind: 'freight-delivery'; productId: string; units: number; destinationDefinitionId: string }
  | { id: string; kind: 'passenger-arrival'; passengers: number };
export interface RegionalProjectDefinition {
  id: RegionalProjectKind;
  title: string;
  description: string;
  anchorDefinitionId: string;
  requirements: readonly ProjectRequirement[];
  reward: {
    grant: number;
    demand: readonly { productId: string; bonusBps: number }[];
    production: readonly { definitionId: string; bonusBps: number }[];
    passengerDemandBonusBps: number;
    unlockIds: readonly string[];
  };
  appearance: { colour: number; buildingCount: number; radius: number };
}

export const REGIONAL_PROJECTS: readonly RegionalProjectDefinition[] = [
  { id: 'housing', title: 'Homes by the Railway', description: 'Deliver building modules and bring residents into town. A new neighbourhood creates regular passenger and food demand.', anchorDefinitionId: 'town-construction-market', requirements: [{ id: 'modules', kind: 'freight-delivery', productId: 'building-modules', units: 16, destinationDefinitionId: 'town-construction-market' }, { id: 'residents', kind: 'passenger-arrival', passengers: 60 }], reward: { grant: 30_000, demand: [{ productId: 'food', bonusBps: 1_000 }], production: [], passengerDemandBonusBps: 2_500, unlockIds: ['housing-extension'] }, appearance: { colour: 0xe6cba4, buildingCount: 9, radius: 160 } },
  { id: 'factory', title: 'Works Expansion', description: 'Supply structural timber, cement and steel to expand the regional factory.', anchorDefinitionId: 'prefabrication-plant', requirements: [{ id: 'timber', kind: 'freight-delivery', productId: 'structural-timber', units: 40, destinationDefinitionId: 'prefabrication-plant' }, { id: 'cement', kind: 'freight-delivery', productId: 'cement', units: 40, destinationDefinitionId: 'prefabrication-plant' }, { id: 'steel', kind: 'freight-delivery', productId: 'steel', units: 30, destinationDefinitionId: 'prefabrication-plant' }], reward: { grant: 40_000, demand: [{ productId: 'steel', bonusBps: 500 }], production: [{ definitionId: 'prefabrication-plant', bonusBps: 2_500 }], passengerDemandBonusBps: 1_000, unlockIds: ['factory-extension'] }, appearance: { colour: 0x8d9fa5, buildingCount: 4, radius: 190 } },
  { id: 'port', title: 'Harbour Gateway', description: 'Deliver modules to the town construction depot and establish a passenger connection at the harbour.', anchorDefinitionId: 'port-interchange', requirements: [{ id: 'modules', kind: 'freight-delivery', productId: 'building-modules', units: 24, destinationDefinitionId: 'town-construction-market' }, { id: 'workers', kind: 'passenger-arrival', passengers: 80 }], reward: { grant: 45_000, demand: [{ productId: 'building-modules', bonusBps: 1_000 }], production: [], passengerDemandBonusBps: 1_500, unlockIds: ['harbour-terminal', 'electric-freight'] }, appearance: { colour: 0x62a9bb, buildingCount: 5, radius: 180 } },
  { id: 'visitor', title: 'A Place to Visit', description: 'Keep the town supplied with food and bring visitors by rail to create a lively destination.', anchorDefinitionId: 'town-food-market', requirements: [{ id: 'food', kind: 'freight-delivery', productId: 'food', units: 40, destinationDefinitionId: 'town-food-market' }, { id: 'visitors', kind: 'passenger-arrival', passengers: 100 }], reward: { grant: 35_000, demand: [{ productId: 'food', bonusBps: 1_000 }], production: [], passengerDemandBonusBps: 3_000, unlockIds: ['visitor-quarter', 'express-passenger'] }, appearance: { colour: 0xa2c582, buildingCount: 7, radius: 155 } },
  { id: 'recycling', title: 'Circular Industry', description: 'Supply scrap to the recycling works and deliver its steel to the factory.', anchorDefinitionId: 'recycling-works', requirements: [{ id: 'scrap', kind: 'freight-delivery', productId: 'scrap', units: 60, destinationDefinitionId: 'recycling-works' }, { id: 'steel', kind: 'freight-delivery', productId: 'steel', units: 30, destinationDefinitionId: 'prefabrication-plant' }], reward: { grant: 30_000, demand: [{ productId: 'scrap', bonusBps: 1_000 }], production: [{ definitionId: 'recycling-works', bonusBps: 3_000 }], passengerDemandBonusBps: 500, unlockIds: ['recycling-extension'] }, appearance: { colour: 0x6cab89, buildingCount: 4, radius: 165 } },
];

export interface RegionalProjectState {
  definitionId: RegionalProjectKind;
  accepted: boolean;
  anchorFacilityId: string | null;
  x: number;
  y: number;
  stationId: string | null;
  progress: Record<string, number>;
  completedAtTick: number | null;
}
export interface RegionState {
  version: 1;
  projects: RegionalProjectState[];
  transformations: { projectId: RegionalProjectKind; tick: number; x: number; y: number }[];
  facilityDefinitionById: Record<string, string>;
  seenEventIds: string[];
  demandBonusBpsByProduct: Record<string, number>;
  productionBonusBpsByDefinition: Record<string, number>;
  productionRemainders: Record<string, number>;
  passengerDemandBonusBps: number;
  unlockIds: string[];
}
export type RegionEvent =
  | { id: string; kind: 'freight-delivery'; tick: number; productId: string; units: number; destinationFacilityId: string; originFacilityId?: string }
  | { id: string; kind: 'passenger-arrival'; tick: number; stationId: string; passengers: number; x?: number; y?: number };
export interface RegionalProjectOutcome {
  kind: 'project-completed';
  id: string;
  projectId: RegionalProjectKind;
  tick: number;
  grant: number;
  unlockIds: readonly string[];
}
const cloneRegion = (state: RegionState): RegionState => ({ ...state, projects: state.projects.map(p => ({ ...p, progress: { ...p.progress } })), transformations: state.transformations.map(t => ({ ...t })), facilityDefinitionById: { ...state.facilityDefinitionById }, seenEventIds: [...state.seenEventIds], demandBonusBpsByProduct: { ...state.demandBonusBpsByProduct }, productionBonusBpsByDefinition: { ...state.productionBonusBpsByDefinition }, productionRemainders: { ...state.productionRemainders }, unlockIds: [...state.unlockIds] });

export function createRegionState(world: Pick<WorldData, 'economy'>): RegionState {
  const facilities = world.economy.facilities;
  return {
    version: 1,
    projects: REGIONAL_PROJECTS.map(definition => {
      const anchor = facilities.find(f => f.definitionId === definition.anchorDefinitionId);
      return { definitionId: definition.id, accepted: false, anchorFacilityId: anchor?.id ?? null, x: anchor?.x ?? 0, y: anchor?.y ?? 0, stationId: null, progress: Object.fromEntries(definition.requirements.map(r => [r.id, 0])), completedAtTick: null };
    }),
    facilityDefinitionById: Object.fromEntries(facilities.map(f => [f.id, f.definitionId])),
    transformations: [], seenEventIds: [], demandBonusBpsByProduct: {}, productionBonusBpsByDefinition: {}, productionRemainders: {}, passengerDemandBonusBps: 0, unlockIds: [],
  };
}

export function acceptProject(state: RegionState, projectId: string): RegionState {
  const project = state.projects.find(p => p.definitionId === projectId);
  if (!project || project.accepted || project.completedAtTick !== null || !project.anchorFacilityId) return state;
  const next = cloneRegion(state);
  next.projects.find(p => p.definitionId === projectId)!.accepted = true;
  return next;
}

/** A binding chooses one station within the project's catchment. */
export function connectProjectStation(state: RegionState, projectId: RegionalProjectKind, stationId: string | null): RegionState {
  const next = cloneRegion(state);
  const project = next.projects.find(p => p.definitionId === projectId);
  if (project) project.stationId = stationId;
  return next;
}

/** Resolve the platform from saved rail geometry, independently of any renderer. */
export function projectStationPoint(world: Pick<WorldData, 'tracks' | 'stations'>, stationId: string): { x: number; y: number } | null {
  const station = world.stations.find(candidate => candidate.id === stationId);
  if (!station || !Number.isFinite(station.trackT) || station.trackT < 0 || station.trackT > 1) return null;
  const track = world.tracks.find(candidate => candidate.uuid === station.trackUUID);
  if (!track) return null;
  try {
    const index = new TrackArcLengthIndex(track, TRAIN_PHYSICS_CONFIG.arcSampleSpacing);
    if (!Number.isFinite(index.length) || index.length <= 0) return null;
    const point = index.poseAtDistance(index.distanceAtParameter(station.trackT)).point;
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  } catch {
    return null;
  }
}

function withinProjectCatchment(project: Pick<RegionalProjectState, 'x' | 'y'>, point: { x?: number; y?: number }): boolean {
  return Number.isFinite(project.x) && Number.isFinite(project.y)
    && Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.hypot(point.x! - project.x, point.y! - project.y) <= REGIONAL_PROJECT_CATCHMENT_RADIUS;
}

export function isProjectStationEligible(project: Pick<RegionalProjectState, 'x' | 'y'>, world: Pick<WorldData, 'tracks' | 'stations'>, stationId: string): boolean {
  const point = projectStationPoint(world, stationId);
  return point !== null && withinProjectCatchment(project, point);
}

export function applyRegionEvent(state: RegionState, event: RegionEvent): { state: RegionState; outcomes: RegionalProjectOutcome[] } {
  const quantity = event.kind === 'freight-delivery' ? event.units : event.passengers;
  if (!event.id || !Number.isSafeInteger(event.tick) || event.tick < 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || state.seenEventIds.includes(event.id)) return { state, outcomes: [] };
  const next = cloneRegion(state);
  const outcomes: RegionalProjectOutcome[] = [];
  let remainingFreightUnits = event.kind === 'freight-delivery' ? event.units : 0;
  next.seenEventIds.push(event.id);
  for (const project of next.projects) {
    if (!project.accepted || project.completedAtTick !== null || project.anchorFacilityId === null) continue;
    const definition = REGIONAL_PROJECTS.find(d => d.id === project.definitionId)!;
    for (const requirement of definition.requirements) {
      let matches = false;
      if (requirement.kind === 'freight-delivery' && event.kind === 'freight-delivery') {
        matches = requirement.productId === event.productId && next.facilityDefinitionById[event.destinationFacilityId] === requirement.destinationDefinitionId;
        // Circular industry must close the loop; imported steel cannot substitute for recycled steel.
        if (definition.id === 'recycling' && requirement.productId === 'steel') matches = matches && next.facilityDefinitionById[event.originFacilityId ?? ''] === 'recycling-works';
      } else if (requirement.kind === 'passenger-arrival' && event.kind === 'passenger-arrival') {
        matches = (project.stationId === null || project.stationId === event.stationId)
          && withinProjectCatchment(project, event);
      }
      const target = requirement.kind === 'freight-delivery' ? requirement.units : requirement.passengers;
      if (matches) {
        const current = project.progress[requirement.id] ?? 0;
        const credited = Math.min(target - current, event.kind === 'freight-delivery' ? remainingFreightUnits : quantity);
        project.progress[requirement.id] = current + credited;
        if (event.kind === 'freight-delivery') remainingFreightUnits -= credited;
      }
    }
    if (!definition.requirements.every(r => project.progress[r.id] >= (r.kind === 'freight-delivery' ? r.units : r.passengers))) continue;
    project.completedAtTick = event.tick;
    next.transformations.push({ projectId: project.definitionId, tick: event.tick, x: project.x, y: project.y });
    definition.reward.demand.forEach(d => { next.demandBonusBpsByProduct[d.productId] = (next.demandBonusBpsByProduct[d.productId] ?? 0) + d.bonusBps; });
    definition.reward.production.forEach(p => { next.productionBonusBpsByDefinition[p.definitionId] = (next.productionBonusBpsByDefinition[p.definitionId] ?? 0) + p.bonusBps; });
    next.passengerDemandBonusBps += definition.reward.passengerDemandBonusBps;
    next.unlockIds = [...new Set([...next.unlockIds, ...definition.reward.unlockIds])].sort();
    outcomes.push({ kind: 'project-completed', id: `project:${project.definitionId}`, projectId: project.definitionId, tick: event.tick, grant: definition.reward.grant, unlockIds: [...definition.reward.unlockIds] });
  }
  return { state: next, outcomes };
}

export interface RegionalFootprint { projectId: RegionalProjectKind; x: number; y: number; radius: number; colour: number; buildingCount: number }
function pointOnCurve(curve: TrackGeometryDef, t: number): { x: number; y: number } {
  const s = 1 - t;
  return { x: s ** 3 * curve.p0.x + 3 * s * s * t * curve.p1.x + 3 * s * t * t * curve.p2.x + t ** 3 * curve.p3.x, y: s ** 3 * curve.p0.y + 3 * s * s * t * curve.p1.y + 3 * s * t * t * curve.p2.y + t ** 3 * curve.p3.y };
}
export function footprintIsClear(footprint: { x: number; y: number; radius: number }, tracks: readonly TrackGeometryDef[]): boolean {
  return tracks.every(track => {
    const controlLength = Math.hypot(track.p1.x - track.p0.x, track.p1.y - track.p0.y) + Math.hypot(track.p2.x - track.p1.x, track.p2.y - track.p1.y) + Math.hypot(track.p3.x - track.p2.x, track.p3.y - track.p2.y);
    const samples = Math.max(16, Math.ceil(controlLength / 24));
    for (let i = 0; i <= samples; i++) {
      const point = pointOnCurve(track, i / samples);
      if (Math.hypot(point.x - footprint.x, point.y - footprint.y) < footprint.radius + 36) return false;
    }
    return true;
  });
}

/** Decorative footprints relocate around their site; both built and proposed railway remain unobstructed. */
export function resolveTransformationFootprints(state: RegionState, tracks: readonly TrackGeometryDef[], draftTracks: readonly TrackGeometryDef[] = [], siteAllowed: (footprint: RegionalFootprint) => boolean = () => true): RegionalFootprint[] {
  const footprints: RegionalFootprint[] = [];
  for (const project of state.projects) {
    if (project.completedAtTick === null) continue;
    const definition = REGIONAL_PROJECTS.find(d => d.id === project.definitionId)!;
    for (let candidate = 0; candidate < 24; candidate++) {
      const angle = candidate % 8 * Math.PI / 4;
      const distance = 400 + Math.floor(candidate / 8) * 260;
      const footprint = { projectId: project.definitionId, x: project.x + Math.cos(angle) * distance, y: project.y + Math.sin(angle) * distance, ...definition.appearance };
      if (Math.abs(footprint.x) + footprint.radius > 8_192 || Math.abs(footprint.y) + footprint.radius > 8_192) continue;
      if (siteAllowed(footprint) && footprintIsClear(footprint, [...tracks, ...draftTracks]) && footprints.every(f => Math.hypot(f.x - footprint.x, f.y - footprint.y) > f.radius + footprint.radius + 24)) { footprints.push(footprint); break; }
    }
  }
  return footprints;
}

export function validateRegionState(raw: unknown): raw is RegionState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const state = raw as RegionState;
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const whole = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  if (state.version !== 1 || !Array.isArray(state.projects) || state.projects.length !== REGIONAL_PROJECTS.length || !Array.isArray(state.transformations) || !Array.isArray(state.seenEventIds) || !Array.isArray(state.unlockIds) || !record(state.facilityDefinitionById) || !record(state.demandBonusBpsByProduct) || !record(state.productionBonusBpsByDefinition) || !record(state.productionRemainders) || !whole(state.passengerDemandBonusBps)) return false;
  if ([...state.seenEventIds, ...state.unlockIds].some(id => typeof id !== 'string' || !id) || new Set(state.seenEventIds).size !== state.seenEventIds.length || new Set(state.unlockIds).size !== state.unlockIds.length || Object.values(state.facilityDefinitionById).some(id => typeof id !== 'string' || !id)) return false;
  const projectIds = new Set<string>();
  for (const project of state.projects) {
    if (!project || projectIds.has(project.definitionId) || typeof project.accepted !== 'boolean' || !Number.isFinite(project.x) || !Number.isFinite(project.y) || !record(project.progress) || (project.stationId !== null && (typeof project.stationId !== 'string' || !project.stationId)) || (project.anchorFacilityId !== null && (typeof project.anchorFacilityId !== 'string' || !state.facilityDefinitionById[project.anchorFacilityId]))) return false;
    const definition = REGIONAL_PROJECTS.find(d => d.id === project.definitionId);
    if (!definition || Object.keys(project.progress).length !== definition.requirements.length) return false;
    for (const requirement of definition.requirements) {
      const amount = project.progress[requirement.id];
      const target = requirement.kind === 'freight-delivery' ? requirement.units : requirement.passengers;
      if (!whole(amount) || amount > target) return false;
      if (project.completedAtTick !== null && amount !== target) return false;
    }
    if (project.completedAtTick !== null && (!whole(project.completedAtTick) || !project.accepted)) return false;
    projectIds.add(project.definitionId);
  }
  const completed = state.projects.filter(p => p.completedAtTick !== null);
  if (state.transformations.length !== completed.length || new Set(state.transformations.map(t => t?.projectId)).size !== completed.length) return false;
  for (const transformation of state.transformations) {
    const project = completed.find(p => p.definitionId === transformation?.projectId);
    if (!project || transformation.tick !== project.completedAtTick || transformation.x !== project.x || transformation.y !== project.y) return false;
  }
  const expectedDemand: Record<string, number> = {};
  const expectedProduction: Record<string, number> = {};
  const expectedUnlocks = new Set<string>();
  let expectedPassengerBonus = 0;
  completed.forEach(project => {
    const reward = REGIONAL_PROJECTS.find(d => d.id === project.definitionId)!.reward;
    reward.demand.forEach(d => { expectedDemand[d.productId] = (expectedDemand[d.productId] ?? 0) + d.bonusBps; });
    reward.production.forEach(p => { expectedProduction[p.definitionId] = (expectedProduction[p.definitionId] ?? 0) + p.bonusBps; });
    reward.unlockIds.forEach(id => expectedUnlocks.add(id));
    expectedPassengerBonus += reward.passengerDemandBonusBps;
  });
  const sameAmounts = (left: Record<string, number>, right: Record<string, number>) => Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => left[key] === right[key]);
  if (!sameAmounts(state.demandBonusBpsByProduct, expectedDemand) || !sameAmounts(state.productionBonusBpsByDefinition, expectedProduction) || state.passengerDemandBonusBps !== expectedPassengerBonus || state.unlockIds.length !== expectedUnlocks.size || state.unlockIds.some(id => !expectedUnlocks.has(id))) return false;
  return Object.values(state.productionRemainders).every(value => whole(value) && (value as number) < 10_000);
}
