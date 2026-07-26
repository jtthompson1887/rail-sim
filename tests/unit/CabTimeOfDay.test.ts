import {
  getSimHours,
  getSunVector,
} from '../../src/cab3d/atmosphere/CabTimeOfDay';

describe('CabTimeOfDay', () => {
  describe('getSimHours', () => {
    it('starts at 06:00 with zero elapsed time', () => {
      expect(getSimHours(0)).toBeCloseTo(6, 10);
    });

    it('wraps every 1080 seconds of elapsed simulation time', () => {
      expect(getSimHours(1080)).toBeCloseTo(6, 10);
      expect(getSimHours(2160)).toBeCloseTo(6, 10);
      expect(getSimHours(1110)).toBeCloseTo(6.5, 10);
      expect(getSimHours(540)).toBeCloseTo(15, 10);
    });
  });

  describe('getSunVector', () => {
    it('returns a unit vector at 06:00 (sun on +X horizon)', () => {
      const sun = getSunVector(6);
      expect(sun.x).toBeCloseTo(1, 10);
      expect(sun.y).toBeCloseTo(0, 10);
      expect(sun.z).toBe(0);
      expect(sun.altitudeDeg).toBeCloseTo(0, 10);
      expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 10);
    });

    it('returns a unit vector at 12:00 (sun directly overhead)', () => {
      const sun = getSunVector(12);
      expect(sun.x).toBeCloseTo(0, 10);
      expect(sun.y).toBeCloseTo(1, 10);
      expect(sun.z).toBe(0);
      expect(sun.altitudeDeg).toBeCloseTo(90, 10);
      expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 10);
    });

    it('returns a unit vector at 18:00 (sun on -X horizon)', () => {
      const sun = getSunVector(18);
      expect(sun.x).toBeCloseTo(-1, 10);
      expect(sun.y).toBeCloseTo(0, 10);
      expect(sun.z).toBe(0);
      expect(sun.altitudeDeg).toBeCloseTo(0, 10);
      expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 10);
    });

    it('reports negative altitude for night hours before the next wrap', () => {
      const sun = getSunVector(22);
      expect(sun.y).toBeLessThan(0);
      expect(sun.altitudeDeg).toBeLessThan(0);
    });
  });
});
