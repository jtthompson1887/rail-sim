import type { StructureType } from '../../src/cab3d/model/CabWorldSnapshot';
import type { CabTrackSample } from '../../src/cab3d/model/CabWorldSnapshot';
import { CabConfig } from '../../src/cab3d/CabConfig';
import {
  getRailProfile,
  getRailCapProfile,
  getBallastProfile,
  getBridgeDeckProfile,
  getTrackRightVector,
  getRailCenterPositions,
  getSleeperTransforms,
  getPierTransforms,
  getStructureSegments,
  computeTrackBoundingBox,
  sampleAtDistance,
} from '../../src/cab3d/world/TrackGeometry';

function makeStraightPath(
  from: number,
  to: number,
  spacing: number,
  headingRad = Math.PI / 2,
  structure: StructureType = 'surface',
  elevation = 0,
): CabTrackSample[] {
  const samples: CabTrackSample[] = [];
  const count = Math.round((to - from) / spacing);
  for (let i = 0; i <= count; i++) {
    const d = from + i * spacing;
    const x = 0;
    const y = d;
    samples.push({
      x,
      y,
      elevation,
      headingRad,
      curvature: 1,
      structure,
      distance: d,
    });
  }
  return samples;
}

describe('CabTrackGeometry', () => {
  it('provides a 12-point closed rail profile', () => {
    const profile = getRailProfile();
    expect(profile.length).toBe(12);

    const xs = profile.map((p) => p.x);
    const ys = profile.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-0.07, 5);
    expect(Math.max(...xs)).toBeCloseTo(0.07, 5);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(Math.max(...ys)).toBeCloseTo(0.159, 5);
  });

  it('provides a rail head cap 0.067 m wide and 0.004 m tall at y=0.157', () => {
    const cap = getRailCapProfile();
    expect(cap.length).toBe(4);

    const xs = cap.map((p) => p.x);
    const ys = cap.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.067, 5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.004, 5);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(0.157, 5);
  });

  it('provides a trapezoidal ballast profile', () => {
    const profile = getBallastProfile();
    const topWidth = profile[1].x - profile[0].x;
    const bottomWidth = profile[2].x - profile[3].x;
    const depth = profile[0].y - profile[3].y;
    expect(topWidth).toBeCloseTo(CabConfig.BALLAST_TOP_WIDTH_M, 5);
    expect(bottomWidth).toBeCloseTo(CabConfig.BALLAST_BOTTOM_WIDTH_M, 5);
    expect(depth).toBeCloseTo(CabConfig.BALLAST_DEPTH_M, 5);
  });

  it('provides a rectangular bridge deck profile', () => {
    const profile = getBridgeDeckProfile();
    const width = profile[1].x - profile[0].x;
    const depth = profile[0].y - profile[3].y;
    expect(width).toBeCloseTo(CabConfig.BRIDGE_DECK_WIDTH_M, 5);
    expect(depth).toBeCloseTo(CabConfig.BRIDGE_DECK_DEPTH_M, 5);
  });

  it('computes a unit right vector perpendicular to the track tangent', () => {
    for (const heading of [1, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const right = getTrackRightVector(heading);
      const tangent = { x: Math.cos(heading), y: 0, z: -Math.sin(heading) };
      const dot = right.x * tangent.x + right.z * tangent.z;
      expect(dot).toBeCloseTo(0, 5);
      expect(Math.hypot(right.x, right.z)).toBeCloseTo(1, 5);
    }
  });

  it('places rail centres at the configured offset', () => {
    const path = makeStraightPath(0, 130, 2);
    const { left, right } = getRailCenterPositions(path);

    expect(left.length).toBe(path.length);
    expect(right.length).toBe(path.length);

    for (let i = 1; i < path.length; i++) {
      const dx = right[i].x - left[i].x;
      const dy = right[i].y - left[i].y;
      const dz = right[i].z - left[i].z;
      const separation = Math.hypot(dx, dy, dz);
      expect(separation).toBeCloseTo(CabConfig.RAIL_CENTRE_OFFSET_M * 2, 5);
    }
  });

  it('keeps the inner-face gauge close to 1.435 m', () => {
    const path = makeStraightPath(0, 130, 2);
    const { left, right } = getRailCenterPositions(path);
    const offset = CabConfig.RAIL_HEAD_HALF_WIDTH_M;

    for (let i = 1; i < path.length; i++) {
      const dirX = right[i].x - left[i].x;
      const dirZ = right[i].z - left[i].z;
      const len = Math.hypot(dirX, dirZ);
      const ux = dirX / len;
      const uz = dirZ / len;

      const leftInnerX = left[i].x + ux * offset;
      const leftInnerZ = left[i].z + uz * offset;
      const rightInnerX = right[i].x - ux * offset;
      const rightInnerZ = right[i].z - uz * offset;

      const gauge = Math.hypot(
        rightInnerX - leftInnerX,
        rightInnerZ - leftInnerZ,
      );
      expect(gauge).toBeCloseTo(CabConfig.RAIL_GAUGE_M, 2);
    }
  });

  it('generates the expected number of sleepers over 130 m', () => {
    const path = makeStraightPath(0, 130, 2);
    const transforms = getSleeperTransforms(path);
    expect(transforms.length).toBe(Math.floor(130 / CabConfig.SLEEPER_SPACING_M));
  });

  it('spaces sleepers evenly', () => {
    const path = makeStraightPath(0, 130, 2);
    const transforms = getSleeperTransforms(path);
    for (let i = 1; i < transforms.length; i++) {
      const dx = transforms[i].position.x - transforms[i - 1].position.x;
      const dz = transforms[i].position.z - transforms[i - 1].position.z;
      const step = Math.hypot(dx, dz);
      expect(step).toBeCloseTo(CabConfig.SLEEPER_SPACING_M, 5);
    }
  });

  it('orients sleepers perpendicular to the track heading', () => {
    const heading = Math.PI / 3;
    const path = makeStraightPath(0, 130, 2, heading);
    const transforms = getSleeperTransforms(path);
    for (const t of transforms) {
      expect(t.yaw).toBeCloseTo(heading, 5);
    }
  });

  it('groups a path into contiguous structure segments', () => {
    const path: CabTrackSample[] = [
      ...makeStraightPath(0, 50, 2, Math.PI / 2, 'surface'),
      ...makeStraightPath(50, 100, 2, Math.PI / 2, 'bridge'),
      ...makeStraightPath(100, 130, 2, Math.PI / 2, 'tunnel'),
    ];
    const segments = getStructureSegments(path);
    expect(segments.length).toBe(3);
    expect(segments[0].structure).toBe('surface');
    expect(segments[1].structure).toBe('bridge');
    expect(segments[2].structure).toBe('tunnel');
    expect(segments[0].startIndex).toBe(0);
    expect(segments[0].endIndex).toBe(segments[1].startIndex);
  });

  it('places piers at the configured spacing along a bridge segment', () => {
    const path = makeStraightPath(0, 100, 2, Math.PI / 2, 'bridge');
    const piers = getPierTransforms(
      path,
      CabConfig.PIER_SPACING_M,
      0,
      100,
    );

    const first = piers[0];
    const last = piers[piers.length - 1];
    const step = Math.hypot(
      last.position.x - first.position.x,
      last.position.z - first.position.z,
    );
    expect(100 / (piers.length - 1)).toBeCloseTo(CabConfig.PIER_SPACING_M, 5);
    expect(step).toBeCloseTo(100, 5);
  });

  it('interpolates a track sample at an arbitrary distance', () => {
    const path = makeStraightPath(0, 100, 2);
    const atZero = sampleAtDistance(path, 0);
    expect(atZero!.distance).toBe(0);

    const mid = sampleAtDistance(path, 50);
    expect(mid!.distance).toBe(50);
    expect(mid!.y).toBeCloseTo(50, 5);
  });

  it('computes a 100 m straight bounding box inside the required limits', () => {
    const path = makeStraightPath(0, 100, 2, Math.PI / 2, 'surface', 0);
    const box = computeTrackBoundingBox(path);

    expect(box.minX).toBeGreaterThanOrEqual(-2.8);
    expect(box.maxX).toBeLessThanOrEqual(2.8);
    expect(box.minY).toBeGreaterThanOrEqual(-0.35);
    expect(box.maxY).toBeLessThanOrEqual(0.16);
  });
});
