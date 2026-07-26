import { CabConfig } from '../../src/cab3d/CabConfig';

describe('CabConfig', () => {
  it('exposes the Phase 1 tunables', () => {
    expect(CabConfig.ENABLED).toBe(true);
    expect(CabConfig.TOGGLE_KEY).toBe('C');
    expect(CabConfig.EYE_FORWARD_OFFSET_M).toBe(8.5);
    expect(CabConfig.SPEED_SCALE).toBe(1.0);
    expect(CabConfig.DETERMINISTIC).toBe(false);
  });

  it('is frozen so accidental mutation throws', () => {
    expect(Object.isFrozen(CabConfig)).toBe(true);
    expect(() => {
      (CabConfig as any).ENABLED = false;
    }).toThrow();
  });

  it('exposes Phase 4 terrain tunables', () => {
    expect(CabConfig.TERRAIN_RINGS).toHaveLength(3);
    expect(CabConfig.TERRAIN_RINGS[0].extent).toBe(1024);
    expect(CabConfig.TERRAIN_RINGS[0].resolution).toBe(8);
    expect(CabConfig.TERRAIN_RINGS[2].extent).toBe(12288);
    expect(CabConfig.TERRAIN_REBUILD_DISTANCE_M).toBe(64);
    expect(CabConfig.TERRAIN_SKIRT_DEPTH_M).toBe(60);
    expect(CabConfig.TERRAIN_WATER_ALPHA).toBe(0.72);
    expect(CabConfig.TERRAIN_WATER_ROUGHNESS).toBe(0.08);
  });

  it('exposes Phase 5 atmosphere tunables', () => {
    expect(CabConfig.SKY_BOX_SIZE_M).toBe(10000);
    expect(CabConfig.SKY_LUMINANCE).toBe(0.6);
    expect(CabConfig.SKY_TURBIDITY).toBe(4.5);
    expect(CabConfig.SKY_RAYLEIGH).toBe(2.0);
    expect(CabConfig.SKY_MIE_COEFFICIENT).toBe(0.005);
    expect(CabConfig.SKY_MIE_G).toBe(0.82);
    expect(CabConfig.SUN_INTENSITY).toBe(3.0);
    expect(CabConfig.FILL_LIGHT_INTENSITY).toBe(0.35);
    expect(CabConfig.CAB_INTERIOR_LIGHT_LOCAL_Y_M).toBe(3.10);
    expect(CabConfig.CAB_INTERIOR_LIGHT_INTENSITY).toBe(0.20);
    expect(CabConfig.CAB_INTERIOR_LIGHT_RANGE_M).toBe(4.0);
    expect(CabConfig.SKY_IBL_RESOLUTION).toBe(256);
    expect(CabConfig.SKY_IBL_ALTITUDE_THRESHOLD_DEG).toBe(2);
    expect(CabConfig.TONEMAPPING_EXPOSURE).toBe(1.1);
    expect(CabConfig.TONEMAPPING_CONTRAST).toBe(1.25);
    expect(CabConfig.FOG_DENSITY).toBe(0.00022);
    expect(CabConfig.FOG_COLOR.r).toBeCloseTo(0.65, 10);
  });

  it('exposes Phase 9 shadow and post-FX tunables', () => {
    expect(CabConfig.SHADOW_MAP_SIZE).toBe(2048);
    expect(CabConfig.SHADOW_CASCADES).toBe(3);
    expect(CabConfig.SHADOW_MAX_Z_M).toBe(200);
    expect(CabConfig.SHADOW_LAMBDA).toBe(0.7);

    expect(CabConfig.POSTFX_BLOOM_THRESHOLD).toBe(0.85);
    expect(CabConfig.POSTFX_BLOOM_WEIGHT).toBe(0.35);
    expect(CabConfig.POSTFX_BLOOM_KERNEL).toBe(48);
    expect(CabConfig.POSTFX_BLOOM_SCALE).toBe(0.5);

    expect(CabConfig.POSTFX_DOF_FOCUS_DISTANCE_MM).toBe(40000);
    expect(CabConfig.POSTFX_DOF_FSTOP).toBe(4.0);
    expect(CabConfig.POSTFX_DOF_FOCAL_LENGTH_MM).toBe(45);

    expect(CabConfig.POSTFX_CHROMATIC_ABERRATION).toBe(12);
    expect(CabConfig.POSTFX_GRAIN_INTENSITY).toBe(6);
    expect(CabConfig.POSTFX_MOTION_BLUR_STRENGTH).toBe(0.6);
    expect(CabConfig.POSTFX_MOTION_BLUR_SAMPLES).toBe(12);
  });
});
