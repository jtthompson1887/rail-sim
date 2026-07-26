/**
 * Pure speed conversion for the cab view.
 *
 * The Matter.js `body.velocity` used by the game is a per-frame displacement,
 * so it is scaled by `1000 / lastDeltaMs` to give metres per second.
 */

/**
 * Convert a per-frame velocity vector to metres per second.
 *
 * @param vx        Frame displacement along the world X axis.
 * @param vy        Frame displacement along the world Y axis.
 * @param lastDeltaMs Time since the last frame in milliseconds (clamped to 1).
 * @param speedScale  Optional multiplier, from {@link CabConfig.SPEED_SCALE}.
 */
export function computeSpeedMps(
  vx: number,
  vy: number,
  lastDeltaMs: number,
  speedScale = 1,
): number {
  const deltaMs = Math.max(1, lastDeltaMs);
  return Math.hypot(vx, vy) * (1000 / deltaMs) * speedScale;
}
