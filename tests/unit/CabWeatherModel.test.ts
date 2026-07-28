import type { BiomeType } from '../../src/config/WorldData';
import {
  computeWeatherState,
  lerpWeather,
  WEATHER_STATE_TABLE,
  DEFAULT_WEATHER,
  type CabWeatherState,
} from '../../src/cab3d/atmosphere/CabWeatherModel';

const CLEAR = Object.freeze({ key: 'a', state: 'clear' as const, ...WEATHER_STATE_TABLE.clear });
const RAIN = Object.freeze({ key: 'b', state: 'rain' as const, ...WEATHER_STATE_TABLE.rain });

function makeState(type: keyof typeof WEATHER_STATE_TABLE): Readonly<CabWeatherState> {
  return Object.freeze({
    key: type,
    state: type,
    ...WEATHER_STATE_TABLE[type],
  });
}

describe('CabWeatherModel', () => {
  describe('computeWeatherState', () => {
    it('returns the same state for identical inputs', () => {
      const a = computeWeatherState('seed-1', 123.4, 'temperate');
      const b = computeWeatherState('seed-1', 123.4, 'temperate');
      expect(a).toEqual(b);
      expect(Object.isFrozen(a)).toBe(true);
    });

    it('uses a 600-second window for the state key', () => {
      const at0 = computeWeatherState('s', 0, 'temperate');
      const at599 = computeWeatherState('s', 599, 'temperate');
      const at600 = computeWeatherState('s', 600, 'temperate');

      expect(at0.key).toBe(at599.key);
      expect(at0.key).not.toBe(at600.key);
    });

    it('changes state when the window changes', () => {
      const a = computeWeatherState('s', 300, 'temperate');
      const b = computeWeatherState('s', 900, 'temperate');
      expect(b.key).not.toBe(a.key);
    });

    it('produces different states for different seeds', () => {
      const a = computeWeatherState('seed-a', 600, 'temperate');
      const b = computeWeatherState('seed-b', 600, 'temperate');
      expect(a.key).not.toBe(b.key);
    });

    it('maps every returned state to the state table', () => {
      for (let i = 0; i < 200; i += 1) {
        const state = computeWeatherState('seed', i * 600, 'temperate');
        const expected = WEATHER_STATE_TABLE[state.state];
        expect(state.fogDensity).toBe(expected.fogDensity);
        expect(state.sunIntensity).toBe(expected.sunIntensity);
        expect(state.envIntensity).toBe(expected.envIntensity);
        expect(state.particles).toBe(expected.particles);
      }
    });

    it('respects biome weighting over many samples', () => {
      const counts = (biome: BiomeType): Record<string, number> => {
        const result: Record<string, number> = {};
        for (let i = 1; i <= 1000; i += 1) {
          const s = computeWeatherState('biome-test', i * 600, biome);
          result[s.state] = (result[s.state] ?? 0) + 1;
        }
        return result;
      };

      const alpine = counts('alpine');
      const arid = counts('arid');
      const tropical = counts('tropical');
      const temperate = counts('temperate');

      expect((alpine.snow ?? 0)).toBeGreaterThan((temperate.snow ?? 0));
      expect((arid.snow ?? 0)).toBe(0);
      expect((tropical.rain ?? 0)).toBeGreaterThan((temperate.rain ?? 0));
      expect((arid.clear ?? 0)).toBeGreaterThan((tropical.clear ?? 0));
    });

    it('falls back to temperate weights for an unknown biome', () => {
      const valid = computeWeatherState('s', 0, 'temperate');
      const fallback = computeWeatherState('s', 0, 'unknown' as BiomeType);
      expect(fallback.state).toBe(valid.state);
    });
  });

  describe('lerpWeather', () => {
    it('returns the start state at t=0', () => {
      const result = lerpWeather(CLEAR, RAIN, 0);
      expect(result.fogDensity).toBeCloseTo(CLEAR.fogDensity, 10);
      expect(result.sunIntensity).toBeCloseTo(CLEAR.sunIntensity, 10);
      expect(result.envIntensity).toBeCloseTo(CLEAR.envIntensity, 10);
      expect(result.particles).toBe(CLEAR.particles);
    });

    it('returns the end state at t=1', () => {
      const result = lerpWeather(CLEAR, RAIN, 1);
      expect(result.fogDensity).toBeCloseTo(RAIN.fogDensity, 10);
      expect(result.sunIntensity).toBeCloseTo(RAIN.sunIntensity, 10);
      expect(result.envIntensity).toBeCloseTo(RAIN.envIntensity, 10);
      expect(result.particles).toBe(RAIN.particles);
    });

    it('interpolates numeric values monotonically from clear to rain', () => {
      const values = [0, 0.25, 0.5, 0.75, 1].map((t) =>
        lerpWeather(CLEAR, RAIN, t),
      );

      for (let i = 1; i < values.length; i += 1) {
        expect(values[i].fogDensity).toBeGreaterThanOrEqual(values[i - 1].fogDensity);
        expect(values[i].particles).toBeGreaterThanOrEqual(values[i - 1].particles);
        expect(values[i].sunIntensity).toBeLessThanOrEqual(values[i - 1].sunIntensity);
        expect(values[i].envIntensity).toBeLessThanOrEqual(values[i - 1].envIntensity);
      }

      expect(values[2].fogDensity).toBeCloseTo(
        (CLEAR.fogDensity + RAIN.fogDensity) / 2,
        10,
      );
    });

    it('clamps t outside [0, 1]', () => {
      const low = lerpWeather(CLEAR, RAIN, -0.5);
      const high = lerpWeather(CLEAR, RAIN, 1.5);
      expect(low.fogDensity).toBe(CLEAR.fogDensity);
      expect(high.fogDensity).toBe(RAIN.fogDensity);
    });

    it('switches state/key at the midpoint', () => {
      expect(lerpWeather(CLEAR, RAIN, 0.49).state).toBe('clear');
      expect(lerpWeather(CLEAR, RAIN, 0.51).state).toBe('rain');
    });
  });

  describe('state table', () => {
    it.each([
      ['clear', 0.00022, 3.0, 1.0, 0],
      ['overcast', 0.00055, 1.1, 0.7, 0],
      ['rain', 0.0012, 0.8, 0.55, 2500],
      ['snow', 0.0009, 1.4, 0.8, 2500],
      ['fog', 0.0035, 0.6, 0.45, 0],
    ] as const)(
      '%s has the expected values',
      (state, fogDensity, sunIntensity, envIntensity, particles) => {
        const entry = makeState(state);
        expect(entry.fogDensity).toBe(fogDensity);
        expect(entry.sunIntensity).toBe(sunIntensity);
        expect(entry.envIntensity).toBe(envIntensity);
        expect(entry.particles).toBe(particles);
      },
    );
  });

  describe('DEFAULT_WEATHER', () => {
    it('is a frozen clear state', () => {
      expect(DEFAULT_WEATHER.state).toBe('clear');
      expect(DEFAULT_WEATHER.fogDensity).toBe(WEATHER_STATE_TABLE.clear.fogDensity);
      expect(Object.isFrozen(DEFAULT_WEATHER)).toBe(true);
    });
  });
});
