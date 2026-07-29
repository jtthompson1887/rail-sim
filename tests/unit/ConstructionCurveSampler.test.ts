import {
  CURVE_FLATNESS_TOLERANCE,
  CURVE_LENGTH_UNCERTAINTY,
  isStrictlyForwardStraightCubic,
  sampleConstructionCurve,
} from '../../src/systems/ConstructionCurveSampler';
import {
  MAX_ANALYSIS_SAMPLES,
  MAX_SEGMENT_LENGTH,
  TERRAIN_ANALYSIS_SPACING,
} from '../../src/config/ConstructionConfig';
import {
  createTrackGeometry,
  deriveAutomaticCubic,
  type TrackGeometryDef,
} from '../../src/systems/TrackGeometry';

function straight(length: number): TrackGeometryDef {
  return {
    geometryVersion: 1,
    p0: { x: -length / 2, y: 0 },
    p1: { x: -length / 6, y: 0 },
    p2: { x: length / 6, y: 0 },
    p3: { x: length / 2, y: 0 },
  };
}

function referencePointAt(def: TrackGeometryDef, t: number) {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * def.p0.x
      + 3 * inverse ** 2 * t * def.p1.x
      + 3 * inverse * t ** 2 * def.p2.x
      + t ** 3 * def.p3.x,
    y: inverse ** 3 * def.p0.y
      + 3 * inverse ** 2 * t * def.p1.y
      + 3 * inverse * t ** 2 * def.p2.y
      + t ** 3 * def.p3.y,
  };
}

function referenceStraightProfile(def: TrackGeometryDef) {
  const chord = {
    x: def.p3.x - def.p0.x,
    y: def.p3.y - def.p0.y,
  };
  const chordLength = Math.hypot(chord.x, chord.y);
  const chordUnit = {
    x: chord.x / chordLength,
    y: chord.y / chordLength,
  };
  const intervalCount = Math.max(
    1,
    Math.ceil((chordLength - 1e-9) / TERRAIN_ANALYSIS_SPACING),
  );
  const intervalLength = chordLength / intervalCount;
  const profile = [{
    t: 0,
    point: { ...def.p0 },
    distance: 0,
    segmentLength: 0,
  }];
  let previousT = 0;
  for (let index = 1; index < intervalCount; index++) {
    const targetDistance = intervalLength * index;
    let low = previousT;
    let high = 1;
    for (let iteration = 0; iteration < 48; iteration++) {
      const candidateT = (low + high) / 2;
      const candidatePoint = referencePointAt(def, candidateT);
      const projectedDistance =
        (candidatePoint.x - def.p0.x) * chordUnit.x
        + (candidatePoint.y - def.p0.y) * chordUnit.y;
      if (projectedDistance < targetDistance) low = candidateT;
      else high = candidateT;
    }
    previousT = (low + high) / 2;
    profile.push({
      t: previousT,
      point: referencePointAt(def, previousT),
      distance: targetDistance,
      segmentLength: intervalLength,
    });
  }
  profile.push({
    t: 1,
    point: { ...def.p3 },
    distance: chordLength,
    segmentLength: intervalLength,
  });
  return {
    ok: true,
    samples: profile,
    length: chordLength,
    maxLengthError: 0,
  };
}

function referenceLength(def: TrackGeometryDef): number {
  return createTrackGeometry(def).approximateLength(200_000);
}

function derivativeAt(def: TrackGeometryDef, t: number): { x: number; y: number } {
  const inverse = 1 - t;
  return {
    x: 3 * (
      inverse ** 2 * (def.p1.x - def.p0.x)
      + 2 * inverse * t * (def.p2.x - def.p1.x)
      + t ** 2 * (def.p3.x - def.p2.x)
    ),
    y: 3 * (
      inverse ** 2 * (def.p1.y - def.p0.y)
      + 2 * inverse * t * (def.p2.y - def.p1.y)
      + t ** 2 * (def.p3.y - def.p2.y)
    ),
  };
}

