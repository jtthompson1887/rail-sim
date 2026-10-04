import { GameConfig } from './GameConfig';

export type LandscapePresetId = 'lowlands' | 'coastal' | 'mountains';
export const LANDSCAPE_PRESET_IDS: readonly LandscapePresetId[] = ['lowlands', 'coastal', 'mountains'];

/** Stable v1 landscape shaping. Undefined preserves every legacy seed's original heightfield. */
export function shapeLandscapeHeight(preset: LandscapePresetId | undefined, x: number, y: number, noiseHeight: number): number {
  if (preset === 'lowlands') return 95 + noiseHeight * 0.32;
  if (preset === 'coastal') {
    const shorelineX = -1_800 + 700 * Math.sin(y / 2_200);
    const coastalShelf = Math.max(-140, Math.min(100, (x - shorelineX) * 0.03));
    return coastalShelf + noiseHeight * 0.23;
  }
  if (preset === 'mountains') {
    const valleyAxis = x + 600 * Math.sin(y / 3_000);
    const ridge = Math.sin(valleyAxis / 2_700 + 0.4);
    return 65 + 320 * ridge * ridge + noiseHeight * 0.65;
  }
  return noiseHeight;
}

export const MAX_OPPORTUNITY_ATTEMPTS = 26;
export const MAX_SITE_CANDIDATES_PER_ATTEMPT = 256;
export const MAX_ECONOMY_SITE_CANDIDATES = 256;
export const OPPORTUNITY_CAMERA_PADDING = 160;
export const REGIONAL_ENDPOINT_MIN_CHORD = 1_024;
export const REGIONAL_ENDPOINT_MAX_CHORD = 2_048;

export const WorldGenerationConfig = {
  SITE_GRID_SIZE: 16,
  SITE_FOOTPRINT_RADIUS: 192,
  MAX_SITE_RELIEF: 40,
  SITE_SEARCH_MARGIN: 640,
  MIN_SITE_SEPARATION: 1_600,
  MAX_SITE_SEPARATION: 4_200,
  MIN_FACILITY_SEPARATION: 1_000,
  FACILITY_RAIL_ACCESS_RADIUS: 320,
  MIN_SITE_ELEVATION_DIFFERENCE: 8,
  MAX_PAIR_EVALUATIONS_PER_ATTEMPT: 24,
  DETOUR_OFFSETS: [384, 640, 896, 1_152, 1_408] as readonly number[],
  CAMERA_VIEWPORT_WIDTH: GameConfig.RESOLUTION.WIDTH,
  CAMERA_VIEWPORT_HEIGHT: GameConfig.RESOLUTION.HEIGHT,
  CAMERA_MIN_ZOOM: GameConfig.CAMERA.MIN_ZOOM,
  CAMERA_MAX_ZOOM: 0.8,
  WORLD_HALF_WIDTH: GameConfig.TERRAIN.WORLD_WIDTH / 2,
  WORLD_HALF_HEIGHT: GameConfig.TERRAIN.WORLD_HEIGHT / 2,
} as const;
