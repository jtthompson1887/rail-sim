/**
 * Pure time-of-day helpers for the 3-D cab view.
 *
 * No Babylon, DOM or engine references — safe for unit tests.
 */

/** Unit sun vector plus solar altitude. */
export interface CabSunVector {
  /** X component of the normalised vector toward the sun. */
  x: number;
  /** Y component of the normalised vector toward the sun (positive = above horizon). */
  y: number;
  /** Z component of the normalised vector toward the sun. */
  z: number;
  /** Solar altitude in degrees, 0 at the horizon, positive above. */
  altitudeDeg: number;
}

/**
 * Convert elapsed simulation seconds to a 24-hour clock hour.
 * The day wraps every 18 simulation hours, starting at 06:00.
 */
export function getSimHours(elapsedSecs: number): number {
  return 6 + ((elapsedSecs / 60) % 18);
}

/**
 * Return a normalised vector pointing toward the sun for the given simulation hour.
 *
 * 06:00 and 18:00 place the sun on the horizon; 12:00 places it directly overhead.
 * Hours outside [6, 18] move the sun below the horizon until the next wrap.
 */
export function getSunVector(simHours: number): CabSunVector {
  const t = (simHours - 6) / 12;
  const theta = t * Math.PI;

  const x = Math.cos(theta);
  const y = Math.sin(theta);
  const z = 0;

  const magnitude = Math.hypot(x, y, z) || 1;
  const yNorm = y / magnitude;

  return {
    x: x / magnitude,
    y: yNorm,
    z: z / magnitude,
    altitudeDeg: Math.asin(Math.max(-1, Math.min(1, yNorm))) * (180 / Math.PI),
  };
}
