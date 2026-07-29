import { GameConfig } from '../../src/config/GameConfig';
import {
  canonicalizeConstructionGridPoint,
} from '../../src/systems/ConstructionGrid';

describe('canonicalizeConstructionGridPoint', () => {
  const gridSize = GameConfig.WORLD.SNAP_GRID_SIZE;

  it('snaps at the inclusive half-cell boundary', () => {
    expect(canonicalizeConstructionGridPoint(25, 0, gridSize)).toEqual({
      x: 50,
      y: 0,
      snapped: true,
    });
  });

  it('keeps the raw point just outside the Euclidean half-cell boundary', () => {
    expect(canonicalizeConstructionGridPoint(25, 0.001, gridSize)).toEqual({
      x: 25,
      y: 0.001,
      snapped: false,
    });
  });

  it('canonicalizes the known generated route endpoints', () => {
    expect(canonicalizeConstructionGridPoint(
      -3480.908468775451,
      -6246.389408730858,
      gridSize,
    )).toEqual({
      x: -3500,
      y: -6250,
      snapped: true,
    });
    expect(canonicalizeConstructionGridPoint(
      -4950.662778654892,
      -7176.117067981511,
      gridSize,
    )).toEqual({
      x: -4950,
      y: -7200,
      snapped: true,
    });
  });

  it('is idempotent for both snapped and unsnapped points', () => {
    for (const point of [
      { x: -3480.908468775451, y: -6246.389408730858 },
      { x: 25, y: 0.001 },
    ]) {
      const first = canonicalizeConstructionGridPoint(
        point.x,
        point.y,
        gridSize,
      );
      expect(canonicalizeConstructionGridPoint(
        first.x,
        first.y,
        gridSize,
      )).toEqual(first);
    }
  });

  it.each([
    ['disabled', 10, 12, gridSize, false],
    ['zero grid', 10, 12, 0, true],
    ['negative grid', 10, 12, -50, true],
    ['NaN grid', 10, 12, Number.NaN, true],
    ['infinite grid', 10, 12, Number.POSITIVE_INFINITY, true],
    ['NaN coordinate', Number.NaN, 12, gridSize, true],
    ['infinite coordinate', 10, Number.POSITIVE_INFINITY, gridSize, true],
  ])('keeps raw coordinates for %s', (
    _label,
    x,
    y,
    size,
    enabled,
  ) => {
    expect(canonicalizeConstructionGridPoint(x, y, size, enabled)).toEqual({
      x,
      y,
      snapped: false,
    });
  });
});
