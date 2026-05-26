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

/** The root world data blob persisted to localStorage. */
export interface WorldData {
  id: string;
  name: string;
  seed: string;
  tracks: TrackDef[];
  junctions: JunctionDef[];
  stations: WorldStationDef[];
  trains: TrainDef[];
  scenarios: ScenarioDef[];
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

/** Create a blank world with sane defaults. */
export function createEmptyWorld(name: string, seed?: string): WorldData {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    seed: seed ?? now.toString(),
    tracks: [],
    junctions: [],
    stations: [],
    trains: [],
    scenarios: [],
    metadata: { createdAt: now, updatedAt: now },
  };
}
