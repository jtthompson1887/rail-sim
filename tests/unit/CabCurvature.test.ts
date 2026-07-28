import { curvatureFromPoints } from '../../src/cab3d/model/CabCurvature';

describe('CabCurvature', () => {
  it('returns 0 for three collinear points', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const c = { x: 200, y: 0 };
    expect(curvatureFromPoints(a, b, c)).toBe(0);
  });

  it('returns 0 for coincident points', () => {
    const p = { x: 10, y: 20 };
    expect(curvatureFromPoints(p, p, p)).toBe(0);
  });

  it('is positive for a left-hand turn (bulge upward in screen space)', () => {
    // Approximate points on a circle of radius 300 m centred at (0, 300).
    // The arc bulges toward negative Y, which is a visual left turn.
    const a = { x: -150, y: 300 - 150 * Math.sqrt(3) };
    const b = { x: 0, y: 0 };
    const c = { x: 150, y: 300 - 150 * Math.sqrt(3) };

    const k = curvatureFromPoints(a, b, c);
    expect(k).toBeGreaterThan(0);
    expect(k).toBeCloseTo(1 / 300, 4);
  });

  it('is negative for a right-hand turn (bulge downward in screen space)', () => {
    const a = { x: -150, y: -(300 - 150 * Math.sqrt(3)) };
    const b = { x: 0, y: 0 };
    const c = { x: 150, y: -(300 - 150 * Math.sqrt(3)) };

    const k = curvatureFromPoints(a, b, c);
    expect(k).toBeLessThan(0);
    expect(k).toBeCloseTo(-1 / 300, 4);
  });
});
