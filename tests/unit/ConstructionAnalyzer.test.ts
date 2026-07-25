import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import {
  ConstructionConfig,
  MAX_ANALYSIS_SAMPLES,
  MAX_SEGMENT_LENGTH,
  TERRAIN_ANALYSIS_SPACING,
} from '../../src/config/ConstructionConfig';
import { elevationAtProfile } from '../../src/systems/VerticalAlignment';
import type { TrackGeometryDef } from '../../src/systems/TrackGeometry';

function straight(length: number, startX = -length / 2, y = 0): TrackGeometryDef {
  return {
    geometryVersion: 1,
    p0: { x: startX, y },
    p1: { x: startX + length / 3, y },
    p2: { x: startX + length * 2 / 3, y },
    p3: { x: startX + length, y },
  };
}

function analyse(
  geometry: TrackGeometryDef,
  heightAt: (x: number, y: number) => number,
) {
  return new ConstructionAnalyzer({ getHeightAt: heightAt }).analyze(geometry);
}

function structureTypes(proposal: ReturnType<typeof analyse>): string[] {
  return proposal.structures.map((interval) => interval.type);
}

describe('ConstructionAnalyzer', () => {
  it('analyses flat terrain as valid surface track', () => {
    const proposal = analyse(straight(640), () => 75);

    expect(proposal.valid).toBe(true);
    expect(proposal.reasonCode).toBe('ok');
    expect(proposal.length).toBeCloseTo(640, 6);
    expect(proposal.maximumGradePercent).toBe(0);
    expect(proposal.structures).toEqual([
      {
        type: 'surface',
        startT: 0,
        endT: 1,
        startElevation: 75,
        endElevation: 75,
      },
    ]);
  });

  it('classifies rolling terrain into surface, cut, and fill intervals', () => {
    const proposal = analyse(
      straight(640, 0),
      (x) => (x < 128 || x > 512
        ? 100
        : 100 + 30 * Math.sin((x * Math.PI) / 128)),
    );

    expect(proposal.valid).toBe(true);
    expect(structureTypes(proposal)).toEqual(expect.arrayContaining(['surface', 'cut', 'fill']));
    expect(proposal.costs.earthworks).toBeGreaterThan(0);
  });

  it('classifies a depression as a bridge interval', () => {
    const proposal = analyse(
      straight(640, 0),
      (x) => (x >= 192 && x <= 448 ? -180 : 0),
    );

    expect(proposal.valid).toBe(true);
    expect(structureTypes(proposal)).toContain('bridge');
    expect(proposal.costs.bridge).toBeGreaterThan(0);
  });

  it('classifies a ridge as a tunnel interval', () => {
    const proposal = analyse(
      straight(640, 0),
      (x) => (x >= 192 && x <= 448 ? 180 : 0),
    );

    expect(proposal.valid).toBe(true);
    expect(structureTypes(proposal)).toContain('tunnel');
    expect(proposal.costs.tunnel).toBeGreaterThan(0);
  });

  it('rejects an endpoint alignment that requires excessive grade', () => {
    const proposal = analyse(straight(640, 0), (x) => x * 0.1);

    expect(proposal.valid).toBe(false);
    expect(proposal.reasonCode).toBe('grade');
    expect(proposal.maximumGradePercent).toBeGreaterThan(
      ConstructionConfig.MAX_GRADE_PERCENT,
    );
    expect(proposal.maximumGradeT).toBeGreaterThan(0);
    expect(proposal.maximumGradeDistance).toBeGreaterThan(0);
    expect(proposal.maximumGradeDistance).toBeLessThanOrEqual(proposal.length);
    expect(proposal.remedy).toBe(
      'Too steep here — move the endpoint downhill or use a shorter section.',
    );
  });

  it('rejects a cubic whose minimum radius is below the configured limit', () => {
    const proposal = analyse({
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 50 },
      p2: { x: 50, y: 50 },
      p3: { x: 50, y: 0 },
    }, () => 0);

    expect(proposal.valid).toBe(false);
    expect(proposal.reasonCode).toBe('curvature');
    expect(proposal.minimumRadius).toBeLessThan(ConstructionConfig.MINIMUM_RADIUS);
    expect(proposal.remedy).toBe(
      'Curve radius too tight — widen the approach.',
    );
  });

  it('rejects a collinear cubic that reverses through a zero-speed cusp', () => {
    const proposal = analyse({
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 1000, y: 0 },
      p2: { x: -1000, y: 0 },
      p3: { x: 300, y: 0 },
    }, () => 0);

    expect(proposal.valid).toBe(false);
    expect(proposal.reasonCode).toBe('curvature');
    expect(proposal.minimumRadius).toBe(0);
  });

  it('detects derivative reversals narrower than one analysis sample bin', () => {
    const proposal = analyse({
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 6096.168, y: 0 },
      p2: { x: 96.336, y: 0 },
      p3: { x: 6000.504, y: 0 },
    }, () => 0);

    expect(proposal.valid).toBe(false);
    expect(proposal.reasonCode).toBe('curvature');
    expect(proposal.minimumRadius).toBe(0);
  });

  it('accepts the exact maximum length and rejects any longer segment', () => {
    const maximum = analyse(straight(MAX_SEGMENT_LENGTH), () => 0);
    const over = analyse(straight(MAX_SEGMENT_LENGTH + 1), () => 0);

    expect(TERRAIN_ANALYSIS_SPACING).toBe(64);
    expect(MAX_SEGMENT_LENGTH).toBe(6080);
    expect(maximum.valid).toBe(true);
    expect(over.valid).toBe(false);
    expect(over.reasonCode).toBe('too-long');
    expect(over.remedy).toBe(
      'Section too long to survey safely — build a shorter section.',
    );
  });

  it('rejects geometry outside the terrain world bounds', () => {
    const proposal = analyse(straight(256, 8100), () => 0);

    expect(proposal.valid).toBe(false);
    expect(proposal.reasonCode).toBe('out-of-bounds');
  });

  it('detects a narrow ridge positioned at the configured analysis spacing', () => {
    const proposal = analyse(
      straight(TERRAIN_ANALYSIS_SPACING * 4, 0),
      (x) => (Math.abs(x - TERRAIN_ANALYSIS_SPACING * 2) < 1e-9 ? 180 : 0),
    );

    expect(proposal.valid).toBe(true);
    expect(structureTypes(proposal)).toContain('tunnel');
  });

  it('samples the canonical curve rather than its endpoint chord', () => {
    const proposal = analyse({
      geometryVersion: 1,
      p0: { x: -1000, y: 0 },
      p1: { x: -333, y: 400 },
      p2: { x: 333, y: 400 },
      p3: { x: 1000, y: 0 },
    }, (_x, y) => (y > 200 ? 180 : 0));

    expect(proposal.valid).toBe(true);
    expect(structureTypes(proposal)).toContain('tunnel');
  });

  it('emits deterministic mixed surface, bridge, and tunnel intervals', () => {
    const proposal = analyse(straight(768, 0), (x) => {
      if (x >= 128 && x <= 256) return -180;
      if (x >= 448 && x <= 576) return 180;
      return 0;
    });

    expect(proposal.valid).toBe(true);
    expect(structureTypes(proposal)).toEqual(expect.arrayContaining([
      'surface',
      'bridge',
      'tunnel',
    ]));
    for (const interval of proposal.structures) {
      expect(interval.startElevation).toBeCloseTo(
        elevationAtProfile(proposal.verticalProfile, interval.startT),
        10,
      );
      expect(interval.endElevation).toBeCloseTo(
        elevationAtProfile(proposal.verticalProfile, interval.endT),
        10,
      );
    }
    expect(proposal.structureLengths.surface).toBeGreaterThan(0);
    expect(proposal.structureLengths.bridge).toBeGreaterThan(0);
    expect(proposal.structureLengths.tunnel).toBeGreaterThan(0);
    expect(proposal.structureLengths.cut).toBe(0);
    expect(proposal.structureLengths.fill).toBe(0);
    expect(Object.values(proposal.structureLengths).reduce(
      (sum, length) => sum + length,
      0,
    )).toBeCloseTo(proposal.length, 8);
  });

  it('calculates exact component summation and monotonic construction costs', () => {
    const flat = analyse(straight(640, 0), () => 0);
    const shallowEarthworks = analyse(
      straight(640, 0),
      (x) => (x >= 192 && x <= 448 ? 20 : 0),
    );
    const deepEarthworks = analyse(
      straight(640, 0),
      (x) => (x >= 192 && x <= 448 ? 40 : 0),
    );
    const shortBridge = analyse(
      straight(384, 0),
      (x) => (x >= 128 && x <= 256 ? -180 : 0),
    );
    const longBridge = analyse(
      straight(640, 0),
      (x) => (x >= 128 && x <= 512 ? -180 : 0),
    );
    const thresholdFill = analyse(
      straight(640, 0),
      (x) => (x >= 192 && x <= 448 ? -50 : 0),
    );
    const deeperBridge = analyse(
      straight(640, 0),
      (x) => (x >= 192 && x <= 448 ? -60 : 0),
    );

    expect(flat.costs.track).toBe(Math.round(flat.length * ConstructionConfig.TRACK_COST_PER_UNIT));
    expect(flat.costs).toEqual({
      track: flat.costs.track,
      earthworks: 0,
      bridge: 0,
      tunnel: 0,
      total: flat.costs.track,
    });
    for (const proposal of [shallowEarthworks, deepEarthworks, shortBridge, longBridge]) {
      expect(proposal.costs.total).toBe(
        proposal.costs.track
          + proposal.costs.earthworks
          + proposal.costs.bridge
          + proposal.costs.tunnel,
      );
    }
    expect(deepEarthworks.costs.earthworks).toBeGreaterThan(
      shallowEarthworks.costs.earthworks,
    );
    expect(longBridge.costs.bridge).toBeGreaterThan(shortBridge.costs.bridge);
    expect(deeperBridge.costs.total).toBeGreaterThanOrEqual(
      thresholdFill.costs.total,
    );
    expect([
      ConstructionConfig.TRACK_COST_PER_UNIT,
      ConstructionConfig.EARTHWORKS_COST_PER_DEPTH_UNIT,
      ConstructionConfig.BRIDGE_COST_PER_UNIT,
      ConstructionConfig.TUNNEL_COST_PER_UNIT,
    ].every((rate) => Number.isInteger(rate) && rate > 0)).toBe(true);
  });

  it('never performs more terrain reads than the live analysis sample cap', () => {
    const getHeightAt = jest.fn(() => 0);

    const proposal = new ConstructionAnalyzer({ getHeightAt }).analyze(
      straight(MAX_SEGMENT_LENGTH),
    );

    expect(proposal.valid).toBe(true);
    expect(getHeightAt.mock.calls.length).toBeLessThanOrEqual(MAX_ANALYSIS_SAMPLES);
    expect(getHeightAt.mock.calls.length).toBe(96);
  });

  it('keeps actual curve-space terrain sample gaps within the configured spacing', () => {
    const sampledPoints: Array<{ x: number; y: number }> = [];
    const geometry: TrackGeometryDef = {
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 1000, y: 0 },
      p2: { x: 1000, y: 0 },
      p3: { x: 1024, y: 0 },
    };

    const proposal = analyse(geometry, (x, y) => {
      sampledPoints.push({ x, y });
      return 0;
    });

    expect(proposal.valid).toBe(true);
    for (let index = 1; index < sampledPoints.length; index++) {
      expect(Math.hypot(
        sampledPoints[index].x - sampledPoints[index - 1].x,
        sampledPoints[index].y - sampledPoints[index - 1].y,
      )).toBeLessThanOrEqual(TERRAIN_ANALYSIS_SPACING + 1e-6);
    }
    expect(sampledPoints.length).toBeLessThanOrEqual(MAX_ANALYSIS_SAMPLES);
  });
});
