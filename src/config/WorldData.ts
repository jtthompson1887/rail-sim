import type { TrackGeometryDef } from '../systems/TrackGeometry';
import {
  ENDPOINT_CONNECTION_COST,
  startingCashForDifficulty,
} from './ConstructionConfig';
import {
  MAX_OPPORTUNITY_ATTEMPTS,
  WorldGenerationConfig,
} from './WorldGeneration';
import type {
  CompanyStateDef,
  FacilityEconomyDef,
  InventorySlotDef,
  MarketStateDef,
} from '../economy/EconomyData';
import {
  INITIAL_PRODUCTS,
} from '../economy/InitialEconomyContent';
import {
  getFacilityDefinition,
  getProduct,
  getRecipe,
} from '../economy/ProductCatalog';
import {
  capacityForProduct,
  getFreightSet,
} from '../freight/FreightSetCatalog';
import {
  createCompanyState,
  validateCompanyState,
} from '../economy/FinanceLedger';
import { clonePlainData } from '../utils/PlainData';

export type StructureType = 'surface' | 'cut' | 'fill' | 'bridge' | 'tunnel';

export interface VerticalProfileDef {
  profileVersion: 1;
  knots: Array<{
    t: number;
    elevation: number;
  }>;
}

export interface StructureInterval {
  type: StructureType;
  startT: number;
  endT: number;
  startElevation: number;
  endElevation: number;
}

export interface ConstructionCostBreakdown {
  track: number;
  earthworks: number;
  bridge: number;
  tunnel: number;
  total: number;
}

/** Serialised control point (Bézier p0–p3) */
export interface Vec2Def {
  x: number;
  y: number;
}

/** A serialised RailTrack (cubic Bézier). */
export interface TrackDef extends TrackGeometryDef {
  uuid: string;
  verticalProfile: VerticalProfileDef;
  structures: StructureInterval[];
  paidBuildCost: number;
}

/** A serialised Junction referencing three track UUIDs. */
export interface JunctionDef {
  uuid: string;
  mainTrackUUID: string;
  leftTrackUUID: string;
  rightTrackUUID: string;
  position: number;
  branchState: 'left' | 'right';
}

/** A serialised Station placed at a t-value on a track. */
export interface WorldStationDef {
  id: string;
  name: string;
  trackUUID: string;
  trackT: number;
  passengerSpawnRate: number;
}

export interface TrainCargoDef {
  productId: string;
  units: number;
  loadedUnits: number;
  originFacilityId: string;
}

export interface TrainOperationsDef {
  currentTripRevenue: number;
  currentTripRunningCost: number;
  lastTripRevenue: number;
  lastTripRunningCost: number;
  lifetimeDeliveredUnits: number;
  lifetimeRevenue: number;
  lifetimeRunningCost: number;
}

/** An authoritative serialised freight train placed in the world. */
export interface TrainDef {
  id: string;
  freightSetId: string;
  trackUUID: string;
  trackT: number;
  facing: 1 | -1;
  cargo: TrainCargoDef | null;
  operations: TrainOperationsDef;
}

/** Asset type identifiers for scenery objects. */
export type SceneryType =
  | 'tree_oak' | 'tree_pine' | 'tree_birch' | 'tree_dead'
  | 'rock_boulder' | 'rock_outcrop' | 'rock_cluster'
  | 'terrain_pond' | 'terrain_cliff' | 'terrain_mound';

/** A single serialised scenery object placed in the world. */
export interface SceneryObjectDef {
  id: string;
  type: SceneryType;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  variant: number;
}

/** Biome types that control terrain colour palette and scenery asset weights. */
export type BiomeType = 'temperate' | 'alpine' | 'arid' | 'tropical';

export type ConstructionDifficultyId = 'standard';

export interface WorldGenerationConfigDef {
  generationConfigVersion: 1;
  seed: string;
  biome: BiomeType;
  constructionDifficultyId: ConstructionDifficultyId;
}

export interface PlanningSiteDef {
  id: string;
  label: string;
  x: number;
  y: number;
  footprintRadius: number;
}

export interface OpportunityCorridorDef {
  id: string;
  waypoints: Vec2Def[];
  estimatedCost: number;
  dominantTradeoff: 'short-steep' | 'long-flat' | 'structure-heavy';
  feasibilityWitness: {
    witnessVersion: 1;
    segments: Array<{
      geometry: TrackGeometryDef;
      verticalProfile: VerticalProfileDef;
      structures: StructureInterval[];
      costs: ConstructionCostBreakdown;
      topologyCost: 0 | typeof ENDPOINT_CONNECTION_COST;
    }>;
    totalCost: number;
  };
}

