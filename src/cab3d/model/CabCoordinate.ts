/**
 * Single, authoritative world → Babylon coordinate conversion.
 *
 * Game world uses X right, Y down, elevation separate.
 * Babylon uses a left-handed system where +Z is forward, +Y up.
 */
export function worldToBabylon(
  worldX: number,
  worldY: number,
  elevation: number,
): { x: number; y: number; z: number } {
  return {
    x: worldX,
    y: elevation,
    z: -worldY || 0,
  };
}

/**
 * Convert a 2-D world heading (0 = +X, positive counter-clockwise) to the
 * Babylon yaw used by the camera rig (left-handed system).
 */
export function worldHeadingToBabylonYaw(dx: number, dy: number): number {
  return -Math.atan2(dy, dx);
}

/** Convert radians to degrees. */
export function radToDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

/** Convert degrees to radians. */
export function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}
