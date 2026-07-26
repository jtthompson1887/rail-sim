import { GameConfig } from './GameConfig';

export const MAX_ANALYSIS_SAMPLES = 96;
export const TERRAIN_ANALYSIS_SPACING = GameConfig.TERRAIN.SAMPLE_STEP / 2;
export const MAX_SEGMENT_LENGTH =
  TERRAIN_ANALYSIS_SPACING * (MAX_ANALYSIS_SAMPLES - 1);
export const STANDARD_STARTING_CASH = 1_000_000;
export const DEMOLITION_REFUND_RATE = 0.5;
export const ENDPOINT_CONNECTION_COST = 2_500;

export function startingCashForDifficulty(
  difficultyId: 'standard',
): number {
  if (difficultyId !== 'standard') {
    throw new Error(`Unsupported construction difficulty: ${String(difficultyId)}`);
  }
  return STANDARD_STARTING_CASH;
}

export const ConstructionConfig = {
  MIN_SEGMENT_LENGTH: TERRAIN_ANALYSIS_SPACING,
  MAX_GRADE_PERCENT: GameConfig.TERRAIN.MAX_SLOPE_PERCENT,
  MINIMUM_RADIUS: GameConfig.TRACK.MIN_CURVE_RADIUS_PX,
  SURFACE_TOLERANCE: 8,
  BRIDGE_CLEARANCE: 50,
  TUNNEL_DEPTH: 50,
  TRACK_COST_PER_UNIT: 10,
  EARTHWORKS_COST_PER_DEPTH_UNIT: 2,
  BRIDGE_COST_PER_UNIT: 60,
  TUNNEL_COST_PER_UNIT: 100,
} as const;
