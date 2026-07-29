import {
  applyTier,
  getTierForFps,
  isCabQualityTier,
  TIER_SETTINGS,
  type CabQualityTier,
} from '../../src/cab3d/quality/CabQualityTier';
import type { CabWorldSnapshot } from '../../src/cab3d/model/CabWorldSnapshot';
import { CabConfig } from '../../src/cab3d/CabConfig';

describe('CabQualityTier', () => {
  describe('getTierForFps', () => {
    it('selects ultra at 60 fps or above', () => {
      expect(getTierForFps(60)).toBe('ultra');
      expect(getTierForFps(75)).toBe('ultra');
    });

    it('selects high between 45 and 59 fps', () => {
      expect(getTierForFps(45)).toBe('high');
      expect(getTierForFps(59)).toBe('high');
    });

    it('selects medium between 30 and 44 fps', () => {
      expect(getTierForFps(30)).toBe('medium');
      expect(getTierForFps(44)).toBe('medium');
    });

    it('selects low below 30 fps', () => {
      expect(getTierForFps(29)).toBe('low');
      expect(getTierForFps(0)).toBe('low');
    });
  });

  describe('isCabQualityTier', () => {
    it('accepts the four concrete tiers', () => {
      expect(isCabQualityTier('low')).toBe(true);
      expect(isCabQualityTier('medium')).toBe(true);
      expect(isCabQualityTier('high')).toBe(true);
      expect(isCabQualityTier('ultra')).toBe(true);
    });

    it('rejects auto and other strings', () => {
      expect(isCabQualityTier('auto')).toBe(false);
      expect(isCabQualityTier('max')).toBe(false);
      expect(isCabQualityTier(undefined)).toBe(false);
      expect(isCabQualityTier(42)).toBe(false);
    });
  });

  describe('TIER_SETTINGS', () => {
    it('contains the expected per-tier values', () => {
      const low = TIER_SETTINGS.low;
      expect(low.hardwareScale).toBe(0.65);
      expect(low.shadowCascades).toBe(0);
      expect(low.farTerrainRing).toBe(false);
      expect(low.sceneryRadiusM).toBe(250);
      expect(low.sleeperSpacingM).toBe(CabConfig.SLEEPER_SPACING_M * 4);
      expect(low.bloomEnabled).toBe(false);
      expect(low.dofEnabled).toBe(false);
      expect(low.chromaticEnabled).toBe(false);
      expect(low.grainEnabled).toBe(false);
      expect(low.motionBlurEnabled).toBe(false);
      expect(low.weatherParticleCap).toBe(0);

      const medium = TIER_SETTINGS.medium;
      expect(medium.hardwareScale).toBe(0.8);
      expect(medium.shadowCascades).toBe(2);
      expect(medium.shadowMapSize).toBe(1024);
      expect(medium.sceneryRadiusM).toBe(450);
      expect(medium.weatherParticleCap).toBe(800);

      const high = TIER_SETTINGS.high;
      expect(high.hardwareScale).toBe(1.0);
      expect(high.shadowCascades).toBe(3);
      expect(high.shadowMapSize).toBe(2048);
      expect(high.sceneryRadiusM).toBe(800);
      expect(high.weatherParticleCap).toBe(2500);

      const ultra = TIER_SETTINGS.ultra;
      expect(ultra.hardwareScale).toBe(1.0);
      expect(ultra.shadowCascades).toBe(4);
      expect(ultra.sceneryRadiusM).toBe(1200);
      expect(ultra.weatherParticleCap).toBe(4000);
    });
  });

  describe('applyTier', () => {
    const base: CabWorldSnapshot = {
      valid: true,
      seed: 'test',
      biome: 'temperate',
      vehicle: null,
      path: [],
      elapsedSecs: 10,
      weather: null,
    };

    it('returns a frozen snapshot with the tier and derived settings', () => {
      const result = applyTier(base, 'high');
      expect(Object.isFrozen(result)).toBe(true);
      expect(result.tier).toBe('high');
      expect(result.hardwareScale).toBe(1.0);
      expect(result.sceneryRadiusM).toBe(800);
      expect(result.shadowCascades).toBe(3);
      expect(result.shadowMapSize).toBe(2048);
      expect(result.farTerrainRing).toBe(true);
      expect(result.sleeperSpacingM).toBe(CabConfig.SLEEPER_SPACING_M);
      expect(result.bloomEnabled).toBe(true);
      expect(result.dofEnabled).toBe(true);
      expect(result.chromaticEnabled).toBe(true);
      expect(result.grainEnabled).toBe(true);
      expect(result.motionBlurEnabled).toBe(false);
      expect(result.weatherParticleCap).toBe(2500);
    });

    it('preserves the original snapshot fields', () => {
      const result = applyTier(base, 'low');
      expect(result.valid).toBe(true);
      expect(result.seed).toBe('test');
      expect(result.elapsedSecs).toBe(10);
      expect(result.weather).toBeNull();
    });
  });
});
