import {
  worldToBabylon,
  worldHeadingToBabylonYaw,
  radToDeg,
  degToRad,
} from '../../src/cab3d/model/CabCoordinate';

describe('CabCoordinate', () => {
  describe('worldToBabylon', () => {
    it('maps game Y down to Babylon Z forward', () => {
      const result = worldToBabylon(100, 200, 50);
      expect(result).toEqual({ x: 100, y: 50, z: -200 });
    });

    it('preserves X and elevation', () => {
      const result = worldToBabylon(-500, 0, 380);
      expect(result.x).toBe(-500);
      expect(result.y).toBe(380);
      expect(result.z).toBe(0);
    });
  });

  describe('worldHeadingToBabylonYaw', () => {
    it('faces +X when moving right', () => {
      expect(worldHeadingToBabylonYaw(1, 0)).toBeCloseTo(0, 5);
    });

    it('faces forward (-Z) when moving down in game Y', () => {
      expect(worldHeadingToBabylonYaw(0, 1)).toBeCloseTo(-Math.PI / 2, 5);
    });

    it('faces backward (+Z) when moving up in game Y', () => {
      expect(worldHeadingToBabylonYaw(0, -1)).toBeCloseTo(Math.PI / 2, 5);
    });
  });

  describe('angle helpers', () => {
    it('converts radians to degrees', () => {
      expect(radToDeg(Math.PI)).toBe(180);
      expect(radToDeg(Math.PI / 2)).toBe(90);
    });

    it('converts degrees to radians', () => {
      expect(degToRad(180)).toBe(Math.PI);
      expect(degToRad(90)).toBe(Math.PI / 2);
    });
  });
});
