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
});
