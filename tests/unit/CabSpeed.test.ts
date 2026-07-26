import { computeSpeedMps } from '../../src/cab3d/model/CabSpeed';

describe('CabSpeed', () => {
  it('converts a per-frame velocity to m/s', () => {
    // 10 world-units per 16 ms frame == 625 m/s.
    expect(computeSpeedMps(10, 0, 16)).toBeCloseTo(625, 5);
  });

  it('works for negative Y velocity', () => {
    expect(computeSpeedMps(0, -30, 1000)).toBe(30);
  });

  it('clamps delta to at least 1 ms', () => {
    expect(computeSpeedMps(10, 0, 0)).toBe(10 * 1000);
  });

  it('applies the speed scale multiplier', () => {
    expect(computeSpeedMps(10, 0, 1000, 2)).toBe(20);
  });
});
