import type { StructureType } from '../../src/cab3d/model/CabWorldSnapshot';
import {
  CabPathSampler,
  type CabPathSpan,
} from '../../src/cab3d/model/CabPathSampler';

function makeLinearSpan(
  startDistance: number,
  length: number,
  y = 0,
  elevationFn?: (d: number) => number,
  structure: StructureType = 'surface',
): CabPathSpan {
  return {
    length,
    startDistance,
    endDistance: startDistance + length,
    pointAt(u: number) {
      const d = startDistance + u * length;
      return { x: d, y };
    },
    tangentAt() {
      return { x: 1, y: 0 };
    },
    elevationAt(u: number) {
      const d = startDistance + u * length;
      return elevationFn ? elevationFn(d) : 0;
    },
    structureAt() {
      return structure;
    },
  };
}

function makeArcSpan(
  startDistance: number,
  radius: number,
  angleSpan: number,
): CabPathSpan {
  const length = radius * angleSpan;
  // Circle centred at (0, radius) so the top arc bulges upward (negative Y)
  // and is a visual left turn.
  const centerX = 0;
  const centerY = radius;

  return {
    length,
    startDistance,
    endDistance: startDistance + length,
    pointAt(u: number) {
      const angle = -Math.PI / 2 + angleSpan * (u - 0.5);
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    },
    tangentAt(u: number) {
      const angle = -Math.PI / 2 + angleSpan * (u - 0.5);
      // Tangent for increasing angle around the circle.
      return { x: -Math.sin(angle), y: Math.cos(angle) };
    },
    elevationAt() {
      return 0;
    },
    structureAt() {
      return 'surface';
    },
  };
}

describe('CabPathSampler', () => {
  const sampler = new CabPathSampler();

  it('samples a straight track from -120 m to +800 m at 2 m spacing', () => {
    const spans = [makeLinearSpan(-120, 920)];
    const path = sampler.sample(spans, { near: -120, far: 800, spacing: 2 });

    expect(path.length).toBe(461);
    expect(path[0].distance).toBe(-120);
    expect(path[0].x).toBeCloseTo(-120, 5);
    expect(path[path.length - 1].distance).toBe(800);
    expect(path[path.length - 1].x).toBeCloseTo(800, 5);

    for (const sample of path) {
      expect(sample.headingRad).toBeCloseTo(0, 5);
      expect(sample.curvature).toBe(0);
      expect(sample.structure).toBe('surface');
    }
  });

  it('computes curvature on a 300 m radius curve', () => {
    // 30-degree arc of a 300 m radius circle.
    const spans = [makeArcSpan(0, 300, (30 * Math.PI) / 180)];
    const path = sampler.sample(spans, { near: 0, far: 150, spacing: 2 });

    // Exclude end samples where curvature falls back to 0.
    const midSample = path[Math.floor(path.length / 2)];
    expect(midSample.curvature).toBeGreaterThan(0);
    expect(midSample.curvature).toBeCloseTo(1 / 300, 2);
  });

  it('interpolates a 2% grade', () => {
    const grade = 0.02;
    const spans = [makeLinearSpan(-120, 920, 0, (d) => d * grade)];
    const path = sampler.sample(spans, { near: -120, far: 800, spacing: 2 });

    const sampleAtZero = path.find((s) => s.distance === 0)!;
    expect(sampleAtZero.elevation).toBeCloseTo(0, 5);

    const sampleAt100 = path.find((s) => s.distance === 100)!;
    expect(sampleAt100.elevation).toBeCloseTo(100 * grade, 5);
  });

  it('carries structure types from spans', () => {
    const spans: CabPathSpan[] = [
      makeLinearSpan(-120, 200, 0, undefined, 'surface'),
      makeLinearSpan(80, 400, 0, undefined, 'bridge'),
      makeLinearSpan(480, 320, 0, undefined, 'tunnel'),
    ];
    const path = sampler.sample(spans, { near: -120, far: 800, spacing: 2 });

    const bridgeSample = path.find((s) => s.distance === 100)!;
    expect(bridgeSample.structure).toBe('bridge');

    const tunnelSample = path.find((s) => s.distance === 500)!;
    expect(tunnelSample.structure).toBe('tunnel');
  });

  it('returns an empty array for invalid options', () => {
    expect(sampler.sample([], { near: 0, far: 100, spacing: 2 })).toEqual([]);
    expect(sampler.sample(
      [makeLinearSpan(0, 100)],
      { near: 100, far: 0, spacing: 2 },
    )).toEqual([]);
    expect(sampler.sample(
      [makeLinearSpan(0, 100)],
      { near: 0, far: 100, spacing: 0 },
    )).toEqual([]);
  });
});
