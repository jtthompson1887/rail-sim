import type { TrackGeometryDef } from '../systems/TrackGeometry';

export interface TrackPose {
  point: { x: number; y: number };
  tangent: { x: number; y: number };
  curvature: number;
}

interface ArcSample {
  t: number;
  distance: number;
  point: { x: number; y: number };
}

function pointAt(geometry: TrackGeometryDef, t: number): { x: number; y: number } {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * geometry.p0.x
      + 3 * inverse ** 2 * t * geometry.p1.x
      + 3 * inverse * t ** 2 * geometry.p2.x
      + t ** 3 * geometry.p3.x,
    y: inverse ** 3 * geometry.p0.y
      + 3 * inverse ** 2 * t * geometry.p1.y
      + 3 * inverse * t ** 2 * geometry.p2.y
      + t ** 3 * geometry.p3.y,
  };
}

function derivativesAt(
  geometry: TrackGeometryDef,
  t: number,
): { first: { x: number; y: number }; second: { x: number; y: number } } {
  const inverse = 1 - t;
  return {
    first: {
      x: 3 * inverse ** 2 * (geometry.p1.x - geometry.p0.x)
        + 6 * inverse * t * (geometry.p2.x - geometry.p1.x)
        + 3 * t ** 2 * (geometry.p3.x - geometry.p2.x),
      y: 3 * inverse ** 2 * (geometry.p1.y - geometry.p0.y)
        + 6 * inverse * t * (geometry.p2.y - geometry.p1.y)
        + 3 * t ** 2 * (geometry.p3.y - geometry.p2.y),
    },
    second: {
      x: 6 * inverse * (geometry.p2.x - 2 * geometry.p1.x + geometry.p0.x)
        + 6 * t * (geometry.p3.x - 2 * geometry.p2.x + geometry.p1.x),
      y: 6 * inverse * (geometry.p2.y - 2 * geometry.p1.y + geometry.p0.y)
        + 6 * t * (geometry.p3.y - 2 * geometry.p2.y + geometry.p1.y),
    },
  };
}