export interface StarterOpportunityDef {
  opportunityVersion: 1;
  resolvedAttempt: number;
  sites: [PlanningSiteDef, PlanningSiteDef];
  corridors: [OpportunityCorridorDef, OpportunityCorridorDef];
  recommendedCamera: { x: number; y: number; zoom: number };
}

export interface EconomyStateDef {
  economyVersion: 1;
  tick: number;
  facilities: FacilityEconomyDef[];
  market: MarketStateDef;
}

export interface FreightProgressDef {
  progressVersion: 1;
  profitableLogDeliveryCompleted: boolean;
  developmentGrantAwarded: boolean;
  profitableStructuralTimberDeliveryCompleted: boolean;
}

/** The root world data blob persisted to localStorage. */
export interface WorldData {
  schemaVersion: 8;
  revision: number;
  constructionRevision: number;
  operationsRevision: number;
  id: string;
  name: string;
  generationConfig: WorldGenerationConfigDef;
  company: CompanyStateDef;
  economy: EconomyStateDef;
  freightProgress: FreightProgressDef;
  starterOpportunity: StarterOpportunityDef;
  tracks: TrackDef[];
  junctions: JunctionDef[];
  stations: WorldStationDef[];
  trains: TrainDef[];
  /** Persisted scenery object placements (player edits are saved here). */
  scenery: SceneryObjectDef[];
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

/** Create a blank world with sane defaults. */
export function createEmptyWorld(
  name: string,
  seed: string,
  biome: BiomeType,
  starterOpportunity: StarterOpportunityDef,
  economy: EconomyStateDef = createEmptyEconomyState(),
): WorldData {
  const now = Date.now();
  const constructionDifficultyId: ConstructionDifficultyId = 'standard';
  return {
    schemaVersion: 8,
    revision: 0,
    constructionRevision: 0,
    operationsRevision: 0,
    id: crypto.randomUUID(),
    name,
    generationConfig: {
      generationConfigVersion: 1,
      seed,
      biome,
      constructionDifficultyId,
    },
    company: createCompanyState(
      startingCashForDifficulty(constructionDifficultyId),
    ),
    economy: clonePlainData(economy),
    freightProgress: {
      progressVersion: 1,
      profitableLogDeliveryCompleted: false,
      developmentGrantAwarded: false,
      profitableStructuralTimberDeliveryCompleted: false,
    },
    starterOpportunity: clonePlainData(starterOpportunity),
    tracks: [],
    junctions: [],
    stations: [],
    trains: [],
    scenery: [],
    metadata: { createdAt: now, updatedAt: now },
  };
}

export const INCOMPATIBLE_WORLD_ACTION = 'Start a new world.' as const;

export interface CompatibleWorldResult {
  compatible: true;
  world: WorldData;
}

export function createEmptyEconomyState(): EconomyStateDef {
  const regionalDemandBpsByProduct: Record<string, number> = {};
  INITIAL_PRODUCTS.forEach((product) => {
    regionalDemandBpsByProduct[product.id] = 10_000;
  });
  return {
    economyVersion: 1,
    tick: 0,
    facilities: [],
    market: {
      constructionIndexBps: 10_000,
      regionalDemandBpsByProduct,
    },
  };
}

export interface IncompatibleWorldResult {
  compatible: false;
  id: string | null;
  /** Trusted localStorage map key, when validation originated from storage. */
  storageId: string | null;
  name: string;
  updatedAt: number;
  message: string;
  action: typeof INCOMPATIBLE_WORLD_ACTION;
}

export type WorldValidationResult = CompatibleWorldResult | IncompatibleWorldResult;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec2(value: unknown): value is Vec2Def {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isGeometry(value: unknown): value is TrackGeometryDef {
  return isRecord(value)
    && value.geometryVersion === 1
    && isVec2(value.p0)
    && isVec2(value.p1)
    && isVec2(value.p2)
    && isVec2(value.p3);
}

function isVerticalProfile(value: unknown): value is VerticalProfileDef {
  if (!isRecord(value)
    || value.profileVersion !== 1
    || !Array.isArray(value.knots)
    || value.knots.length < 2) {
    return false;
  }
  for (let index = 0; index < value.knots.length; index++) {
    const knot = value.knots[index];
    const previous = index > 0 ? value.knots[index - 1] : null;
    if (!isRecord(knot)
      || !isFiniteNumber(knot.t)
      || !isFiniteNumber(knot.elevation)
      || knot.t < 0
      || knot.t > 1
      || (isRecord(previous) && isFiniteNumber(previous.t) && knot.t <= previous.t)) {
      return false;
    }
  }
  const first = value.knots[0];
  const last = value.knots[value.knots.length - 1];
  return isRecord(first) && first.t === 0 && isRecord(last) && last.t === 1;
}

function isStructureInterval(value: unknown): value is StructureInterval {
  if (!isRecord(value)) return false;
  const types: StructureType[] = ['surface', 'cut', 'fill', 'bridge', 'tunnel'];
  return types.indexOf(value.type as StructureType) !== -1
    && isFiniteNumber(value.startT)
    && isFiniteNumber(value.endT)
    && value.startT >= 0
    && value.endT <= 1
    && value.startT < value.endT
    && isFiniteNumber(value.startElevation)
    && isFiniteNumber(value.endElevation);
}

function isStructureSequence(value: unknown): value is StructureInterval[] {
  if (!Array.isArray(value)
    || value.length === 0
    || !value.every(isStructureInterval)) {
    return false;
  }
  if (value[0].startT !== 0 || value[value.length - 1].endT !== 1) return false;
  for (let index = 1; index < value.length; index++) {
    if (value[index - 1].endT !== value[index].startT) return false;
  }
  return true;
}

function profileElevationAt(profile: VerticalProfileDef, t: number): number {
  if (t <= profile.knots[0].t) return profile.knots[0].elevation;
  for (let index = 1; index < profile.knots.length; index++) {
    const end = profile.knots[index];
    if (t <= end.t) {
      const start = profile.knots[index - 1];
      const ratio = (t - start.t) / (end.t - start.t);
      return start.elevation + (end.elevation - start.elevation) * ratio;
    }
  }
  return profile.knots[profile.knots.length - 1].elevation;
}

function structureElevationsMatchProfile(
  structures: StructureInterval[],
  profile: VerticalProfileDef,
): boolean {
  const epsilon = 1e-6;
  return structures.every((interval) => (
    Math.abs(interval.startElevation - profileElevationAt(profile, interval.startT)) <= epsilon
    && Math.abs(interval.endElevation - profileElevationAt(profile, interval.endT)) <= epsilon
  ));
}

function isTrack(value: unknown): value is TrackDef {
  if (!isRecord(value)) return false;
  return isGeometry(value)
    && typeof value.uuid === 'string'
    && isVerticalProfile(value.verticalProfile)
    && isStructureSequence(value.structures)
    && structureElevationsMatchProfile(value.structures, value.verticalProfile)
    && Number.isSafeInteger(value.paidBuildCost)
    && value.paidBuildCost >= 0
    && !('isTunnel' in value)
    && !('elevation' in value);
}

function isConstructionCosts(value: unknown): value is ConstructionCostBreakdown {
  if (!isRecord(value)) return false;
  const components = [value.track, value.earthworks, value.bridge, value.tunnel];
  if (!components.every((component) => (
    typeof component === 'number'
    && Number.isSafeInteger(component)
    && component >= 0
  ))) return false;
  return typeof value.total === 'number'
    && Number.isSafeInteger(value.total)
    && value.total === (value.track as number)
      + (value.earthworks as number)
      + (value.bridge as number)
      + (value.tunnel as number);
}

function isOpportunitySegment(value: unknown): boolean {
  return isRecord(value)
    && isGeometry(value.geometry)
    && isVerticalProfile(value.verticalProfile)
    && isStructureSequence(value.structures)
    && structureElevationsMatchProfile(value.structures, value.verticalProfile)
    && isConstructionCosts(value.costs)
    && (value.topologyCost === 0
      || value.topologyCost === ENDPOINT_CONNECTION_COST);
}

function isOpportunityCorridor(value: unknown): value is OpportunityCorridorDef {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !Array.isArray(value.waypoints)
    || value.waypoints.length < 2
    || !value.waypoints.every(isVec2)
    || value.waypoints.some((waypoint) => (
      Math.abs((waypoint as Vec2Def).x) > WorldGenerationConfig.WORLD_HALF_WIDTH
      || Math.abs((waypoint as Vec2Def).y) > WorldGenerationConfig.WORLD_HALF_HEIGHT
    ))
    || !Number.isSafeInteger(value.estimatedCost)
    || (value.estimatedCost as number) < 0
    || ['short-steep', 'long-flat', 'structure-heavy'].indexOf(
      value.dominantTradeoff as string,
    ) === -1
    || !isRecord(value.feasibilityWitness)
    || value.feasibilityWitness.witnessVersion !== 1
    || !Array.isArray(value.feasibilityWitness.segments)
    || value.feasibilityWitness.segments.length === 0
    || !value.feasibilityWitness.segments.every(isOpportunitySegment)
    || !Number.isSafeInteger(value.feasibilityWitness.totalCost)) {
    return false;
  }
  const waypoints = value.waypoints as Vec2Def[];
  const segments = value.feasibilityWitness.segments as Array<{
    geometry: TrackGeometryDef;
    costs: ConstructionCostBreakdown;
    topologyCost: 0 | typeof ENDPOINT_CONNECTION_COST;
  }>;
  if (segments.length !== waypoints.length - 1) return false;
  for (let index = 0; index < segments.length; index++) {
    const geometry = segments[index].geometry;
    const expectedTopologyCost = index === 0 ? 0 : ENDPOINT_CONNECTION_COST;
    const start = waypoints[index];
    const end = waypoints[index + 1];
    if (segments[index].topologyCost !== expectedTopologyCost
      || geometry.p0.x !== start.x
      || geometry.p0.y !== start.y
      || geometry.p3.x !== end.x
      || geometry.p3.y !== end.y) {
      return false;
    }
    if (index > 0) {
      const previous = segments[index - 1].geometry;
      const incomingX = previous.p3.x - previous.p2.x;
      const incomingY = previous.p3.y - previous.p2.y;
      const outgoingX = geometry.p1.x - geometry.p0.x;
      const outgoingY = geometry.p1.y - geometry.p0.y;
      const lengths = Math.hypot(incomingX, incomingY)
        * Math.hypot(outgoingX, outgoingY);
      const cross = incomingX * outgoingY - incomingY * outgoingX;
      const dot = incomingX * outgoingX + incomingY * outgoingY;
      if (lengths === 0 || Math.abs(cross) > lengths * 1e-10 || dot <= 0) {
        return false;
      }
    }
  }
  const total = segments.reduce(
    (sum, segment) => sum + segment.costs.total + segment.topologyCost,
    0,
  );
  return value.feasibilityWitness.totalCost === total
    && value.estimatedCost === total;
}

function isStarterOpportunity(value: unknown): value is StarterOpportunityDef {
  if (!isRecord(value)
    || value.opportunityVersion !== 1
    || !Number.isInteger(value.resolvedAttempt)
    || (value.resolvedAttempt as number) < 1
    || (value.resolvedAttempt as number) > MAX_OPPORTUNITY_ATTEMPTS
    || !Array.isArray(value.sites)
    || value.sites.length !== 2
    || !value.sites.every((site) => (
      isRecord(site)
      && typeof site.id === 'string'
      && typeof site.label === 'string'
      && isFiniteNumber(site.x)
      && isFiniteNumber(site.y)
      && isFiniteNumber(site.footprintRadius)
      && site.footprintRadius === WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
      && Math.abs(site.x as number) + (site.footprintRadius as number)
        <= WorldGenerationConfig.WORLD_HALF_WIDTH
      && Math.abs(site.y as number) + (site.footprintRadius as number)
        <= WorldGenerationConfig.WORLD_HALF_HEIGHT
    ))
    || !Array.isArray(value.corridors)
    || value.corridors.length !== 2
    || !value.corridors.every(isOpportunityCorridor)
    || !isRecord(value.recommendedCamera)
    || !isFiniteNumber(value.recommendedCamera.x)
    || !isFiniteNumber(value.recommendedCamera.y)
    || !isFiniteNumber(value.recommendedCamera.zoom)
    || value.recommendedCamera.zoom <= 0) {
    return false;
  }
  const firstSite = value.sites[0] as PlanningSiteDef;
  const secondSite = value.sites[1] as PlanningSiteDef;
  const corridors = value.corridors as [
    OpportunityCorridorDef,
    OpportunityCorridorDef,
  ];
  const endpointsMatchSites = corridors.every((corridor) => {
    const first = corridor.waypoints[0];
    const last = corridor.waypoints[corridor.waypoints.length - 1];
    return first.x === firstSite.x
      && first.y === firstSite.y
      && last.x === secondSite.x
      && last.y === secondSite.y;
  });
  return value.sites[0].id !== value.sites[1].id
    && value.corridors[0].id !== value.corridors[1].id
    && value.corridors[0].dominantTradeoff !== value.corridors[1].dominantTradeoff
    && value.corridors[0].estimatedCost !== value.corridors[1].estimatedCost
    && JSON.stringify(value.corridors[0].waypoints)
      !== JSON.stringify(value.corridors[1].waypoints)
    && endpointsMatchSites;
}

export function validateStarterOpportunityData(
  value: unknown,
): value is StarterOpportunityDef {
  return isStarterOpportunity(value);
}

function isJunction(value: unknown): value is JunctionDef {
  if (!isRecord(value)) return false;
  return typeof value.uuid === 'string'
    && typeof value.mainTrackUUID === 'string'
    && typeof value.leftTrackUUID === 'string'
    && typeof value.rightTrackUUID === 'string'
    && isFiniteNumber(value.position)
    && (value.branchState === 'left' || value.branchState === 'right');
}

function isStation(value: unknown): value is WorldStationDef {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.trackUUID === 'string'
    && isFiniteNumber(value.trackT)
    && isFiniteNumber(value.passengerSpawnRate);
}

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const hasOwn = (value: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function hasValidTrainOperations(
  value: unknown,
): value is TrainOperationsDef {
  if (!isRecord(value)) return false;
  const totals = [
    value.currentTripRevenue,
    value.currentTripRunningCost,
    value.lastTripRevenue,
    value.lastTripRunningCost,
    value.lifetimeDeliveredUnits,
    value.lifetimeRevenue,
    value.lifetimeRunningCost,
  ];
  return totals.every(isNonNegativeSafeInteger)
    && (value.lifetimeRevenue as number)
      >= (value.currentTripRevenue as number)
    && (value.lifetimeRevenue as number)
      >= (value.lastTripRevenue as number)
    && (value.lifetimeRunningCost as number)
      >= (value.currentTripRunningCost as number)
    && (value.lifetimeRunningCost as number)
      >= (value.lastTripRunningCost as number);
}

function isTrain(
  value: unknown,
  trackIds: Set<string>,
  facilityIds: Set<string>,
  trainIds: Set<string>,
): value is TrainDef {
  if (!isRecord(value)
    || hasOwn(value, 'type')
    || hasOwn(value, 'passengers')
    || typeof value.id !== 'string'
    || value.id.trim().length === 0
    || trainIds.has(value.id)
    || typeof value.freightSetId !== 'string'
    || typeof value.trackUUID !== 'string'
    || !trackIds.has(value.trackUUID)
    || !isFiniteNumber(value.trackT)
    || value.trackT < 0
    || value.trackT > 1
    || (value.facing !== 1 && value.facing !== -1)
    || !hasValidTrainOperations(value.operations)) {
    return false;
  }

  const set = getFreightSet(value.freightSetId);
  if (!set) return false;
  trainIds.add(value.id);

  if (value.cargo === null) return true;
  if (!isRecord(value.cargo)
    || typeof value.cargo.productId !== 'string'
    || typeof value.cargo.originFacilityId !== 'string'
    || !facilityIds.has(value.cargo.originFacilityId)
    || !Number.isSafeInteger(value.cargo.units)
    || value.cargo.units <= 0
    || !Number.isSafeInteger(value.cargo.loadedUnits)
    || value.cargo.loadedUnits <= 0
    || value.cargo.units > value.cargo.loadedUnits) {
    return false;
  }
  const product = getProduct(value.cargo.productId);
  const capacity = product && capacityForProduct(set, product);
  return product !== undefined
    && capacity !== undefined
    && capacity.ok
    && value.cargo.loadedUnits <= capacity.capacityUnits;
}

function isFreightProgress(
  value: unknown,
): value is FreightProgressDef {
  return isRecord(value)
    && value.progressVersion === 1
    && typeof value.profitableLogDeliveryCompleted === 'boolean'
    && typeof value.developmentGrantAwarded === 'boolean'
    && typeof value.profitableStructuralTimberDeliveryCompleted === 'boolean';
}

function isScenery(value: unknown): value is SceneryObjectDef {
  if (!isRecord(value)) return false;
  const sceneryTypes: SceneryType[] = [
    'tree_oak', 'tree_pine', 'tree_birch', 'tree_dead',
    'rock_boulder', 'rock_outcrop', 'rock_cluster',
    'terrain_pond', 'terrain_cliff', 'terrain_mound',
  ];
  return typeof value.id === 'string'
    && sceneryTypes.indexOf(value.type as SceneryType) !== -1
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.rotation)
    && isFiniteNumber(value.scale)
    && isFiniteNumber(value.variant);
}

function isInventorySlot(
  value: unknown,
  productId: string,
  expectedCapacity: number,
  expectedTargetStock: number,
): value is InventorySlotDef {
  if (!isRecord(value)) return false;
  return value.productId === productId
    && getProduct(productId) !== undefined
    && isNonNegativeSafeInteger(value.quantity)
    && isNonNegativeSafeInteger(value.reservedQuantity)
    && Number.isSafeInteger(value.capacity)
    && value.capacity === expectedCapacity
    && isNonNegativeSafeInteger(value.recentInflow)
    && isNonNegativeSafeInteger(value.recentOutflow)
    && Number.isSafeInteger(value.targetStock)
    && value.targetStock === expectedTargetStock
    && (value.reservedQuantity as number) <= (value.quantity as number)
    && (value.quantity as number) <= (value.capacity as number)
    && (value.targetStock as number) > 0
    && (value.targetStock as number) <= (value.capacity as number);
}

function isFacilityEconomy(value: unknown): value is FacilityEconomyDef {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || value.id.trim().length === 0
    || typeof value.definitionId !== 'string'
    || typeof value.name !== 'string'
    || value.name.trim().length === 0
    || !isFiniteNumber(value.x)
    || !isFiniteNumber(value.y)
    || !isRecord(value.railAccess)
    || !isFiniteNumber(value.railAccess.x)
    || !isFiniteNumber(value.railAccess.y)
    || !isFiniteNumber(value.railAccess.radius)
    || value.railAccess.radius <= 0
    || !isRecord(value.inventories)
    || !isNonNegativeSafeInteger(value.recipeProgressTicks)) {
    return false;
  }

