import type { VehicleType } from './VehicleTypes';

/** Serialised control point (Bézier p0–p3) */
export interface Vec2Def {
  x: number;
  y: number;
}

/** A serialised RailTrack (cubic Bézier). */
export interface TrackDef {
  uuid: string;
  p0: Vec2Def;
  p1: Vec2Def;
  p2: Vec2Def;
  p3: Vec2Def;
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
  /** Vehicle type. Defaults to 'locomotive' for backward compatibility. */
  type?: VehicleType;
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

/** The root world data blob persisted to localStorage. */
export interface WorldData {
  id: string;
  name: string;
  seed: string;
  /** Separate seed used exclusively for terrain generation. */
  terrainSeed: string;
  /** Biome type controlling colour palettes and scenery asset weights. */
  biome: BiomeType;
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
    id: crypto.randomUUID(),
    name,
    seed: resolvedSeed,
    terrainSeed: resolvedSeed,
    biome,
    tracks: [],
    junctions: [],
    stations: [],
    trains: [],
    scenarios: [],
    scenery: [],
    metadata: { createdAt: now, updatedAt: now },
  };
}

/**
 * Migrate a raw saved world blob so that any fields added after initial release
 * are back-filled with sane defaults. Safe to call on already-current worlds.
 */
export function migrateWorld(raw: Partial<WorldData>): WorldData {
  const trains = (raw.trains ?? []).map((t) => ({
    ...t,
    type: t.type ?? 'locomotive',
  }));
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? 'Unnamed World',
    seed: raw.seed ?? Date.now().toString(),
    terrainSeed: raw.terrainSeed ?? (raw.seed ?? Date.now().toString()),
    biome: raw.biome ?? 'temperate',
    tracks: raw.tracks ?? [],
    junctions: raw.junctions ?? [],
    stations: raw.stations ?? [],
    trains,
    scenarios: raw.scenarios ?? [],
    scenery: raw.scenery ?? [],
    metadata: raw.metadata ?? { createdAt: Date.now(), updatedAt: Date.now() },
  };
}
