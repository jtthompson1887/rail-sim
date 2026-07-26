import {
  MAX_ANALYSIS_SAMPLES,
  TERRAIN_ANALYSIS_SPACING,
} from '../config/ConstructionConfig';
import type { Vec2Def } from '../config/WorldData';
import type { TrackGeometryDef } from './TrackGeometry';

export const CURVE_LENGTH_UNCERTAINTY = 0.25;
export const CURVE_FLATNESS_TOLERANCE = 0.5;

const SAMPLER_EPSILON = 1e-9;
const BOUNDARY_BISECTION_STEPS = 48;

export interface ConstructionCurveSample {
  readonly t: number;
  readonly point: Readonly<Vec2Def>;
  readonly distance: number;
  readonly segmentLength: number;
}

export type ConstructionCurveProfile =
  | {
    readonly ok: true;
    readonly samples: readonly ConstructionCurveSample[];
    readonly length: number;
    readonly maxLengthError: number;
  }
  | {
    readonly ok: false;
    readonly lowerBoundLength: number;
  };

interface CubicInterval {
  readonly t0: number;
  readonly t1: number;
  readonly controls: readonly [Vec2Def, Vec2Def, Vec2Def, Vec2Def];
  readonly lowerLength: number;
  readonly upperLength: number;
  readonly flatness: number;
}