  const definition = getFacilityDefinition(value.definitionId);
  if (!definition) return false;
  const expectedSlots = new Map(
    definition.inventory.map((slot) => [slot.productId, slot]),
  );
  const inventoryKeys = Object.keys(value.inventories);
  if (inventoryKeys.length !== expectedSlots.size) return false;
  for (const productId of inventoryKeys) {
    const expected = expectedSlots.get(productId);
    if (!expected || !isInventorySlot(
      value.inventories[productId],
      productId,
      expected.capacity,
      expected.targetStock,
    )) return false;
  }

  if (value.activeRecipeId === null) {
    return value.recipeProgressTicks === 0;
  }
  if (typeof value.activeRecipeId !== 'string'
    || definition.recipeIds.indexOf(value.activeRecipeId) === -1) {
    return false;
  }
  const recipe = getRecipe(value.activeRecipeId);
  return recipe !== undefined
    && value.recipeProgressTicks < recipe.cycleTicks;
}

function isMarketState(value: unknown): value is MarketStateDef {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.constructionIndexBps)
    || (value.constructionIndexBps as number) < 8_500
    || (value.constructionIndexBps as number) > 11_500
    || !isRecord(value.regionalDemandBpsByProduct)) {
    return false;
  }
  const expectedProductIds = INITIAL_PRODUCTS
    .map((product) => product.id)
    .sort();
  const actualProductIds = Object.keys(value.regionalDemandBpsByProduct)
    .sort();
  if (actualProductIds.length !== expectedProductIds.length
    || actualProductIds.some((productId, index) => (
      productId !== expectedProductIds[index]
    ))) return false;
  return actualProductIds.every((productId) => {
    const factor = value.regionalDemandBpsByProduct[productId];
    return Number.isSafeInteger(factor)
      && (factor as number) >= 8_000
      && (factor as number) <= 12_000;
  });
}

