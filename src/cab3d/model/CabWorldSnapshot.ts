import type { BiomeType, StructureType } from '../../config/WorldData';

export type { BiomeType, StructureType };

export interface CabTrackSample {
  /** World X coordinate in metres. */
  x: number;
  /** World Y coordinate in metres (game Y, positive downward). */
  y: number;
  /** Elevation above sea level in metres. */
  elevation: number;
  /** Heading in radians, 0 = +X, positive counter-clockwise. */
  headingRad: number;
  /** Signed curvature (1 / radius), positive for left turns. */
  curvature: number;
  /** Track structure at this sample. */
  structure: StructureType;
  /** Distance from the eye in metres (positive ahead, negative behind). */
  distance: number;
}

export interface CabVehicleSnapshot {
  /** Vehicle identifier. */
  id: string;
  /** World position in metres. */
  x: number;
  y: number;
  /** Heading in radians. */
  headingRad: number;
  /** Speed in metres per second. */
  speedMps: number;
  /** Normalised throttle/brake [-1, 1]. */
  throttle: number;
  /** Whether the vehicle has derailed. */
  derailed: boolean;
  /** Whether the vehicle is currently aligned to a track. */
  onTrack: boolean;
}

export interface CabWorldSnapshot {
  /** False when no selected train is available or the world is not ready. */
  readonly valid: boolean;
  /** Seed used for deterministic effects (weather, scenery). */
  readonly seed: string;
  /** Current biome. */
  readonly biome: BiomeType;
  /** Snapshot of the followed vehicle. */
  readonly vehicle: CabVehicleSnapshot | null;
  /** Reparametrised track samples from {@link CabConfig.NEAR_DISTANCE_M}
   *  to {@link CabConfig.FAR_DISTANCE_M}. */
  readonly path: ReadonlyArray<CabTrackSample>;
  /** Elapsed simulation time in seconds. */
  readonly elapsedSecs: number;
}

/** Sentinel returned when a snapshot cannot be produced. */
export const INVALID_SNAPSHOT: Readonly<CabWorldSnapshot> = Object.freeze({
  valid: false,
  seed: '',
  biome: 'temperate',
  vehicle: null,
  path: Object.freeze([]),
  elapsedSecs: 0,
});
