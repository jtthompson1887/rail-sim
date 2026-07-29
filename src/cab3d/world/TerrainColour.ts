import { GameConfig } from '../../config/GameConfig';
import { BIOME_PALETTES, type BandName } from '../../config/SceneryConfig';
import type { BiomeType } from '../../config/WorldData';

const TC = GameConfig.TERRAIN;

/** Band-name order for palette lookups. */
const BAND_ORDER: BandName[] = ['WATER', 'LOWLAND', 'MIDLAND', 'HIGHLAND', 'PEAK'];

/** Upper height bounds for each band, in world-units. */
const BAND_MAX: number[] = [
  TC.BANDS.WATER.max,
  TC.BANDS.LOWLAND.max,
  TC.BANDS.MIDLAND.max,
  TC.BANDS.HIGHLAND.max,
  TC.BANDS.PEAK.max,
];

/** Linearly interpolate two 24-bit RGB colours. */
function lerpColor(c0: number, c1: number, t: number): number {
  const r0 = (c0 >> 16) & 0xff;
  const g0 = (c0 >> 8) & 0xff;
  const b0 = c0 & 0xff;
  const r1 = (c1 >> 16) & 0xff;
  const g1 = (c1 >> 8) & 0xff;
  const b1 = c1 & 0xff;

  const r = Math.round(r0 + (r1 - r0) * t);
  const g = Math.round(g0 + (g1 - g0) * t);
  const b = Math.round(b0 + (b1 - b0) * t);

  return (r << 16) | (g << 8) | b;
}

/**
 * Return the terrain colour for a height value within the given biome,
 * blending smoothly within {@link TC.BAND_BLEND_RANGE} of a band boundary.
 *
 * This replicates the colour logic in {@link TerrainChunk.bandColor} so the
 * 3-D cab view uses the same palette as the 2-D world map.
 */
export function getTerrainColour(height: number, biome: BiomeType): number {
  const palette = BIOME_PALETTES[biome];
  const blend = TC.BAND_BLEND_RANGE;

  for (let i = 0; i < BAND_MAX.length - 1; i++) {
    const threshold = BAND_MAX[i];
    if (threshold === Infinity) break;

    if (height < threshold + blend) {
      const bandName = BAND_ORDER[i];
      const nextName = BAND_ORDER[i + 1];

      if (height > threshold - blend) {
        const t = (height - (threshold - blend)) / (2 * blend);
        return lerpColor(
          palette[bandName],
          palette[nextName],
          Math.max(0, Math.min(1, t)),
        );
      }

      return palette[bandName];
    }
  }

  return palette['PEAK'];
}

/** Return the terrain colour as normalised RGB components in [0, 1]. */
export function getTerrainColourRgb(
  height: number,
  biome: BiomeType,
): { r: number; g: number; b: number } {
  const color = getTerrainColour(height, biome);
  return {
    r: ((color >> 16) & 0xff) / 255,
    g: ((color >> 8) & 0xff) / 255,
    b: (color & 0xff) / 255,
  };
}

/** Return a named biome band colour as normalised RGB components in [0, 1]. */
export function getBandColourRgb(
  biome: BiomeType,
  band: BandName,
): { r: number; g: number; b: number } {
  const color = BIOME_PALETTES[biome][band];
  return {
    r: ((color >> 16) & 0xff) / 255,
    g: ((color >> 8) & 0xff) / 255,
    b: (color & 0xff) / 255,
  };
}