function pointAt(def: TrackGeometryDef, t: number): Vec2Def {
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

function derivativeAt(def: TrackGeometryDef, t: number): Vec2Def {
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

function distance(left: Vec2Def, right: Vec2Def): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function distanceToChord(point: Vec2Def, start: Vec2Def, end: Vec2Def): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.hypot(dx, dy);
  if (chordLength <= SAMPLER_EPSILON) return distance(start, point);
  return Math.abs(dx * (start.y - point.y) - (start.x - point.x) * dy)
    / chordLength;
}

function intervalFor(
  def: TrackGeometryDef,
  t0: number,
  t1: number,
): CubicInterval {
  const span = t1 - t0;
  const p0 = pointAt(def, t0);
  const p3 = pointAt(def, t1);
  const startDerivative = derivativeAt(def, t0);
  const endDerivative = derivativeAt(def, t1);
  const p1 = {
    x: p0.x + startDerivative.x * span / 3,
    y: p0.y + startDerivative.y * span / 3,
  };
  const p2 = {
    x: p3.x - endDerivative.x * span / 3,
    y: p3.y - endDerivative.y * span / 3,
  };
  const lowerLength = distance(p0, p3);
  const upperLength = distance(p0, p1) + distance(p1, p2) + distance(p2, p3);
  return {
    t0,
    t1,
    controls: [p0, p1, p2, p3],
    lowerLength,
    upperLength,
    flatness: Math.max(
      distanceToChord(p1, p0, p3),
      distanceToChord(p2, p0, p3),
    ),
  };
}

function balancedBoundaries(def: TrackGeometryDef, intervalCount: number): number[] {
  const boundaries = [0];
  let startT = 0;
  for (let index = 0; index < intervalCount - 1; index++) {
    const intervalsRemaining = intervalCount - index;
    const remainingUpper = intervalFor(def, startT, 1).upperLength;
    const targetUpper = remainingUpper / intervalsRemaining;
    let low = startT;
    let high = 1;
    for (let iteration = 0; iteration < BOUNDARY_BISECTION_STEPS; iteration++) {
      const candidate = (low + high) / 2;
      if (intervalFor(def, startT, candidate).upperLength < targetUpper) {
        low = candidate;
      } else {
        high = candidate;
      }
    }
    startT = (low + high) / 2;
    boundaries.push(startT);
  }
  boundaries.push(1);
  return boundaries;
}

function splitInterval(
  def: TrackGeometryDef,
  intervals: CubicInterval[],
  index: number,
): void {
  const interval = intervals[index];
  const midpoint = (interval.t0 + interval.t1) / 2;
  intervals.splice(
    index,
    1,
    intervalFor(def, interval.t0, midpoint),
    intervalFor(def, midpoint, interval.t1),
  );
}

function lowerBound(intervals: readonly CubicInterval[]): number {
  return intervals.reduce((sum, interval) => sum + interval.lowerLength, 0);
}

function uncertainty(intervals: readonly CubicInterval[]): number {
  return intervals.reduce(
    (sum, interval) => sum + interval.upperLength - interval.lowerLength,
    0,
  ) / 2;
}

function failure(lowerBoundLength: number): ConstructionCurveProfile {
  return Object.freeze({ ok: false as const, lowerBoundLength });
}

function indexOfRequiredSplit(intervals: readonly CubicInterval[]): number {
  let selected = -1;
  let selectedSeverity = -Infinity;
  for (let index = 0; index < intervals.length; index++) {
    const interval = intervals[index];
    const severity = Math.max(
      interval.upperLength / TERRAIN_ANALYSIS_SPACING,
      interval.flatness / CURVE_FLATNESS_TOLERANCE,
    );
    if (
      (interval.upperLength > TERRAIN_ANALYSIS_SPACING + SAMPLER_EPSILON
        || interval.flatness > CURVE_FLATNESS_TOLERANCE + SAMPLER_EPSILON)
      && severity > selectedSeverity + SAMPLER_EPSILON
    ) {
      selected = index;
      selectedSeverity = severity;
    }
  }
  return selected;
}

function indexOfLargestUncertainty(intervals: readonly CubicInterval[]): number {
  let selected = 0;
  let selectedWidth = -Infinity;
  for (let index = 0; index < intervals.length; index++) {
    const width = intervals[index].upperLength - intervals[index].lowerLength;
    if (width > selectedWidth + SAMPLER_EPSILON) {
      selected = index;
      selectedWidth = width;
    }
  }
  return selected;
}

export function sampleConstructionCurve(
  def: TrackGeometryDef,
): ConstructionCurveProfile {
  const endpointChord = distance(def.p0, def.p3);
  const initialIntervalCount = Math.max(
    1,
    Math.ceil((endpointChord - SAMPLER_EPSILON) / TERRAIN_ANALYSIS_SPACING),
  );
  if (initialIntervalCount + 1 > MAX_ANALYSIS_SAMPLES) {
    return failure(endpointChord);
  }

  const boundaries = balancedBoundaries(def, initialIntervalCount);
  const intervals = boundaries.slice(1).map(
    (endT, index) => intervalFor(def, boundaries[index], endT),
  );

  while (true) {
    const requiredIndex = indexOfRequiredSplit(intervals);
    if (requiredIndex < 0) break;
    if (intervals.length + 2 > MAX_ANALYSIS_SAMPLES) {
      return failure(lowerBound(intervals));
    }
    splitInterval(def, intervals, requiredIndex);
  }

  while (uncertainty(intervals) > CURVE_LENGTH_UNCERTAINTY + SAMPLER_EPSILON) {
    if (intervals.length + 2 > MAX_ANALYSIS_SAMPLES) {
      return failure(lowerBound(intervals));
    }
    splitInterval(def, intervals, indexOfLargestUncertainty(intervals));
  }

  let cumulativeDistance = 0;
  const samples: ConstructionCurveSample[] = [
    Object.freeze({
      t: 0,
      point: Object.freeze({ ...def.p0 }),
      distance: 0,
      segmentLength: 0,
    }),
  ];
  for (const interval of intervals) {
    const segmentLength = (interval.lowerLength + interval.upperLength) / 2;
    cumulativeDistance += segmentLength;
    samples.push(Object.freeze({
      t: interval.t1,
      point: Object.freeze({ ...interval.controls[3] }),
      distance: cumulativeDistance,
      segmentLength,
    }));
  }

  return Object.freeze({
    ok: true as const,
    samples: Object.freeze(samples),
    length: cumulativeDistance,
    maxLengthError: uncertainty(intervals),
  });
}
