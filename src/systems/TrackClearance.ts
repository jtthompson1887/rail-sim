import type { Vec2Def, JunctionDef } from '../config/WorldData';
import {
  CURVE_FLATNESS_TOLERANCE,
  type ConstructionCurveSample,
} from './ConstructionCurveSampler';
import type { TrackGeometryDef } from './TrackGeometry';

export const TRACK_CENTERLINE_CLEARANCE = 48;
export const TRACK_CLEARANCE_FLATNESS_ADJUSTMENT = 2 * CURVE_FLATNESS_TOLERANCE;
export const TRACK_CLEARANCE_ENDPOINT_EPSILON = 1e-6;
/** Maximum shared approach permitted for a declared, geometrically verified turnout. */
export const MAX_TURNOUT_THROAT_LENGTH = 320;

const DISTANCE_EPSILON = 1e-9;
const OPPOSITE_DIRECTION_EPSILON = 1e-6;

export interface ClearanceTrack {
  readonly trackUUID: string;
  readonly geometry: TrackGeometryDef;
  readonly curveSamples: readonly ConstructionCurveSample[];
}

export interface ClearanceCandidate {
  readonly trackUUID?: string;
  readonly geometry: TrackGeometryDef;
  readonly curveSamples: readonly ConstructionCurveSample[];
}

export interface ClearanceTurnout {
  readonly junction: JunctionDef;
  readonly tracks: readonly ClearanceTrack[];
}

interface ValidatedTurnout {
  branches: readonly [{ id: string; endpoint: 'start' | 'end'; geometry: TrackGeometryDef }, { id: string; endpoint: 'start' | 'end'; geometry: TrackGeometryDef }];
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
  turnouts: readonly ClearanceTurnout[] = [],
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
  const validTurnouts = turnouts.map(validateTurnout).filter((turnout): turnout is ValidatedTurnout => turnout !== null);

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
        if (candidate.trackUUID && validTurnouts.some(turnout => {
          const a = turnout.branches.find(branch => branch.id === candidate.trackUUID);
          const b = turnout.branches.find(branch => branch.id === existing.trackUUID);
          if (!a || !b || a.id === b.id) return false;
          if (!(['p0', 'p1', 'p2', 'p3'] as const).every(key => pointsMatch(a.geometry[key], candidate.geometry[key]) && pointsMatch(b.geometry[key], existing.geometry[key]))) return false;
          const candidateDistance = segmentDistanceFromEndpoint(candidate.curveSamples, newIndex, a.endpoint) + candidate.curveSamples[newIndex + 1].segmentLength;
          const existingDistance = segmentDistanceFromEndpoint(existing.curveSamples, existingIndex, b.endpoint) + existing.curveSamples[existingIndex + 1].segmentLength;
          return candidateDistance <= MAX_TURNOUT_THROAT_LENGTH && existingDistance <= MAX_TURNOUT_THROAT_LENGTH;
        })) continue;
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

function pointAtDistance(track: ClearanceTrack, endpoint: 'start' | 'end', distance: number): Vec2Def {
  const samples = track.curveSamples;
  const total = samples[samples.length - 1].distance;
  const target = endpoint === 'start' ? distance : total - distance;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].distance >= target) {
      const fraction = (target - samples[i - 1].distance) / (samples[i].distance - samples[i - 1].distance);
      return { x: samples[i - 1].point.x + (samples[i].point.x - samples[i - 1].point.x) * fraction, y: samples[i - 1].point.y + (samples[i].point.y - samples[i - 1].point.y) * fraction };
    }
  }
  return samples[samples.length - 1].point;
}

/** Invalid declarations never enlarge the clearance exemption. Interior turnouts need an explicit split. */
function validateTurnout(input: ClearanceTurnout): ValidatedTurnout | null {
  const junction = input.junction;
  if (!junction || !junction.uuid || (junction.position !== 0 && junction.position !== 1)) return null;
  const ids = [junction.mainTrackUUID, junction.leftTrackUUID, junction.rightTrackUUID];
  if (new Set(ids).size !== 3) return null;
  const tracks = ids.map(id => input.tracks.find(track => track.trackUUID === id));
  if (tracks.some(track => !track || !samplesAreUsable(track.curveSamples) || !samplesMatchGeometry(track.geometry, track.curveSamples))) return null;
  const main = tracks[0]!;
  const mainEndpoint = junction.position === 0 ? 'start' : 'end';
  const point = geometryEndpoint(main.geometry, mainEndpoint);
  const mainOutward = outwardVector(main.geometry, mainEndpoint);
  if (!mainOutward) return null;
  const branches: Array<{ id: string; endpoint: 'start' | 'end'; geometry: TrackGeometryDef }> = [];
  for (const branch of tracks.slice(1)) {
    const endpoint = pointsMatch(branch.geometry.p0, point) ? 'start' : pointsMatch(branch.geometry.p3, point) ? 'end' : null;
    if (!endpoint) return null;
    const outward = outwardVector(branch.geometry, endpoint);
    if (!outward || mainOutward.x * outward.x + mainOutward.y * outward.y > -1 + OPPOSITE_DIRECTION_EPSILON || branch.curveSamples[branch.curveSamples.length - 1].distance <= MAX_TURNOUT_THROAT_LENGTH) return null;
    branches.push({ id: branch.trackUUID, endpoint, geometry: branch.geometry });
  }
  let lastSeparation = 0;
  for (let i = 1; i <= 16; i++) {
    const distance = MAX_TURNOUT_THROAT_LENGTH * i / 16;
    const left = pointAtDistance(tracks[1]!, branches[0].endpoint, distance);
    const right = pointAtDistance(tracks[2]!, branches[1].endpoint, distance);
    const separation = Math.sqrt(squaredDistance(left, right));
    if (separation < lastSeparation - TRACK_CLEARANCE_FLATNESS_ADJUSTMENT) return null;
    lastSeparation = separation;
  }
  if (lastSeparation < TRACK_CENTERLINE_CLEARANCE + TRACK_CLEARANCE_FLATNESS_ADJUSTMENT) return null;
  return { branches: [branches[0], branches[1]] };
}

export function isValidClearanceTurnout(input: ClearanceTurnout): boolean { return validateTurnout(input) !== null; }