function distanceBetween(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const GAUSS_NODES = [
  -0.906179845938664,
  -0.538469310105683,
  0,
  0.538469310105683,
  0.906179845938664,
];

const GAUSS_WEIGHTS = [
  0.236926885056189,
  0.478628670499366,
  0.568888888888889,
  0.478628670499366,
  0.236926885056189,
];

export class TrackArcLengthIndex {
  private readonly geometry: TrackGeometryDef;
  private readonly samples: ArcSample[];
  readonly length: number;

  constructor(geometry: TrackGeometryDef, sampleSpacing: number) {
    const coordinates = [
      geometry.p0.x, geometry.p0.y,
      geometry.p1.x, geometry.p1.y,
      geometry.p2.x, geometry.p2.y,
      geometry.p3.x, geometry.p3.y,
    ];
    if (!coordinates.every(Number.isFinite)) {
      throw new Error('Track geometry control points must be finite');
    }
    if (!Number.isFinite(sampleSpacing) || sampleSpacing <= 0) {
      throw new Error('Track arc sample spacing must be a positive finite number');
    }

    this.geometry = {
      geometryVersion: 1,
      p0: { ...geometry.p0 },
      p1: { ...geometry.p1 },
      p2: { ...geometry.p2 },
      p3: { ...geometry.p3 },
    };

    const longestControlEdge = Math.max(
      distanceBetween(geometry.p0, geometry.p1),
      distanceBetween(geometry.p1, geometry.p2),
      distanceBetween(geometry.p2, geometry.p3),
    );
    const sampleCount = Math.max(16, Math.ceil((3 * longestControlEdge) / sampleSpacing));
    this.samples = [];

    let previous = pointAt(this.geometry, 0);
    let cumulativeDistance = 0;
    this.samples.push({ t: 0, distance: 0, point: previous });
    for (let index = 1; index <= sampleCount; index++) {
      const t = index / sampleCount;
      const point = pointAt(this.geometry, t);
      cumulativeDistance += distanceBetween(previous, point);
      this.samples.push({ t, distance: cumulativeDistance, point });
      previous = point;
    }
    this.length = cumulativeDistance;
  }

  poseAtDistance(rawDistance: number): TrackPose {
    const distance = clamp(rawDistance, 0, this.length);
    const { left, right } = this.bracketDistance(distance);
    const intervalLength = right.distance - left.distance;
    const fraction = intervalLength > 0
      ? (distance - left.distance) / intervalLength
      : 0;
    const t = this.refineT(left.t, right.t, fraction);
    const point = pointAt(this.geometry, t);
    const { first, second } = derivativesAt(this.geometry, t);
    const speed = Math.hypot(first.x, first.y);
    const chord = {
      x: this.geometry.p3.x - this.geometry.p0.x,
      y: this.geometry.p3.y - this.geometry.p0.y,
    };
    const fallbackSpeed = Math.hypot(chord.x, chord.y);
    const tangent = speed > 1e-12
      ? { x: first.x / speed, y: first.y / speed }
      : fallbackSpeed > 1e-12
        ? { x: chord.x / fallbackSpeed, y: chord.y / fallbackSpeed }
        : { x: 1, y: 0 };
    const curvature = speed > 1e-12
      ? (first.x * second.y - first.y * second.x) / speed ** 3
      : 0;

    return { point, tangent, curvature };
  }

  distanceForPoint(point: { x: number; y: number }): number {
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    let nearestArcDistance = 0;

    for (let index = 1; index < this.samples.length; index++) {
      const left = this.samples[index - 1];
      const right = this.samples[index];
      const segmentX = right.point.x - left.point.x;
      const segmentY = right.point.y - left.point.y;
      const lengthSquared = segmentX ** 2 + segmentY ** 2;
      const projection = lengthSquared > 0
        ? clamp(
          ((point.x - left.point.x) * segmentX + (point.y - left.point.y) * segmentY)
            / lengthSquared,
          0,
          1,
        )
        : 0;
      const projectedX = left.point.x + segmentX * projection;
      const projectedY = left.point.y + segmentY * projection;
      const distanceSquared = (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2;

      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        nearestArcDistance = left.distance + (right.distance - left.distance) * projection;
      }
    }

    return nearestArcDistance;
  }

  distanceAtParameter(rawT: number): number {
    const t = clamp(rawT, 0, 1);
    if (t <= 0) return 0;
    if (t >= 1) return this.length;

    const lastIndex = this.samples.length - 1;
    const leftIndex = Math.min(lastIndex - 1, Math.floor(t * lastIndex));
    const left = this.samples[leftIndex];
    return left.distance + this.arcLengthBetween(left.t, t);
  }

  private refineT(startT: number, endT: number, fraction: number): number {
    if (fraction <= 0) return startT;
    if (fraction >= 1) return endT;

    const targetLength = this.arcLengthBetween(startT, endT) * fraction;
    let t = startT + (endT - startT) * fraction;
    for (let iteration = 0; iteration < 5; iteration++) {
      const travelled = this.arcLengthBetween(startT, t);
      const derivative = derivativesAt(this.geometry, t).first;
      const speed = Math.hypot(derivative.x, derivative.y);
      if (speed <= 1e-12) break;
      t = clamp(t - (travelled - targetLength) / speed, startT, endT);
    }
    return t;
  }

  private arcLengthBetween(startT: number, endT: number): number {
    const halfWidth = (endT - startT) / 2;
    const midpoint = (startT + endT) / 2;
    let weightedSpeed = 0;
    for (let index = 0; index < GAUSS_NODES.length; index++) {
      const t = midpoint + halfWidth * GAUSS_NODES[index];
      const derivative = derivativesAt(this.geometry, t).first;
      weightedSpeed += GAUSS_WEIGHTS[index] * Math.hypot(derivative.x, derivative.y);
    }
    return halfWidth * weightedSpeed;
  }

  private bracketDistance(distance: number): { left: ArcSample; right: ArcSample } {
    if (distance <= 0) {
      return { left: this.samples[0], right: this.samples[1] };
    }
    const last = this.samples.length - 1;
    if (distance >= this.length) {
      return { left: this.samples[last - 1], right: this.samples[last] };
    }

    let low = 0;
    let high = last;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.samples[middle].distance <= distance) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return { left: this.samples[low], right: this.samples[high] };
  }
}
