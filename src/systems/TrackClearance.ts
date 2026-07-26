import type { Vec2Def } from '../config/WorldData';
import {
  CURVE_FLATNESS_TOLERANCE,
  type ConstructionCurveSample,
} from './ConstructionCurveSampler';
import type { TrackGeometryDef } from './TrackGeometry';

export const TRACK_CENTERLINE_CLEARANCE = 48;
export const TRACK_CLEARANCE_FLATNESS_ADJUSTMENT = 2 * CURVE_FLATNESS_TOLERANCE;
export const TRACK_CLEARANCE_ENDPOINT_EPSILON = 1e-6;

const DISTANCE_EPSILON = 1e-9;
const OPPOSITE_DIRECTION_EPSILON = 1e-6;

export interface ClearanceTrack {
  readonly trackUUID: string;
  readonly geometry: TrackGeometryDef;
  readonly curveSamples: readonly ConstructionCurveSample[];
}

export interface ClearanceCandidate {
  readonly geometry: TrackGeometryDef;
  readonly curveSamples: readonly ConstructionCurveSample[];
}

export interface ClearanceEndpointConnection {
  readonly kind: 'endpoint-connection';
  readonly existingTrackUUID: string;
  readonly existingEndpoint: 'start' | 'end';
  readonly newEndpoint: 'start' | 'end';
  readonly point: Readonly<Vec2Def>;
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function squaredDistance(left: Vec2Def, right: Vec2Def): number {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return dx * dx + dy * dy;
}

function pointToSegmentSquared(
  point: Vec2Def,
  start: Vec2Def,
  end: Vec2Def,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= DISTANCE_EPSILON) return squaredDistance(point, start);
  const projection = Math.max(0, Math.min(
    1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return squaredDistance(point, {
    x: start.x + projection * dx,
    y: start.y + projection * dy,
  });
}

function orientation(a: Vec2Def, b: Vec2Def, c: Vec2Def): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function sign(value: number): number {
  if (value > DISTANCE_EPSILON) return 1;
  if (value < -DISTANCE_EPSILON) return -1;
  return 0;
}

function within(value: number, start: number, end: number): boolean {
  return value >= Math.min(start, end) - DISTANCE_EPSILON
    && value <= Math.max(start, end) + DISTANCE_EPSILON;
}

function pointOnSegment(point: Vec2Def, start: Vec2Def, end: Vec2Def): boolean {
  return sign(orientation(start, end, point)) === 0
    && within(point.x, start.x, end.x)
    && within(point.y, start.y, end.y);
}

/** Exact planar segment distance with explicit degenerate-segment handling. */
export function segmentToSegmentSquaredDistance(
  a0: Vec2Def,
  a1: Vec2Def,
  b0: Vec2Def,
  b1: Vec2Def,
): number {
  const aDegenerate = squaredDistance(a0, a1) <= DISTANCE_EPSILON;
  const bDegenerate = squaredDistance(b0, b1) <= DISTANCE_EPSILON;
  if (aDegenerate && bDegenerate) return squaredDistance(a0, b0);
  if (aDegenerate) return pointToSegmentSquared(a0, b0, b1);
  if (bDegenerate) return pointToSegmentSquared(b0, a0, a1);

  const ab0 = sign(orientation(a0, a1, b0));
  const ab1 = sign(orientation(a0, a1, b1));
  const ba0 = sign(orientation(b0, b1, a0));
  const ba1 = sign(orientation(b0, b1, a1));
  if (
    (ab0 === 0 && pointOnSegment(b0, a0, a1))
    || (ab1 === 0 && pointOnSegment(b1, a0, a1))
    || (ba0 === 0 && pointOnSegment(a0, b0, b1))
    || (ba1 === 0 && pointOnSegment(a1, b0, b1))
    || (ab0 * ab1 < 0 && ba0 * ba1 < 0)
  ) return 0;

  return Math.min(
    pointToSegmentSquared(a0, b0, b1),
    pointToSegmentSquared(a1, b0, b1),
    pointToSegmentSquared(b0, a0, a1),
    pointToSegmentSquared(b1, a0, a1),
  );
}

function controlHullBounds(geometry: TrackGeometryDef): Bounds | null {
  const points = [geometry.p0, geometry.p1, geometry.p2, geometry.p3];
  if (points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    return null;
  }
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  };
}

function boundsCanConflict(candidate: Bounds, existing: Bounds): boolean {
  const expansion = TRACK_CENTERLINE_CLEARANCE
    + TRACK_CLEARANCE_FLATNESS_ADJUSTMENT;
  return candidate.minX - expansion <= existing.maxX
    && candidate.maxX + expansion >= existing.minX
    && candidate.minY - expansion <= existing.maxY
    && candidate.maxY + expansion >= existing.minY;
}

function samplesAreUsable(samples: readonly ConstructionCurveSample[]): boolean {
  if (samples.length < 2) return false;
  if (
    Math.abs(samples[0].t) > DISTANCE_EPSILON
    || Math.abs(samples[0].distance) > DISTANCE_EPSILON
    || Math.abs(samples[0].segmentLength) > DISTANCE_EPSILON
    || Math.abs(samples[samples.length - 1].t - 1) > DISTANCE_EPSILON
  ) return false;
  let previousT = samples[0].t;
  let previousDistance = samples[0].distance;
  return samples.every(({ t, point, distance, segmentLength }, index) => {
    const usable = Number.isFinite(t)
      && Number.isFinite(point.x)
      && Number.isFinite(point.y)
      && Number.isFinite(distance)
      && Number.isFinite(segmentLength)
      && (index === 0 || (
        t > previousT
        && distance > previousDistance
        && segmentLength > 0
      ));
    previousT = t;
    previousDistance = distance;
    return usable;
  });
}

function samplesMatchGeometry(
  geometry: TrackGeometryDef,
  samples: readonly ConstructionCurveSample[],
): boolean {
  return pointsMatch(samples[0].point, geometry.p0)
    && pointsMatch(samples[samples.length - 1].point, geometry.p3);
}

function geometryEndpoint(
  geometry: TrackGeometryDef,
  endpoint: 'start' | 'end',
): Vec2Def {
  return endpoint === 'start' ? geometry.p0 : geometry.p3;
}

function outwardVector(
  geometry: TrackGeometryDef,
  endpoint: 'start' | 'end',
): Vec2Def | null {
  const endpointPoint = geometryEndpoint(geometry, endpoint);
  const inwardControl = endpoint === 'start' ? geometry.p1 : geometry.p2;
  const x = endpointPoint.x - inwardControl.x;
  const y = endpointPoint.y - inwardControl.y;
  const magnitude = Math.hypot(x, y);
  return magnitude <= DISTANCE_EPSILON
    ? null
    : { x: x / magnitude, y: y / magnitude };
}

function pointsMatch(left: Vec2Def, right: Vec2Def): boolean {
  return squaredDistance(left, right)
    <= TRACK_CLEARANCE_ENDPOINT_EPSILON * TRACK_CLEARANCE_ENDPOINT_EPSILON;
}

function segmentDistanceFromEndpoint(
  samples: readonly ConstructionCurveSample[],
  segmentIndex: number,
  endpoint: 'start' | 'end',
): number {
  return endpoint === 'start'
    ? samples[segmentIndex].distance
    : samples[samples.length - 1].distance - samples[segmentIndex + 1].distance;
}

function isExemptConnectionThroatPair(
  candidate: ClearanceCandidate,
  newSegmentIndex: number,
  existing: ClearanceTrack,
  existingSegmentIndex: number,
  connections: readonly ClearanceEndpointConnection[],
): boolean {
  return connections.some((connection) => {
    if (
      connection.kind !== 'endpoint-connection'
      || connection.existingTrackUUID !== existing.trackUUID
    ) return false;

    const newPoint = geometryEndpoint(candidate.geometry, connection.newEndpoint);
    const existingPoint = geometryEndpoint(existing.geometry, connection.existingEndpoint);
    if (
      !pointsMatch(connection.point, newPoint)
      || !pointsMatch(connection.point, existingPoint)
    ) return false;

    const newOutward = outwardVector(candidate.geometry, connection.newEndpoint);
    const existingOutward = outwardVector(existing.geometry, connection.existingEndpoint);
    if (
      !newOutward
      || !existingOutward
      || newOutward.x * existingOutward.x + newOutward.y * existingOutward.y
        > -1 + OPPOSITE_DIRECTION_EPSILON
    ) return false;

    const combinedDistance = segmentDistanceFromEndpoint(
      candidate.curveSamples,
      newSegmentIndex,
      connection.newEndpoint,
    ) + segmentDistanceFromEndpoint(
      existing.curveSamples,
      existingSegmentIndex,
      connection.existingEndpoint,
    );
    return combinedDistance
      < TRACK_CENTERLINE_CLEARANCE + TRACK_CLEARANCE_FLATNESS_ADJUSTMENT;
  });
}

export function hasConstructionClearance(
  candidate: ClearanceCandidate,
  existingTracks: readonly ClearanceTrack[],
  predictedConnections: readonly ClearanceEndpointConnection[],
): boolean {
  // Deliberately plan-view only: bridge/tunnel classification is not yet
  // authoritative grade-separated topology and therefore grants no exemption.
  if (
    !samplesAreUsable(candidate.curveSamples)
    || !samplesMatchGeometry(candidate.geometry, candidate.curveSamples)
  ) return false;
  const candidateBounds = controlHullBounds(candidate.geometry);
  if (!candidateBounds) return false;
  const protectedDistance = TRACK_CENTERLINE_CLEARANCE
    + TRACK_CLEARANCE_FLATNESS_ADJUSTMENT;
  const protectedDistanceSquared = protectedDistance * protectedDistance;

  const orderedExisting = [...existingTracks].sort((left, right) => (
    left.trackUUID < right.trackUUID ? -1 : left.trackUUID > right.trackUUID ? 1 : 0
  ));
  for (const existing of orderedExisting) {
    if (
      !samplesAreUsable(existing.curveSamples)
      || !samplesMatchGeometry(existing.geometry, existing.curveSamples)
    ) return false;
    const existingBounds = controlHullBounds(existing.geometry);
    if (!existingBounds) return false;
    if (!boundsCanConflict(candidateBounds, existingBounds)) continue;

    for (
      let newIndex = 0;
      newIndex < candidate.curveSamples.length - 1;
      newIndex++
    ) {
      const newStart = candidate.curveSamples[newIndex].point;
      const newEnd = candidate.curveSamples[newIndex + 1].point;
      for (
        let existingIndex = 0;
        existingIndex < existing.curveSamples.length - 1;
        existingIndex++
      ) {
        if (isExemptConnectionThroatPair(
          candidate,
          newIndex,
          existing,
          existingIndex,
          predictedConnections,
        )) continue;
        const distanceSquared = segmentToSegmentSquaredDistance(
          newStart,
          newEnd,
          existing.curveSamples[existingIndex].point,
          existing.curveSamples[existingIndex + 1].point,
        );
        if (distanceSquared < protectedDistanceSquared) {
          return false;
        }
      }
    }
  }
  return true;
}
