/**
 * Pure curvature helpers for cab-view track samples.
 *
 * Curvature is the signed Menger curvature of three consecutive points:
 * positive for a left turn (counter-clockwise on screen, i.e. the curve bulges
 * upward because game Y increases downward), negative for a right turn.
 */

export interface CabCurvaturePoint {
  x: number;
  y: number;
}

/**
 * Signed curvature from three consecutive points.  Returns 0 when the points
 * are collinear or coincident.
 *
 * The sign convention matches the cab-view path: a left-hand turn (the track
 * bulges toward the top of the screen, negative game Y) returns a positive
 * value.
 */
export function curvatureFromPoints(
  a: CabCurvaturePoint,
  b: CabCurvaturePoint,
  c: CabCurvaturePoint,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;

  const cross = abx * bcy - aby * bcx;
  const lab = Math.hypot(abx, aby);
  const lbc = Math.hypot(bcx, bcy);
  const lac = Math.hypot(acx, acy);

  const denom = lab * lbc * lac;
  if (denom === 0) return 0;

  // Menger curvature: k = 2 * sin(angle) / |BC| = 4 * area / (|AB||BC||AC|).
  // The signed area is 0.5 * cross, so k = 2 * cross / denom.
  return (2 * cross) / denom;
}
