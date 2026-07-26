/**
 * Quality tier model for the 3-D cab view.
 *
 * This module is intentionally small: automatic tier selection is not yet
 * implemented, so callers display and persist the currently selected tier.
 */

export type CabQualityTier = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

export const CAB_QUALITY_TIERS: readonly CabQualityTier[] = Object.freeze([
  'auto',
  'low',
  'medium',
  'high',
  'ultra',
]);

export const DEFAULT_QUALITY_TIER: CabQualityTier = 'medium';

export const AUTO_QUALITY_TIER: CabQualityTier = 'auto';

/** Human-readable label for a tier. */
export function getQualityTierLabel(tier: CabQualityTier): string {
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
