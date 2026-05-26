import type { SceneryType, BiomeType } from './WorldData';

/** Describes a single scenery asset category. */
export interface SceneryAssetDef {
  /** Asset type identifier. */
  type: SceneryType;
  /** Terrain band names where this asset may appear. */
  preferredBands: string[];
  /** Relative likelihood of this asset being chosen (higher = more common). */
  densityWeight: number;
  /** Minimum object scale applied to the base drawing. */
  minScale: number;
  /** Maximum object scale applied to the base drawing. */
  maxScale: number;
  /** Number of visual variants (0-indexed). */
  variantCount: number;
  /** Maximum terrain slope in degrees above which this asset is suppressed. */
  maxSlopeDeg: number;
  /**
   * Clustering radius in world-units. When > 0, nearby points have an
   * increased chance of picking the same asset type.
   */
  clusterRadius: number;
  /** Full rotation allowed (true) or restricted to ±15 ° (false). */
  freeRotation: boolean;
}

/** Per-biome overrides to asset density weights (type → weight multiplier). */
export type BiomeWeightOverrides = Partial<Record<SceneryType, number>>;

/** Master asset definition table. */
export const SCENERY_ASSETS: SceneryAssetDef[] = [
  // ── Trees ──────────────────────────────────────────────────────────────────
  {
    type: 'tree_oak',
    preferredBands: ['LOWLAND', 'MIDLAND'],
    densityWeight: 10,
    minScale: 0.7,
    maxScale: 1.3,
    variantCount: 3,
    maxSlopeDeg: 22,
    clusterRadius: 400,
    freeRotation: false,
  },
  {
    type: 'tree_pine',
    preferredBands: ['MIDLAND', 'HIGHLAND'],
    densityWeight: 9,
    minScale: 0.65,
    maxScale: 1.2,
    variantCount: 3,
    maxSlopeDeg: 25,
    clusterRadius: 350,
    freeRotation: false,
  },
  {
    type: 'tree_birch',
    preferredBands: ['LOWLAND', 'MIDLAND'],
    densityWeight: 6,
    minScale: 0.6,
    maxScale: 1.1,
    variantCount: 2,
    maxSlopeDeg: 20,
    clusterRadius: 300,
    freeRotation: false,
  },
  {
    type: 'tree_dead',
    preferredBands: ['HIGHLAND', 'MIDLAND'],
    densityWeight: 3,
    minScale: 0.7,
    maxScale: 1.0,
    variantCount: 2,
    maxSlopeDeg: 30,
    clusterRadius: 200,
    freeRotation: false,
  },
  // ── Rocks ──────────────────────────────────────────────────────────────────
  {
    type: 'rock_boulder',
    preferredBands: ['HIGHLAND', 'PEAK', 'MIDLAND'],
    densityWeight: 5,
    minScale: 0.6,
    maxScale: 1.4,
    variantCount: 4,
    maxSlopeDeg: 40,
    clusterRadius: 150,
    freeRotation: true,
  },
  {
    type: 'rock_outcrop',
    preferredBands: ['HIGHLAND', 'PEAK'],
    densityWeight: 4,
    minScale: 0.8,
    maxScale: 1.5,
    variantCount: 3,
    maxSlopeDeg: 45,
    clusterRadius: 250,
    freeRotation: true,
  },
  {
    type: 'rock_cluster',
    preferredBands: ['MIDLAND', 'HIGHLAND'],
    densityWeight: 4,
    minScale: 0.7,
    maxScale: 1.2,
    variantCount: 3,
    maxSlopeDeg: 35,
    clusterRadius: 200,
    freeRotation: true,
  },
  // ── Terrain variations ─────────────────────────────────────────────────────
  {
    type: 'terrain_pond',
    preferredBands: ['LOWLAND'],
    densityWeight: 2,
    minScale: 0.8,
    maxScale: 1.6,
    variantCount: 1,
    maxSlopeDeg: 8,
    clusterRadius: 0,
    freeRotation: true,
  },
  {
    type: 'terrain_cliff',
    preferredBands: ['HIGHLAND', 'PEAK'],
    densityWeight: 3,
    minScale: 1.0,
    maxScale: 1.8,
    variantCount: 2,
    maxSlopeDeg: 90,
    clusterRadius: 500,
    freeRotation: false,
  },
  {
    type: 'terrain_mound',
    preferredBands: ['MIDLAND', 'LOWLAND'],
    densityWeight: 2,
    minScale: 0.9,
    maxScale: 1.5,
    variantCount: 2,
    maxSlopeDeg: 18,
    clusterRadius: 300,
    freeRotation: true,
  },
];

/**
 * Per-biome density-weight multipliers.
 * A multiplier of 0 effectively disables that asset type for the biome.
 */
export const BIOME_WEIGHTS: Record<BiomeType, BiomeWeightOverrides> = {
  temperate: {
    tree_oak: 1.4,
    tree_birch: 1.2,
    rock_boulder: 0.8,
    terrain_pond: 1.3,
  },
  alpine: {
    tree_pine: 1.8,
    tree_oak: 0.4,
    tree_birch: 0.3,
    rock_boulder: 1.6,
    rock_outcrop: 1.8,
    terrain_cliff: 1.6,
    terrain_pond: 0.3,
  },
  arid: {
    tree_oak: 0.2,
    tree_pine: 0.1,
    tree_birch: 0.1,
    tree_dead: 2.5,
    rock_boulder: 2.0,
    rock_outcrop: 1.8,
    rock_cluster: 1.6,
    terrain_pond: 0.1,
    terrain_mound: 1.4,
  },
  tropical: {
    tree_oak: 2.0,
    tree_birch: 1.4,
    tree_pine: 0.2,
    rock_boulder: 0.6,
    terrain_pond: 2.0,
  },
};

/**
 * Per-biome terrain colour palettes, keyed by band name.
 * Each value is a 24-bit RGB hex colour number.
 */
export type BandName = 'WATER' | 'LOWLAND' | 'MIDLAND' | 'HIGHLAND' | 'PEAK';

export const BIOME_PALETTES: Record<BiomeType, Record<BandName, number>> = {
  temperate: {
    WATER:    0x1e4d7a,
    LOWLAND:  0x3a6e2e,
    MIDLAND:  0x5a7a3a,
    HIGHLAND: 0x7a6a50,
    PEAK:     0xd0cfc8,
  },
  alpine: {
    WATER:    0x1a3a5c,
    LOWLAND:  0x2a5a38,
    MIDLAND:  0x4a5a48,
    HIGHLAND: 0x8a8a8a,
    PEAK:     0xf0f0f0,
  },
  arid: {
    WATER:    0x1e4d7a,
    LOWLAND:  0xc4a96a,
    MIDLAND:  0xa07040,
    HIGHLAND: 0x804030,
    PEAK:     0xb09080,
  },
  tropical: {
    WATER:    0x1a6090,
    LOWLAND:  0x2a8a2a,
    MIDLAND:  0x3a7a2a,
    HIGHLAND: 0x6a7a40,
    PEAK:     0xb0a080,
  },
};

/**
 * Return the effective density weight for an asset in a given biome,
 * applying per-biome overrides.
 */
export function effectiveWeight(asset: SceneryAssetDef, biome: BiomeType): number {
  const override = BIOME_WEIGHTS[biome][asset.type];
  return asset.densityWeight * (override ?? 1);
}
