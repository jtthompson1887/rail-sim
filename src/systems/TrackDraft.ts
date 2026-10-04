import type { Vec2Def } from '../config/WorldData';
import type { TrackGeometryDef } from './TrackGeometry';

export type TrackDraftHandle = 'start' | 'end' | 'start-direction' | 'end-direction';

/** Editor-only intent. It never changes a built track or saved world. */
export type TrackDraftIntent =
  | { action: 'select'; handle: TrackDraftHandle }
  | { action: 'rotate'; degrees: number }
  | { action: 'reach'; factor: number }
  | { action: 'reset' }
  | { action: 'undo' };

export interface TrackCurveControls {
  readonly p1: Readonly<Vec2Def>;
  readonly p2: Readonly<Vec2Def>;
}

export const DRAFT_HANDLE_TARGET_PX = 24;
const MIN_HANDLE_REACH = 8;

export function isDirectionHandle(handle: TrackDraftHandle): boolean {
  return handle === 'start-direction' || handle === 'end-direction';
}

export function draftHandlePoint(geometry: TrackGeometryDef, handle: TrackDraftHandle): Vec2Def {
  return geometry[handle === 'start' ? 'p0'
    : handle === 'end' ? 'p3'
      : handle === 'start-direction' ? 'p1' : 'p2'];
}

/** A joined endpoint keeps its tangent; its approach length remains editable. */
export function constrainDraftHandle(
  anchor: Readonly<Vec2Def>,
  requested: Readonly<Vec2Def>,
  outward?: Readonly<Vec2Def>,
): Vec2Def {
  const dx = requested.x - anchor.x;
  const dy = requested.y - anchor.y;
  const magnitude = Math.hypot(dx, dy);
  if (outward) {
    const unitLength = Math.hypot(outward.x, outward.y);
    const ux = outward.x / unitLength;
    const uy = outward.y / unitLength;
    const reach = Math.max(MIN_HANDLE_REACH, dx * ux + dy * uy);
    return { x: anchor.x + ux * reach, y: anchor.y + uy * reach };
  }
  if (magnitude >= MIN_HANDLE_REACH) return { ...requested };
  const ux = magnitude > 0 ? dx / magnitude : 1;
  const uy = magnitude > 0 ? dy / magnitude : 0;
  return { x: anchor.x + ux * MIN_HANDLE_REACH, y: anchor.y + uy * MIN_HANDLE_REACH };
}

export function rotateDraftHandle(
  anchor: Readonly<Vec2Def>,
  point: Readonly<Vec2Def>,
  degrees: number,
): Vec2Def {
  const radians = degrees * Math.PI / 180;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  return {
    x: anchor.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: anchor.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

/** Detect a cubic's loop analytically, including crossings between sampled points. */
export function draftCrossesItself({ p0, p1, p2, p3 }: TrackGeometryDef): boolean {
  const a = { x: p3.x - 3 * p2.x + 3 * p1.x - p0.x, y: p3.y - 3 * p2.y + 3 * p1.y - p0.y };
  const b = { x: 3 * p2.x - 6 * p1.x + 3 * p0.x, y: 3 * p2.y - 6 * p1.y + 3 * p0.y };
  const c = { x: 3 * (p1.x - p0.x), y: 3 * (p1.y - p0.y) };
  const determinant = a.x * b.y - a.y * b.x;
  if (Math.abs(determinant) < 1e-9) return false;
  // For distinct t,s with P(t)=P(s), divide by t-s and use u=t+s, v=t*s:
  // a*(u*u-v) + b*u + c = 0. Its cross product with a determines u.
  const u = -(a.x * c.y - a.y * c.x) / determinant;
  if (u <= 0 || u >= 2) return false;
  const v = u * u + (Math.abs(a.x) >= Math.abs(a.y)
    ? (b.x * u + c.x) / a.x : (b.y * u + c.y) / a.y);
  const discriminant = u * u - 4 * v;
  if (discriminant <= 1e-10) return false;
  const separation = Math.sqrt(discriminant);
  return (u - separation) / 2 >= 0 && (u + separation) / 2 <= 1;
}