function isEconomyState(value: unknown): value is EconomyStateDef {
  if (!isRecord(value)
    || value.economyVersion !== 1
    || !isNonNegativeSafeInteger(value.tick)
    || !Array.isArray(value.facilities)
    || !value.facilities.every(isFacilityEconomy)
    || !isMarketState(value.market)) {
    return false;
  }
  const facilityIds = new Set<string>();
  const facilityDefinitionIds = new Set<string>();
  for (const facility of value.facilities as FacilityEconomyDef[]) {
    if (facilityIds.has(facility.id)
      || facilityDefinitionIds.has(facility.definitionId)) return false;
    facilityIds.add(facility.id);
    facilityDefinitionIds.add(facility.definitionId);
  }
  return true;
}

export function validateEconomyStateData(
  value: unknown,
): value is EconomyStateDef {
  return isEconomyState(value);
}

function incompatible(raw: unknown, reason: string): IncompatibleWorldResult {
  const record = isRecord(raw) ? raw : {};
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  return {
    compatible: false,
    id: typeof record.id === 'string' ? record.id : null,
    storageId: null,
    name: typeof record.name === 'string' ? record.name : 'Incompatible save',
    updatedAt: isFiniteNumber(metadata.updatedAt) ? metadata.updatedAt : 0,
    message: `This save is incompatible: ${reason}`,
    action: INCOMPATIBLE_WORLD_ACTION,
  };
}

