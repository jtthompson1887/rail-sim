import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';
import { CabConfig } from '../CabConfig';

/**
 * Concrete quality tiers for the 3-D cab view.
 *
 * The "auto" setting used by the HUD is a UI concept; this model only deals
 * with the concrete tiers that can actually be applied to a snapshot.
 */
export type CabQualityTier = 'low' | 'medium' | 'high' | 'ultra';

export const CAB_QUALITY_TIERS: readonly CabQualityTier[] = Object.freeze([
  'low',
  'medium',
  'high',
  'ultra',
]);

export const DEFAULT_QUALITY_TIER: CabQualityTier = 'medium';

/** Per-tier rendering settings. */
export interface CabTierSettings {
  /** Hardware scaling level passed to the Babylon engine. */
  readonly hardwareScale: number;
  /** Number of shadow cascades (0 disables shadows). */
  readonly shadowCascades: number;
  /** Shadow map resolution in pixels. */
  readonly shadowMapSize: number;
  /** Whether the outer terrain LOD ring is built. */
  readonly farTerrainRing: boolean;
  /** Maximum straight-line distance to draw instanced scenery. */
  readonly sceneryRadiusM: number;
  /** Centre-to-centre spacing of sleepers along the track. */
  readonly sleeperSpacingM: number;
  /** Whether bloom is enabled. */
  readonly bloomEnabled: boolean;
  /** Whether FXAA is enabled. */
  readonly fxaaEnabled: boolean;
  /** Whether depth of field is enabled. */
  readonly dofEnabled: boolean;
  /** Whether chromatic aberration is enabled. */
  readonly chromaticEnabled: boolean;
  /** Whether film grain is enabled. */
  readonly grainEnabled: boolean;
  /** Whether motion blur is enabled. */
  readonly motionBlurEnabled: boolean;
  /** Maximum active precipitation particles. */
  readonly weatherParticleCap: number;
}

export const TIER_SETTINGS: Readonly<Record<CabQualityTier, CabTierSettings>> =
  Object.freeze({
    low: Object.freeze({
      hardwareScale: 0.65,
      shadowCascades: 0,
      shadowMapSize: 0,
      farTerrainRing: false,
      sceneryRadiusM: 250,
      sleeperSpacingM: CabConfig.SLEEPER_SPACING_M * 4,
      bloomEnabled: false,
      fxaaEnabled: true,
      dofEnabled: false,
      chromaticEnabled: false,
      grainEnabled: false,
      motionBlurEnabled: false,
      weatherParticleCap: 0,
    }),
    medium: Object.freeze({
      hardwareScale: 0.8,
      shadowCascades: 2,
      shadowMapSize: 1024,
      farTerrainRing: true,
      sceneryRadiusM: 450,
      sleeperSpacingM: CabConfig.SLEEPER_SPACING_M * 2,
      bloomEnabled: true,
      fxaaEnabled: true,
      dofEnabled: false,
      chromaticEnabled: false,
      grainEnabled: false,
      motionBlurEnabled: false,
      weatherParticleCap: 800,
    }),
    high: Object.freeze({
      hardwareScale: 1.0,
      shadowCascades: 3,
      shadowMapSize: 2048,
      farTerrainRing: true,
      sceneryRadiusM: 800,
      sleeperSpacingM: CabConfig.SLEEPER_SPACING_M,
      bloomEnabled: true,
      fxaaEnabled: true,
      dofEnabled: true,
      chromaticEnabled: true,
      grainEnabled: true,
      motionBlurEnabled: false,
      weatherParticleCap: 2500,
    }),
    ultra: Object.freeze({
      hardwareScale: 1.0,
      shadowCascades: 4,
      shadowMapSize: 2048,
      farTerrainRing: true,
      sceneryRadiusM: 1200,
      sleeperSpacingM: CabConfig.SLEEPER_SPACING_M,
      bloomEnabled: true,
      fxaaEnabled: true,
      dofEnabled: true,
      chromaticEnabled: true,
      grainEnabled: true,
      motionBlurEnabled: true,
      weatherParticleCap: 4000,
    }),
  });

/**
 * Select a concrete quality tier from a measured average frame rate.
 *
 * Thresholds: low < 30, medium 30-44, high 45-59, ultra ≥ 60.
 */
export function getTierForFps(averageFps: number): CabQualityTier {
  if (averageFps >= 60) return 'ultra';
  if (averageFps >= 45) return 'high';
  if (averageFps >= 30) return 'medium';
  return 'low';
}

/** Type guard for concrete quality tier values. */
export function isCabQualityTier(value: unknown): value is CabQualityTier {
  return (
    typeof value === 'string' &&
    (CAB_QUALITY_TIERS as readonly string[]).indexOf(value) !== -1
  );
}

/**
 * Apply a concrete quality tier to a world snapshot.
 *
 * Returns a new frozen snapshot containing the tier and all derived settings
 * (hardware scale, shadow cascades, scenery radius, post-FX toggles, etc.)
 * so downstream builders can read everything from a single plain object.
 */
export function applyTier(
  snapshot: Readonly<CabWorldSnapshot>,
  tier: CabQualityTier,
): Readonly<CabWorldSnapshot> {
  const settings = TIER_SETTINGS[tier];
  return Object.freeze({
    ...snapshot,
    ...settings,
    tier,
  }) as Readonly<CabWorldSnapshot>;
}
