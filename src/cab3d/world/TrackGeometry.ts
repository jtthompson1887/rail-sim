import type { CabTrackSample, StructureType } from '../model/CabWorldSnapshot';
import { worldToBabylon } from '../model/CabCoordinate';
import { CabConfig } from '../CabConfig';

/** Plain 3-D vector used by the pure track-geometry helpers. */
export interface CabVector3 {
  x: number;
  y: number;
  z: number;
}

/** Transform for a thin-instanced sleeper or pier. */
export interface CabTrackTransform {
  /** World-space position in Babylon coordinates. */
  position: CabVector3;
  /** Yaw rotation around the world Y axis, in radians. */
  yaw: number;
  /** Elevation of the supporting surface at this position (for piers). */
  surfaceY?: number;
}

/** Axis-aligned bounding box for a track mesh. */
export interface CabTrackBoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** A contiguous run of samples with the same structure type. */
export interface CabTrackSegment {
  readonly structure: StructureType;
  readonly startIndex: number;
  readonly endIndex: number; // exclusive
  readonly startDistance: number;
  readonly endDistance: number;
}

/**
 * BS113A simplified rail profile: a closed 12-point loop in the xOy plane,
 * origin at the foot centre, y up.
 */
export function getRailProfile(): ReadonlyArray<{ x: number; y: number }> {
  return Object.freeze([
    { x: -0.07, y: 0.0 },
    { x: 0.07, y: 0.0 },
    { x: 0.07, y: 0.014 },
    { x: 0.02, y: 0.04 },
    { x: 0.02, y: 0.12 },
    { x: 0.0335, y: 0.14 },
    { x: 0.0335, y: 0.159 },
    { x: -0.0335, y: 0.159 },
    { x: -0.0335, y: 0.14 },
    { x: -0.02, y: 0.12 },
    { x: -0.02, y: 0.04 },
    { x: -0.07, y: 0.014 },
  ]);
}

/**
 * Rail head cap profile: 0.067 m wide × 0.004 m tall, centred at y = 0.157 m.
 */
export function getRailCapProfile(): ReadonlyArray<{ x: number; y: number }> {
  const halfW = CabConfig.RAIL_HEAD_CAP_WIDTH_M / 2;
  const halfH = CabConfig.RAIL_HEAD_CAP_HEIGHT_M / 2;
  const cy = CabConfig.RAIL_HEAD_CAP_Y_M;
  return Object.freeze([
    { x: -halfW, y: cy - halfH },
    { x: halfW, y: cy - halfH },
    { x: halfW, y: cy + halfH },
    { x: -halfW, y: cy + halfH },
  ]);
}

/**
 * Ballast cross-section: top 3.60 m, bottom 5.60 m, depth 0.35 m, y up.
 */
export function getBallastProfile(): ReadonlyArray<{ x: number; y: number }> {
  const topHalf = CabConfig.BALLAST_TOP_WIDTH_M / 2;
  const bottomHalf = CabConfig.BALLAST_BOTTOM_WIDTH_M / 2;
  const depth = CabConfig.BALLAST_DEPTH_M;
  return Object.freeze([
    { x: -topHalf, y: 0 },
    { x: topHalf, y: 0 },
    { x: bottomHalf, y: -depth },
    { x: -bottomHalf, y: -depth },
  ]);
}

/**
 * Bridge deck cross-section: full width 5.0 m, depth 0.6 m, top at rail foot.
 */
export function getBridgeDeckProfile(): ReadonlyArray<{ x: number; y: number }> {
  const halfW = CabConfig.BRIDGE_DECK_WIDTH_M / 2;
  const depth = CabConfig.BRIDGE_DECK_DEPTH_M;
  return Object.freeze([
    { x: -halfW, y: 0 },
    { x: halfW, y: 0 },
    { x: halfW, y: -depth },
    { x: -halfW, y: -depth },
  ]);
}

/**
 * Return the unit "right" vector in the Babylon horizontal plane for a given
 * world heading.  Heading 0 = world +X, positive counter-clockwise.
 */
export function getTrackRightVector(headingRad: number): CabVector3 {
  return {
    x: -Math.sin(headingRad),
    y: 0,
    z: -Math.cos(headingRad),
  };
}

/**
 * Compute the centre-line points of the left and right rails from a path.
 */
export function getRailCenterPositions(
  path: ReadonlyArray<CabTrackSample>,
  centreOffset = CabConfig.RAIL_CENTRE_OFFSET_M,
): { left: CabVector3[]; right: CabVector3[] } {
  const left: CabVector3[] = [];
  const right: CabVector3[] = [];

  for (const sample of path) {
    const centre = worldToBabylon(sample.x, sample.y, sample.elevation);
    const r = getTrackRightVector(sample.headingRad);
    left.push({
      x: centre.x - r.x * centreOffset,
      y: centre.y - r.y * centreOffset,
      z: centre.z - r.z * centreOffset,
    });
    right.push({
      x: centre.x + r.x * centreOffset,
      y: centre.y + r.y * centreOffset,
      z: centre.z + r.z * centreOffset,
    });
  }

  return { left, right };
}

/**
 * Interpolate a track sample at an arbitrary distance along the path.
 */
