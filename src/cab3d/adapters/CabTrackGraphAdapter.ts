import type { TerrainGenerator } from '../../systems/TerrainGenerator';
import type { StructureType } from '../model/CabWorldSnapshot';
import type { CabPathSpan } from '../model/CabPathSampler';
import { CabConfig } from '../CabConfig';

// Runtime classes are only used for instanceof checks and method calls.
// This file lives in adapters/ so importing entities is allowed.
import RailTrack from '../../entities/RailTrack';

interface PointLike {
  x: number;
  y: number;
}

interface TangentLike {
  x: number;
  y: number;
}

interface RawSpan {
  readonly length: number;
  startDistance: number;
  endDistance: number;
  pointAt(u: number): PointLike;
  tangentAt(u: number): TangentLike;
  elevationAt(u: number): number;
  structureAt(u: number): StructureType;
}

/**
 * Build a cab-view path span chain from the train's current track and heading.
 *
 * The returned spans cover {@link CabConfig.NEAR_DISTANCE_M} behind the eye to
 * {@link CabConfig.FAR_DISTANCE_M} ahead, ordered from most negative distance
 * to most positive.  Track connections are followed for straight sequences of
 * RailTrack segments; Junction nodes are treated as path terminators.
 */
export function buildCabTrackSpans(
  currentTrack: RailTrack,
  trainT: number,
  headingRad: number,
  terrainGenerator: TerrainGenerator,
): CabPathSpan[] {
  const curve = currentTrack.getCurvePath();
  const tangentAtT = curve.getTangent(trainT);
  const headingCos = Math.cos(headingRad);
  const headingSin = Math.sin(headingRad);
  const dot = tangentAtT.x * headingCos + tangentAtT.y * headingSin;
  const sign = dot >= 0 ? 1 : -1;

  const forwardSpans = walkFrom(
    currentTrack,
    trainT,
    sign,
    CabConfig.FAR_DISTANCE_M,
    terrainGenerator,
  );

  const backwardRaw = walkFrom(
    currentTrack,
    trainT,
    -sign,
    -CabConfig.NEAR_DISTANCE_M,
    terrainGenerator,
  );

  const backwardSpans = reverseBackwardSpans(backwardRaw);
  return [...backwardSpans, ...forwardSpans];
}

function walkFrom(
  startTrack: RailTrack,
  startT: number,
  sign: number,
  neededDistance: number,
  terrainGenerator: TerrainGenerator,
): RawSpan[] {
  const spans: RawSpan[] = [];
  let remaining = neededDistance;
  let distanceCursor = 0;
  let current: RailTrack | undefined = startTrack;
  let t = startT;
  let currentSign = sign;

  while (current && remaining > 0.001) {
    const curve = current.getCurvePath();
    const length = curve.getLength();
    if (length <= 0) break;

    const available = currentSign === 1 ? (1 - t) * length : t * length;
    const spanLength = Math.min(available, remaining);
    if (spanLength <= 0.001) break;

    const tEnd = t + currentSign * (spanLength / length);
    const span = createRawSpan(current, t, tEnd, currentSign, spanLength, terrainGenerator);
    span.startDistance = distanceCursor;
    span.endDistance = distanceCursor + spanLength;
    spans.push(span);
    distanceCursor += spanLength;
    remaining -= spanLength;
    if (remaining <= 0.001) break;

    const nextInfo = pickNextTrack(current, currentSign);
    if (!nextInfo) break;
    current = nextInfo.track;
    t = nextInfo.t;
    currentSign = nextInfo.sign;
  }

  return spans;
}

function createRawSpan(
  track: RailTrack,
  tStart: number,
  tEnd: number,
  sign: number,
  spanLength: number,
  terrainGenerator: TerrainGenerator,
): RawSpan {
  const curve = track.getCurvePath();
  const verticalProfile = track.verticalProfile;
  const structures = track.structures;
  const getT = (u: number) => tStart + (tEnd - tStart) * u;

  return {
    length: spanLength,
    startDistance: 0,
    endDistance: 0,
    pointAt(u: number) {
      const t = getT(u);
      return curve.getPoint(t) as PointLike;
    },
    tangentAt(u: number) {
      const t = getT(u);
      const tan = curve.getTangent(t) as TangentLike;
      return { x: sign * tan.x, y: sign * tan.y };
    },
    elevationAt(u: number) {
      const t = getT(u);
      return getElevation(track, t, terrainGenerator);
    },
    structureAt(u: number) {
      const t = getT(u);
      return track.structureTypeAt(t);
    },
  };
}

