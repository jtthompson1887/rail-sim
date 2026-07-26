/**
 * Public API for the cab-view quality system.
 *
 * - `CabQualityTier` and the concrete tier helpers are defined in
 *   {@link ./CabQualityTier.ts}.
 * - `CabQualitySetting` adds the "auto" option used by the HUD.
 */

import type { CabQualityTier, CabTierSettings } from './CabQualityTier';
export {
  CAB_QUALITY_TIERS,
  DEFAULT_QUALITY_TIER,
  TIER_SETTINGS,
  applyTier,
  getTierForFps,
  isCabQualityTier,
} from './CabQualityTier';

export type { CabQualityTier, CabTierSettings } from './CabQualityTier';

/** UI-visible setting, including the automatic tier selector. */
export type CabQualitySetting = 'auto' | CabQualityTier;

export const CAB_QUALITY_SETTINGS: readonly CabQualitySetting[] = Object.freeze([
  'auto',
  'low',
  'medium',
  'high',
  'ultra',
]);

/** Default UI setting: let the renderer auto-select the tier. */
export const DEFAULT_QUALITY_SETTING: CabQualitySetting = 'auto';

/** Human-readable label for a setting. */
export function getQualityTierLabel(tier: CabQualitySetting): string {
  switch (tier) {
    case 'auto':
      return 'Auto';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'ultra':
      return 'Ultra';
    default:
      return String(tier);
  }
}