/**
 * Validate the current persisted world schema without converting or filling
 * any input fields.
 */
export function validateWorldData(raw: unknown): WorldValidationResult {
  if (!isRecord(raw)) return incompatible(raw, 'invalid world data.');
  if (raw.schemaVersion !== 8) {
    return incompatible(raw, raw.schemaVersion === undefined
      ? 'missing schema version.'
      : `unsupported schema version ${String(raw.schemaVersion)}.`);
  }
  if ('seed' in raw || 'terrainSeed' in raw || 'biome' in raw
    || 'scenarios' in raw || hasOwn(raw, 'economyRevision')
    || hasOwn(raw, 'firstRouteProgress')) {
    return incompatible(raw, 'legacy generation fields are not supported.');
  }

  const generationConfig = raw.generationConfig;
  const biomes: BiomeType[] = ['temperate', 'alpine', 'arid', 'tropical'];
  const difficulties: ConstructionDifficultyId[] = ['standard'];
  if (!isRecord(generationConfig)
    || generationConfig.generationConfigVersion !== 1
    || typeof generationConfig.seed !== 'string'
    || biomes.indexOf(generationConfig.biome as BiomeType) === -1
    || difficulties.indexOf(generationConfig.constructionDifficultyId as ConstructionDifficultyId) === -1) {
    return incompatible(raw, 'invalid generation configuration.');
  }

  const company = raw.company;
  const metadata = raw.metadata;
  if (typeof raw.id !== 'string'
    || typeof raw.name !== 'string'
    || !isNonNegativeSafeInteger(raw.revision)
    || !isNonNegativeSafeInteger(raw.constructionRevision)
    || !isNonNegativeSafeInteger(raw.operationsRevision)
    || raw.revision !== (raw.constructionRevision as number)
      + (raw.operationsRevision as number)
    || !Array.isArray(raw.tracks) || !raw.tracks.every(isTrack)
    || !Array.isArray(raw.junctions) || !raw.junctions.every(isJunction)
    || !Array.isArray(raw.stations) || !raw.stations.every(isStation)
    || !Array.isArray(raw.trains)
    || !Array.isArray(raw.scenery) || !raw.scenery.every(isScenery)
    || validateCompanyState(company).valid === false
    || !isEconomyState(raw.economy)
    || !isFreightProgress(raw.freightProgress)
    || !isStarterOpportunity(raw.starterOpportunity)
    || !isRecord(metadata)
    || !isFiniteNumber(metadata.createdAt)
    || !isFiniteNumber(metadata.updatedAt)) {
    return incompatible(raw, 'data does not match schema version 8.');
  }

  const trackIds = new Set(
    (raw.tracks as TrackDef[]).map(({ uuid }) => uuid),
  );
  const facilityIds = new Set(
    (raw.economy as EconomyStateDef).facilities.map(({ id }) => id),
  );
  const trainIds = new Set<string>();
  for (const train of raw.trains) {
    if (!isTrain(train, trackIds, facilityIds, trainIds)) {
      return incompatible(raw, 'data does not match schema version 8.');
    }
  }

  return { compatible: true, world: raw as unknown as WorldData };
}
