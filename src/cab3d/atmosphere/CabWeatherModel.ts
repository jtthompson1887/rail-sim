import type { BiomeType } from '../../config/WorldData';

/**
 * Pure, deterministic weather model for the 3-D cab view.
 *
 * No Babylon, DOM, Phaser or mutable module state — safe for unit tests.
 */

export type CabWeatherType = 'clear' | 'overcast' | 'rain' | 'snow' | 'fog';

export interface CabWeatherState {
  /** Deterministic state key used for transition detection. */
  readonly key: string;
  /** Named weather condition. */
  readonly state: CabWeatherType;
  /** Exponential-squared fog density. */
  readonly fogDensity: number;
  /** Directional (sun) light intensity at solar noon. */
  readonly sunIntensity: number;
  /** Scene environment / IBL intensity multiplier. */
  readonly envIntensity: number;
  /** Target precipitation particle count. */
  readonly particles: number;
}

type StateTableEntry = Readonly<
  Omit<CabWeatherState, 'key' | 'state'>
>;

export const WEATHER_STATE_TABLE: Readonly<Record<CabWeatherType, StateTableEntry>> =
  Object.freeze({
    clear: Object.freeze({
      fogDensity: 0.00022,
      sunIntensity: 3.0,
      envIntensity: 1.0,
      particles: 0,
    }),
    overcast: Object.freeze({
      fogDensity: 0.00055,
      sunIntensity: 1.1,
      envIntensity: 0.7,
      particles: 0,
    }),
    rain: Object.freeze({
      fogDensity: 0.0012,
      sunIntensity: 0.8,
      envIntensity: 0.55,
      particles: 2500,
    }),
    snow: Object.freeze({
      fogDensity: 0.0009,
      sunIntensity: 1.4,
      envIntensity: 0.8,
      particles: 2500,
    }),
    fog: Object.freeze({
      fogDensity: 0.0035,
      sunIntensity: 0.6,
      envIntensity: 0.45,
      particles: 0,
    }),
  });

export const BIOME_WEIGHTS: Readonly<
  Record<BiomeType, Readonly<Record<CabWeatherType, number>>>
> = Object.freeze({
  temperate: Object.freeze({
    clear: 0.45,
    overcast: 0.25,
    rain: 0.15,
    snow: 0.05,
    fog: 0.1,
  }),
  alpine: Object.freeze({
    clear: 0.3,
    overcast: 0.2,
    rain: 0.05,
    snow: 0.35,
    fog: 0.1,
  }),
  arid: Object.freeze({
    clear: 0.55,
    overcast: 0.25,
    rain: 0.05,
    snow: 0,
    fog: 0.15,
  }),
  tropical: Object.freeze({
    clear: 0.35,
    overcast: 0.25,
    rain: 0.25,
    snow: 0,
    fog: 0.15,
  }),
});

const ORDERED_WEATHER: readonly CabWeatherType[] = Object.freeze([
  'clear',
  'overcast',
  'rain',
  'snow',
  'fog',
]) as readonly CabWeatherType[];

/** 32-bit FNV-1a hash of a UTF-16 string. */
function hashString(input: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Convert a numeric hash to a hexadecimal key string. */
function keyFromHash(hash: number): string {
  return (hash >>> 0).toString(16);
}

/**
 * Compute the deterministic weather state for the current 10-minute window.
 *
 * The state key is `hash(seed + ':' + floor(elapsedSecs / 600))`. Biome weights
 * drive a deterministic hashed selection from the state table.
 */
export function computeWeatherState(
  seed: string,
  elapsedSecs: number,
  biome: BiomeType,
): Readonly<CabWeatherState> {
  const windowIndex = Math.floor(elapsedSecs / 600);
  const hash = hashString(`${seed}:${windowIndex}`);
  const key = keyFromHash(hash);

  const value = hash / 0x100000000;
  const weights = BIOME_WEIGHTS[biome] ?? BIOME_WEIGHTS.temperate;

  let selected: CabWeatherType = 'clear';
  let cumulative = 0;
  for (const state of ORDERED_WEATHER) {
    cumulative += weights[state];
    if (value < cumulative) {
      selected = state;
      break;
    }
  }

  return Object.freeze({
    key,
    state: selected,
    ...WEATHER_STATE_TABLE[selected],
  });
}

/**
 * Linearly interpolate two weather states.
 *
 * The named `state` and `key` switch at the midpoint; numeric fields are
 * interpolated across the full range. `t` is clamped to [0, 1].
 */
export function lerpWeather(
  a: Readonly<CabWeatherState>,
  b: Readonly<CabWeatherState>,
  t: number,
): Readonly<CabWeatherState> {
  const clamped = Math.max(0, Math.min(1, t));
  const source = clamped < 0.5 ? a : b;

  return Object.freeze({
    key: source.key,
    state: source.state,
    fogDensity: a.fogDensity + (b.fogDensity - a.fogDensity) * clamped,
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * clamped,
    envIntensity: a.envIntensity + (b.envIntensity - a.envIntensity) * clamped,
    particles: a.particles + (b.particles - a.particles) * clamped,
  });
}

/** Fallback clear weather state for invalid snapshots. */
export const DEFAULT_WEATHER: Readonly<CabWeatherState> = Object.freeze({
  key: 'default',
  state: 'clear',
  ...WEATHER_STATE_TABLE.clear,
});
