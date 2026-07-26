export interface ConstructionGridPoint {
  x: number;
  y: number;
  snapped: boolean;
}

/**
 * Apply the construction grid rule without consulting tracks or editor state.
 *
 * The nearest grid intersection is accepted only inside the inclusive
 * Euclidean half-cell radius. Invalid inputs and disabled grids preserve the
 * raw coordinate, matching SnapSystem's defensive behaviour.
 */
export function canonicalizeConstructionGridPoint(
  x: number,
  y: number,
  gridSize: number,
  enabled: boolean = true,
): ConstructionGridPoint {
  if (!enabled
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(gridSize)
    || gridSize <= 0) {
    return { x, y, snapped: false };
  }

  const gridX = Math.round(x / gridSize) * gridSize;
  const gridY = Math.round(y / gridSize) * gridSize;
  if (Math.hypot(gridX - x, gridY - y) <= gridSize * 0.5) {
    return { x: gridX, y: gridY, snapped: true };
  }
  return { x, y, snapped: false };
}