function intervalUpperBound(
  def: TrackGeometryDef,
  t0: number,
  t1: number,
): number {
  const geometry = createTrackGeometry(def);
  const p0 = geometry.pointAt(t0);
  const p3 = geometry.pointAt(t1);
  const span = t1 - t0;
  const d0 = derivativeAt(def, t0);
  const d1 = derivativeAt(def, t1);
  const p1 = { x: p0.x + d0.x * span / 3, y: p0.y + d0.y * span / 3 };
  const p2 = { x: p3.x - d1.x * span / 3, y: p3.y - d1.y * span / 3 };
  return Math.hypot(p1.x - p0.x, p1.y - p0.y)
    + Math.hypot(p2.x - p1.x, p2.y - p1.y)
    + Math.hypot(p3.x - p2.x, p3.y - p2.y);
}

describe('sampleConstructionCurve', () => {
  it('represents the exact maximum straight with 96 positions and exact endpoints', () => {
    const result = sampleConstructionCurve(straight(MAX_SEGMENT_LENGTH));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a bounded curve profile');
    expect(result.samples).toHaveLength(MAX_ANALYSIS_SAMPLES);
    expect(result.samples[0]).toEqual({
      t: 0,
      point: { x: -3040, y: 0 },
      distance: 0,
      segmentLength: 0,
    });
    expect(result.samples[MAX_ANALYSIS_SAMPLES - 1].t).toBe(1);
    expect(result.samples[MAX_ANALYSIS_SAMPLES - 1].point).toEqual({ x: 3040, y: 0 });
    expect(result.length).toBe(MAX_SEGMENT_LENGTH);
    expect(result.maxLengthError).toBe(0);
    expect(Object.isFrozen(result.samples)).toBe(true);
    expect(result.samples.every(Object.isFrozen)).toBe(true);
  });

  it('balances a production automatic 6,080-unit straight into exactly 96 positions', () => {
    const geometry = deriveAutomaticCubic({
      start: { x: -3040, y: 0 },
      end: { x: 3040, y: 0 },
    });

    const result = sampleConstructionCurve(geometry);

    expect(result.ok).toBe(true);
    if (result.ok === false) throw new Error('Expected a bounded curve profile');
    expect(result.samples).toHaveLength(MAX_ANALYSIS_SAMPLES);
    expect(result.samples[0].point).toEqual(geometry.p0);
    expect(result.samples[MAX_ANALYSIS_SAMPLES - 1].point).toEqual(geometry.p3);
    expect(result.samples.every((sample, index) => (
      index === 0
      || intervalUpperBound(
        geometry,
        result.samples[index - 1].t,
        sample.t,
      ) <= TERRAIN_ANALYSIS_SPACING + 1e-7
    ))).toBe(true);
  });

  it.each([
    ['clamped-control long', deriveAutomaticCubic({
      start: { x: -3_040, y: 0 },
      end: { x: 3_040, y: 0 },
    })],
    ['diagonal', deriveAutomaticCubic({
      start: { x: -2_000, y: -1_000 },
      end: { x: 2_000, y: 3_000 },
    })],
    ['short', deriveAutomaticCubic({
      start: { x: 0, y: 0 },
      end: { x: 192, y: 0 },
    })],
  ])('gives every %s straight interval exact equal-distance accounting', (
    _label,
    geometry,
  ) => {
    const result = sampleConstructionCurve(geometry);
    const chord = Math.hypot(
      geometry.p3.x - geometry.p0.x,
      geometry.p3.y - geometry.p0.y,
    );
    const intervalCount = Math.ceil(chord / TERRAIN_ANALYSIS_SPACING);
    const expectedSegmentLength = chord / intervalCount;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.length).toBe(chord);
    expect(result.maxLengthError).toBe(0);
    expect(result.samples).toHaveLength(intervalCount + 1);
    for (let index = 1; index < result.samples.length; index++) {
      expect(result.samples[index].segmentLength)
        .toBe(expectedSegmentLength);
      expect(result.samples[index].distance)
        .toBe(expectedSegmentLength * index);
    }
  });

  it.each([
    ['long', deriveAutomaticCubic({
      start: { x: -3_040, y: 0 },
      end: { x: 3_040, y: 0 },
    })],
    ['diagonal', deriveAutomaticCubic({
      start: { x: -2_000, y: -1_000 },
      end: { x: 2_000, y: 3_000 },
    })],
    ['short', deriveAutomaticCubic({
      start: { x: 0, y: 0 },
      end: { x: 192, y: 0 },
    })],
  ])('matches the allocation-heavy %s straight reference exactly', (
    _label,
    geometry,
  ) => {
    expect(sampleConstructionCurve(geometry))
      .toEqual(referenceStraightProfile(geometry));
  });

  it.each([
    ['review case', {
      geometryVersion: 1 as const,
      p0: { x: 0, y: 0 },
      p1: { x: 0.00004, y: 0.0000001 },
      p2: { x: 500.00004, y: -0.0000001 },
      p3: { x: 1000, y: 0 },
    }],
    ['sub-tolerance endpoint curvature', {
      geometryVersion: 1 as const,
      p0: { x: 0, y: 0 },
      p1: { x: 0.00004, y: 0.00000004 },
      p2: { x: 500.00004, y: -0.00000004 },
      p3: { x: 1000, y: 0 },
    }],
  ])('keeps the hostile %s cubic on the general sampler path', (
    _label,
    geometry,
  ) => {
    const result = sampleConstructionCurve(geometry);

    expect(isStrictlyForwardStraightCubic(geometry)).toBe(false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maxLengthError).toBeGreaterThan(0);
  });

  it('keeps a canonical short stationary chord on the general path', () => {
    const geometry = deriveAutomaticCubic({
      start: { x: 0, y: 0 },
      end: { x: 50, y: 0 },
    });
    const result = sampleConstructionCurve(geometry);

    expect(isStrictlyForwardStraightCubic(geometry)).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('fails without allocating a 97th position when a straight exceeds the cap', () => {
    const result = sampleConstructionCurve(straight(MAX_SEGMENT_LENGTH + 1));

    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error('Expected survey exhaustion');
    expect(result.lowerBoundLength).toBeGreaterThan(MAX_SEGMENT_LENGTH);
  });

  it('is deterministic and brackets a high-resolution curved reference length', () => {
    const geometry: TrackGeometryDef = {
      geometryVersion: 1,
      p0: { x: -900, y: 0 },
      p1: { x: -300, y: 420 },
      p2: { x: 300, y: 420 },
      p3: { x: 900, y: 0 },
    };

    const first = sampleConstructionCurve(geometry);
    const second = sampleConstructionCurve(geometry);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('Expected a bounded curve profile');
    const reference = referenceLength(geometry);
    expect(Math.abs(first.length - reference)).toBeLessThanOrEqual(
      first.maxLengthError + 1e-5,
    );
    expect(first.maxLengthError).toBeLessThanOrEqual(CURVE_LENGTH_UNCERTAINTY);
    expect(first.samples.length).toBeLessThanOrEqual(MAX_ANALYSIS_SAMPLES);
  });

  it('keeps every returned interval within spacing and flatness tolerances', () => {
    const geometryDef: TrackGeometryDef = {
      geometryVersion: 1,
      p0: { x: -700, y: -80 },
      p1: { x: -260, y: 520 },
      p2: { x: 420, y: -460 },
      p3: { x: 800, y: 120 },
    };
    const geometry = createTrackGeometry(geometryDef);
    const result = sampleConstructionCurve(geometryDef);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a bounded curve profile');
    for (let index = 1; index < result.samples.length; index++) {
      const start = result.samples[index - 1];
      const end = result.samples[index];
      expect(end.segmentLength).toBeLessThanOrEqual(TERRAIN_ANALYSIS_SPACING + 1e-9);
      for (const fraction of [0.25, 0.5, 0.75]) {
        const t = start.t + (end.t - start.t) * fraction;
        const point = geometry.pointAt(t);
        const chordPoint = {
          x: start.point.x + (end.point.x - start.point.x) * fraction,
          y: start.point.y + (end.point.y - start.point.y) * fraction,
        };
        expect(Math.hypot(point.x - chordPoint.x, point.y - chordPoint.y))
          .toBeLessThanOrEqual(CURVE_FLATNESS_TOLERANCE + 1e-9);
      }
    }
  });

  it('returns bounded survey exhaustion when curvature would require position 97', () => {
    const result = sampleConstructionCurve({
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 8000, y: 6000 },
      p2: { x: -8000, y: 6000 },
      p3: { x: 64, y: 0 },
    });

    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error('Expected survey exhaustion');
    expect(result.lowerBoundLength).toBeGreaterThan(0);
  });
});