export function sampleAtDistance(
  path: ReadonlyArray<CabTrackSample>,
  distance: number,
): CabTrackSample | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0];

  if (distance <= path[0].distance) return path[0];
  const last = path[path.length - 1];
  if (distance >= last.distance) return last;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (distance >= a.distance && distance <= b.distance) {
      const range = b.distance - a.distance;
      const t = range > 0 ? (distance - a.distance) / range : 0;
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        elevation: lerp(a.elevation, b.elevation, t),
        headingRad: lerpAngle(a.headingRad, b.headingRad, t),
        curvature: lerp(a.curvature, b.curvature, t),
        structure: t < 0.5 ? a.structure : b.structure,
        distance,
      };
    }
  }

  return last;
}

/**
 * Generate sleeper transforms for a distance range along the path.
 */
export function getSleeperTransforms(
  path: ReadonlyArray<CabTrackSample>,
  spacing = CabConfig.SLEEPER_SPACING_M,
  startDistance?: number,
  endDistance?: number,
): CabTrackTransform[] {
  if (path.length === 0) return [];

  const first = path[0].distance;
  const last = path[path.length - 1].distance;
  const start = startDistance ?? first;
  const end = endDistance ?? last;
  const range = end - start;
  if (range <= 0 || spacing <= 0) return [];

  const count = Math.floor(range / spacing);
  if (count <= 0) return [];

  const transforms: CabTrackTransform[] = [];
  for (let i = 0; i < count; i++) {
    const d = start + i * spacing;
    const sample = sampleAtDistance(path, d);
    if (!sample) continue;

    const pos = worldToBabylon(
      sample.x,
      sample.y,
      sample.elevation - CabConfig.SLEEPER_HEIGHT_M / 2,
    );
    transforms.push({
      position: pos,
      yaw: sample.headingRad,
    });
  }

  return transforms;
}

/**
 * Generate pier transforms for a bridge segment.  Piers are placed every
 * {@link CabConfig.PIER_SPACING_M} metres along the segment.
 */
export function getPierTransforms(
  path: ReadonlyArray<CabTrackSample>,
  spacing = CabConfig.PIER_SPACING_M,
  startDistance?: number,
  endDistance?: number,
): CabTrackTransform[] {
  if (path.length === 0) return [];

  const first = path[0].distance;
  const last = path[path.length - 1].distance;
  const start = startDistance ?? first;
  const end = endDistance ?? last;
  if (end <= start || spacing <= 0) return [];

  const firstPier = Math.ceil(start / spacing) * spacing;
  const transforms: CabTrackTransform[] = [];
  for (let d = firstPier; d <= end + 1e-9; d += spacing) {
    if (d < start - 1e-9) continue;
    const sample = sampleAtDistance(path, d);
    if (!sample) continue;

    const pos = worldToBabylon(
      sample.x,
      sample.y,
      sample.elevation - CabConfig.BRIDGE_DECK_DEPTH_M,
    );
    transforms.push({
      position: pos,
      yaw: sample.headingRad,
      surfaceY: sample.elevation,
    });
  }

  return transforms;
}

/**
 * Group a path into contiguous segments with the same structure type.
 */
export function getStructureSegments(
  path: ReadonlyArray<CabTrackSample>,
): CabTrackSegment[] {
  if (path.length === 0) return [];

  const segments: CabTrackSegment[] = [];
  let start = 0;

  for (let i = 1; i <= path.length; i++) {
    if (i === path.length || path[i].structure !== path[start].structure) {
      segments.push({
        structure: path[start].structure,
        startIndex: start,
        endIndex: i,
        startDistance: path[start].distance,
        endDistance: path[i - 1].distance,
      });
      start = i;
    }
  }

  return segments;
}

/**
 * Compute an approximate axis-aligned bounding box for a surface track mesh
 * along the supplied path.
 */
export function computeTrackBoundingBox(
  path: ReadonlyArray<CabTrackSample>,
): CabTrackBoundingBox {
  const box: CabTrackBoundingBox = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };

  const railTopY =
    CabConfig.RAIL_HEAD_CAP_Y_M + CabConfig.RAIL_HEAD_CAP_HEIGHT_M / 2;
  const railLateral =
    CabConfig.RAIL_CENTRE_OFFSET_M + Math.max(0.07, CabConfig.RAIL_HEAD_HALF_WIDTH_M);
  const sleeperHalf = CabConfig.SLEEPER_LENGTH_M / 2;
  const ballastHalf = CabConfig.BALLAST_BOTTOM_WIDTH_M / 2;
  const yDown = Math.max(CabConfig.BALLAST_DEPTH_M, CabConfig.SLEEPER_HEIGHT_M);

  for (const sample of path) {
    const p = worldToBabylon(sample.x, sample.y, sample.elevation);
    const r = getTrackRightVector(sample.headingRad);
    const absRx = Math.abs(r.x);
    const absRz = Math.abs(r.z);

    const lateralExtent = Math.max(railLateral, sleeperHalf, ballastHalf);
    const xMax = p.x + absRx * lateralExtent;
    const xMin = p.x - absRx * lateralExtent;
    const zMax = p.z + absRz * lateralExtent;
    const zMin = p.z - absRz * lateralExtent;

    box.minX = Math.min(box.minX, xMin);
    box.maxX = Math.max(box.maxX, xMax);
    box.minZ = Math.min(box.minZ, zMin);
    box.maxZ = Math.max(box.maxZ, zMax);
    box.minY = Math.min(box.minY, p.y - yDown);
    box.maxY = Math.max(box.maxY, p.y + railTopY);
  }

  return box;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return a + delta * t;
}
