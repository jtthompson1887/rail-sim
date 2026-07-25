import type { VehicleType } from './VehicleTypes';
import type { TrackGeometryDef } from '../systems/TrackGeometry';

/** Serialised control point (Bézier p0–p3) */
export interface Vec2Def {
  x: number;
  y: number;
}

/** A serialised RailTrack (cubic Bézier). */
export interface TrackDef extends TrackGeometryDef {
  uuid: string;
  /** True when the track segment runs through a tunnel. */
  isTunnel?: boolean;
  /** Average terrain elevation at the time the track was placed (world-units). */
  elevation?: number;
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

/** A serialised Train placed in the world. */
export interface TrainDef {
  id: string;
  trackUUID: string;
  trackT: number;
  passengers: number;
  type: VehicleType;
}

/** A player-authored scenario objective active during play mode. */
export type ScenarioObjectiveType = 'delivery' | 'timed';

export interface ScenarioDef {
  id: string;
  type: ScenarioObjectiveType;
  description: string;
  targetStationId?: string;
  passengerCount?: number;
  timeLimitSecs?: number;
  scoreReward: number;
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

export type ConstructionDifficultyId = 'relaxed' | 'standard' | 'challenging';

export interface WorldGenerationConfigDef {
  generationConfigVersion: 1;
  seed: string;
  biome: BiomeType;
  constructionDifficultyId: ConstructionDifficultyId;
}

/** The root world data blob persisted to localStorage. */
export interface WorldData {
  schemaVersion: 1;
  id: string;
  name: string;
  generationConfig: WorldGenerationConfigDef;
  tracks: TrackDef[];
  junctions: JunctionDef[];
  stations: WorldStationDef[];
  trains: TrainDef[];
  scenarios: ScenarioDef[];
  /** Persisted scenery object placements (player edits are saved here). */
  scenery: SceneryObjectDef[];
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

/** Create a blank world with sane defaults. */
export function createEmptyWorld(name: string, seed?: string, biome: BiomeType = 'temperate'): WorldData {
  const now = Date.now();
  const resolvedSeed = seed ?? now.toString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    generationConfig: {
      generationConfigVersion: 1,
      seed: resolvedSeed,
      biome,
      constructionDifficultyId: 'standard',
    },
    tracks: [],
    junctions: [],
    stations: [],
    trains: [],
    scenarios: [],
    scenery: [],
    metadata: { createdAt: now, updatedAt: now },
  };
}

export const INCOMPATIBLE_WORLD_ACTION = 'Start a new world.' as const;

export interface CompatibleWorldResult {
  compatible: true;
  world: WorldData;
}

export interface IncompatibleWorldResult {
  compatible: false;
  id: string | null;
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

function isTrack(value: unknown): value is TrackDef {
  if (!isRecord(value)) return false;
  return value.geometryVersion === 1
    && typeof value.uuid === 'string'
    && isVec2(value.p0)
    && isVec2(value.p1)
    && isVec2(value.p2)
    && isVec2(value.p3)
    && (value.isTunnel === undefined || typeof value.isTunnel === 'boolean')
    && (value.elevation === undefined || isFiniteNumber(value.elevation));
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

function isTrain(value: unknown): value is TrainDef {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.trackUUID === 'string'
    && isFiniteNumber(value.trackT)
    && isFiniteNumber(value.passengers)
    && (value.type === 'locomotive' || value.type === 'passenger-carriage');
}

function isScenario(value: unknown): value is ScenarioDef {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && (value.type === 'delivery' || value.type === 'timed')
    && typeof value.description === 'string'
    && (value.targetStationId === undefined || typeof value.targetStationId === 'string')
    && (value.passengerCount === undefined || isFiniteNumber(value.passengerCount))
    && (value.timeLimitSecs === undefined || isFiniteNumber(value.timeLimitSecs))
    && isFiniteNumber(value.scoreReward);
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

function incompatible(raw: unknown, reason: string): IncompatibleWorldResult {
  const record = isRecord(raw) ? raw : {};
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  return {
    compatible: false,
    id: typeof record.id === 'string' ? record.id : null,
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
  if (raw.schemaVersion !== 1) {
    return incompatible(raw, raw.schemaVersion === undefined
      ? 'missing schema version.'
      : `unsupported schema version ${String(raw.schemaVersion)}.`);
  }
  if ('seed' in raw || 'terrainSeed' in raw || 'biome' in raw) {
    return incompatible(raw, 'legacy generation fields are not supported.');
  }

  const generationConfig = raw.generationConfig;
  const biomes: BiomeType[] = ['temperate', 'alpine', 'arid', 'tropical'];
  const difficulties: ConstructionDifficultyId[] = ['relaxed', 'standard', 'challenging'];
  if (!isRecord(generationConfig)
    || generationConfig.generationConfigVersion !== 1
    || typeof generationConfig.seed !== 'string'
    || biomes.indexOf(generationConfig.biome as BiomeType) === -1
    || difficulties.indexOf(generationConfig.constructionDifficultyId as ConstructionDifficultyId) === -1) {
    return incompatible(raw, 'invalid generation configuration.');
  }

  const metadata = raw.metadata;
  if (typeof raw.id !== 'string'
    || typeof raw.name !== 'string'
    || !Array.isArray(raw.tracks) || !raw.tracks.every(isTrack)
    || !Array.isArray(raw.junctions) || !raw.junctions.every(isJunction)
    || !Array.isArray(raw.stations) || !raw.stations.every(isStation)
    || !Array.isArray(raw.trains) || !raw.trains.every(isTrain)
    || !Array.isArray(raw.scenarios) || !raw.scenarios.every(isScenario)
    || !Array.isArray(raw.scenery) || !raw.scenery.every(isScenery)
    || !isRecord(metadata)
    || !isFiniteNumber(metadata.createdAt)
    || !isFiniteNumber(metadata.updatedAt)) {
    return incompatible(raw, 'data does not match schema version 1.');
  }

  return { compatible: true, world: raw as unknown as WorldData };
}