function getElevation(
  track: RailTrack,
  t: number,
  terrainGenerator: TerrainGenerator,
): number {
  const profile = track.verticalProfile;
  if (profile && profile.knots.length > 0) {
    const knots = profile.knots;
    if (knots.length === 1) return knots[0].elevation;

    // Find the surrounding knots and linearly interpolate.
    let lower = knots[0];
    let upper = knots[knots.length - 1];
    for (let i = 0; i < knots.length - 1; i++) {
      if (t >= knots[i].t && t <= knots[i + 1].t) {
        lower = knots[i];
        upper = knots[i + 1];
        break;
      }
    }
    const range = upper.t - lower.t;
    const u = range > 0 ? (t - lower.t) / range : 0;
    return lower.elevation + (upper.elevation - lower.elevation) * u;
  }

  const point = track.getCurvePath().getPoint(t) as PointLike;
  return terrainGenerator.getHeightAt(point.x, point.y);
}

function pickNextTrack(
  current: RailTrack,
  sign: number,
): { track: RailTrack; t: number; sign: number } | null {
  const nextNode = sign === 1 ? current.getNext() : current.getPrevious();
  if (!nextNode) return null;

  if (nextNode.isJunction()) {
    // Phase 2: terminate the path at junctions to keep the graph traversal
    // simple and deterministic.  The cab camera still works from the vehicle.
    return null;
  }

  if (nextNode.isTrack()) {
    return connectToTrack(current, sign, nextNode);
  }

  return null;
}

function connectToTrack(
  current: RailTrack,
  sign: number,
  next: RailTrack,
): { track: RailTrack; t: number; sign: number } | null {
  const currentCurve = current.getCurvePath();
  const currentForward = currentSignTangent(current, sign);
  const connectionPoint = sign === 1
    ? currentCurve.getEndPoint()
    : currentCurve.getStartPoint();

  const nextCurve = next.getCurvePath();
  const start = nextCurve.getStartPoint();
  const end = nextCurve.getEndPoint();

  const outAtStart = nextCurve.getTangent(0) as TangentLike;
  const outAtEnd = { x: -(nextCurve.getTangent(1) as TangentLike).x, y: -(nextCurve.getTangent(1) as TangentLike).y };

  const dotStart = outAtStart.x * currentForward.x + outAtStart.y * currentForward.y;
  const dotEnd = outAtEnd.x * currentForward.x + outAtEnd.y * currentForward.y;

  const dStart = Math.hypot(start.x - connectionPoint.x, start.y - connectionPoint.y);
  const dEnd = Math.hypot(end.x - connectionPoint.x, end.y - connectionPoint.y);

  // Prefer the outward tangent that continues the current heading, but fall
  // back to the closest endpoint if the tangents are nearly perpendicular.
  let useStart: boolean;
  if (Math.abs(dotStart - dotEnd) > 0.01) {
    useStart = dotStart > dotEnd;
  } else {
    useStart = dStart < dEnd;
  }

  if (useStart) {
    return { track: next, t: 0, sign: 1 };
  }
  return { track: next, t: 1, sign: -1 };
}

function currentSignTangent(current: RailTrack, sign: number): TangentLike {
  const curve = current.getCurvePath();
  const t = sign === 1 ? 1 : 0;
  const tan = curve.getTangent(t) as TangentLike;
  return { x: sign * tan.x, y: sign * tan.y };
}

function reverseBackwardSpans(raw: RawSpan[]): CabPathSpan[] {
  const result: CabPathSpan[] = [];
  let cursor = 0;

  for (let i = raw.length - 1; i >= 0; i--) {
    const span = raw[i];
    const startDistance = -(cursor + span.length);
    const endDistance = -cursor;

    result.push({
      length: span.length,
      startDistance,
      endDistance,
      pointAt(u: number) {
        return span.pointAt(1 - u);
      },
      tangentAt(u: number) {
        const t = span.tangentAt(1 - u);
        return { x: -t.x, y: -t.y };
      },
      elevationAt(u: number) {
        return span.elevationAt(1 - u);
      },
      structureAt(u: number) {
        return span.structureAt(1 - u);
      },
    });

    cursor += span.length;
  }

  return result;
}


