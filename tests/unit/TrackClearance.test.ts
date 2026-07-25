import {
  hasConstructionClearance,
  segmentToSegmentSquaredDistance,
  type ClearanceTrack,
} from '../../src/systems/TrackClearance';
import {
  sampleConstructionCurve,
  type ConstructionCurveSample,
} from '../../src/systems/ConstructionCurveSampler';
import type { TrackGeometryDef } from '../../src/systems/TrackGeometry';

function line(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): TrackGeometryDef {
  return {
    geometryVersion: 1,
    p0: { x: x0, y: y0 },
    p1: { x: x0 + (x1 - x0) / 3, y: y0 + (y1 - y0) / 3 },
    p2: { x: x0 + 2 * (x1 - x0) / 3, y: y0 + 2 * (y1 - y0) / 3 },
    p3: { x: x1, y: y1 },
  };
}

function profile(geometry: TrackGeometryDef): readonly ConstructionCurveSample[] {
  const result = sampleConstructionCurve(geometry);
  if (!result.ok) throw new Error('test geometry must be profileable');
  return result.samples;
}

function existing(
  trackUUID: string,
  geometry: TrackGeometryDef,
): ClearanceTrack {
  return { trackUUID, geometry, curveSamples: profile(geometry) };
}

function subdividedLineSamples(
  points: readonly number[],
): readonly ConstructionCurveSample[] {
  return points.map((x, index) => ({
    t: index / (points.length - 1),
    point: { x, y: 0 },
    distance: x - points[0],
    segmentLength: index === 0 ? 0 : x - points[index - 1],
  }));
}

function clear(
  geometry: TrackGeometryDef,
  tracks: readonly ClearanceTrack[],
  predictedConnections: Parameters<typeof hasConstructionClearance>[2] = [],
): boolean {
  return hasConstructionClearance(
    { geometry, curveSamples: profile(geometry) },
    tracks,
    predictedConnections,
  );
}

describe('TrackClearance', () => {
  it('computes crossing and degenerate segment distances without division errors', () => {
    expect(segmentToSegmentSquaredDistance(
      { x: -10, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: -10 },
      { x: 0, y: 10 },
    )).toBe(0);
    expect(segmentToSegmentSquaredDistance(
      { x: 3, y: 4 },
      { x: 3, y: 4 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    )).toBe(25);
    expect(segmentToSegmentSquaredDistance(
      { x: 3, y: 4 },
      { x: 3, y: 4 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    )).toBe(16);
  });

  it('rejects an interior crossing and a parallel route inside the protected corridor', () => {
    const horizontal = existing('horizontal', line(-150, 0, 150, 0));

    expect(clear(line(0, -150, 0, 150), [horizontal])).toBe(false);
    expect(clear(line(-150, 48, 150, 48), [horizontal])).toBe(false);
  });

  it('accepts the conservative sampled threshold and routes beyond it', () => {
    const horizontal = existing('horizontal', line(-150, 0, 150, 0));

    expect(clear(line(-150, 49, 150, 49), [horizontal]))
      .toBe(true);
    expect(clear(line(-150, 99, 150, 99), [horizontal]))
      .toBe(true);
  });

  it('uses control-hull broad phase without changing the answer', () => {
    const distantCurve: TrackGeometryDef = {
      geometryVersion: 1,
      p0: { x: 2_000, y: 2_000 },
      p1: { x: 2_100, y: 1_900 },
      p2: { x: 2_200, y: 2_100 },
      p3: { x: 2_300, y: 2_000 },
    };

    expect(clear(line(-150, 0, 150, 0), [existing('distant', distantCurve)]))
      .toBe(true);
  });

  it('allows only the exact opposite-facing connection throat named by a connection', () => {
    const neighbour = existing('neighbour', line(-300, 0, 0, 0));
    const proposed = line(0, 0, 300, 0);
    const exactConnection = [{
      kind: 'endpoint-connection' as const,
      existingTrackUUID: 'neighbour',
      existingEndpoint: 'end' as const,
      newEndpoint: 'start' as const,
      point: { x: 0, y: 0 },
    }];

    expect(clear(proposed, [neighbour], exactConnection)).toBe(true);
    expect(clear(proposed, [neighbour], [])).toBe(false);
    expect(clear(proposed, [neighbour], [{
      ...exactConnection[0],
      existingTrackUUID: 'unrelated',
    }])).toBe(false);
    expect(clear(proposed, [neighbour], [{
      ...exactConnection[0],
      kind: 'wrong-kind',
    } as unknown as typeof exactConnection[number]])).toBe(false);
  });

  it('makes the exact connection throat independent of short adaptive subdivisions', () => {
    const neighbourGeometry = line(-100, 0, 0, 0);
    const proposedGeometry = line(0, 0, 100, 0);
    const neighbour: ClearanceTrack = {
      trackUUID: 'neighbour',
      geometry: neighbourGeometry,
      curveSamples: subdividedLineSamples([-100, -50, 0]),
    };

    expect(hasConstructionClearance(
      {
        geometry: proposedGeometry,
        curveSamples: subdividedLineSamples([0, 10, 20, 60, 100]),
      },
      [neighbour],
      [{
        kind: 'endpoint-connection',
        existingTrackUUID: 'neighbour',
        existingEndpoint: 'end',
        newEndpoint: 'start',
        point: { x: 0, y: 0 },
      }],
    )).toBe(true);
  });

  it('rejects a same-direction overlap even when endpoint metadata is exact', () => {
    const neighbour = existing('neighbour', line(-300, 0, 0, 0));
    const overlapping = line(0, 0, -300, 0);

    expect(clear(overlapping, [neighbour], [{
      kind: 'endpoint-connection',
      existingTrackUUID: 'neighbour',
      existingEndpoint: 'end',
      newEndpoint: 'start',
      point: { x: 0, y: 0 },
    }])).toBe(false);
  });

  it('rejects a connected curve that returns into the existing route later', () => {
    const neighbour = existing('neighbour', line(-300, 0, 0, 0));
    const returning: TrackGeometryDef = {
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 160, y: 0 },
      p2: { x: -140, y: 100 },
      p3: { x: -150, y: 20 },
    };

    expect(clear(returning, [neighbour], [{
      kind: 'endpoint-connection',
      existingTrackUUID: 'neighbour',
      existingEndpoint: 'end',
      newEndpoint: 'start',
      point: { x: 0, y: 0 },
    }])).toBe(false);
  });

  it('fails closed for malformed or unprofiled geometry', () => {
    const geometry = line(0, 0, 300, 0);
    expect(hasConstructionClearance(
      { geometry, curveSamples: [] },
      [],
      [],
    )).toBe(false);
    expect(hasConstructionClearance(
      { geometry, curveSamples: profile(geometry) },
      [{ trackUUID: 'broken', geometry, curveSamples: [] }],
      [],
    )).toBe(false);
    expect(hasConstructionClearance(
      {
        geometry,
        curveSamples: profile(geometry).map((sample) => ({
          ...sample,
          distance: sample.distance - 100,
        })),
      },
      [],
      [],
    )).toBe(false);
    const repeated = profile(geometry).map((sample) => ({ ...sample }));
    repeated[1] = {
      ...repeated[1],
      t: 0,
      distance: 0,
      segmentLength: 0,
    };
    expect(hasConstructionClearance(
      { geometry, curveSamples: repeated },
      [],
      [],
    )).toBe(false);
  });
});
