import { realPolynomialRootsInUnitInterval } from '../../src/systems/PolynomialRoots';

describe('realPolynomialRootsInUnitInterval', () => {
  it('finds odd and even multiplicity roots of a fifth-degree polynomial', () => {
    // (t - 0.25)^2 (t - 0.5) (t - 0.75)^2
    const roots = realPolynomialRootsInUnitInterval([
      -0.017578125,
      0.22265625,
      -1.0625,
      2.375,
      -2.5,
      1,
    ]);

    expect(roots).toHaveLength(3);
    expect(roots[0]).toBeCloseTo(0.25, 8);
    expect(roots[1]).toBeCloseTo(0.5, 8);
    expect(roots[2]).toBeCloseTo(0.75, 8);
  });

  it('keeps endpoint, repeated, and closely spaced roots deterministic', () => {
    // t (t - 0.2)^2 (t - 0.21) (t - 1)
    const coefficients = [
      0,
      0.008400000000000001,
      -0.13240000000000002,
      0.734,
      -1.6099999999999999,
      1,
    ];

    const first = realPolynomialRootsInUnitInterval(coefficients);
    const second = realPolynomialRootsInUnitInterval(coefficients);

    expect(second).toEqual(first);
    expect(first).toHaveLength(4);
    expect(first[0]).toBeCloseTo(0, 10);
    expect(first[1]).toBeCloseTo(0.2, 7);
    expect(first[2]).toBeCloseTo(0.21, 7);
    expect(first[3]).toBeCloseTo(1, 10);
  });

  it('is scale invariant for finite non-zero coefficient scales', () => {
    const roots = realPolynomialRootsInUnitInterval(
      [-0.017578125, 0.22265625, -1.0625, 2.375, -2.5, 1]
        .map((coefficient) => coefficient * 1e-24),
    );

    expect(roots).toHaveLength(3);
    expect(roots[0]).toBeCloseTo(0.25, 8);
    expect(roots[1]).toBeCloseTo(0.5, 8);
    expect(roots[2]).toBeCloseTo(0.75, 8);
  });
});
