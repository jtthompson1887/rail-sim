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
});
