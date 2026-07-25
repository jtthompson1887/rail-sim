import { GameConfig } from '../config/GameConfig';
import {
  ConstructionConfig,
  MAX_ANALYSIS_SAMPLES,
  MAX_SEGMENT_LENGTH,
  TERRAIN_ANALYSIS_SPACING,
} from '../config/ConstructionConfig';
import type {
  ConstructionCostBreakdown,
  StructureInterval,
  StructureType,
  VerticalProfileDef,
} from '../config/WorldData';
import {
  createTrackGeometry,
  type TrackGeometryDef,
} from './TrackGeometry';
import {
  deriveVerticalAlignment,
  type TerrainProfileSample,
  type VerticalAlignmentResult,
} from './VerticalAlignment';

export interface TerrainHeightSource {
  getHeightAt(x: number, y: number): number;
}

export interface ConstructionAnalysisOptions {
  connectionAngleDeg?: number;
}

export type ConstructionReasonCode =
  | 'ok'
  | 'too-short'
  | 'too-long'
  | 'out-of-bounds'
  | 'grade'
  | 'curvature'
  | 'clearance'
  | 'misaligned';

export interface ConstructionProposal {
  geometry: TrackGeometryDef;
  verticalProfile: VerticalProfileDef;
  length: number;
  minimumRadius: number;
  maximumGradePercent: number;
  maximumGradeT: number;
  structures: StructureInterval[];
  costs: ConstructionCostBreakdown;
  valid: boolean;
  reasonCode: ConstructionReasonCode;
  remedy: string;
}

interface AnalysedSegment {
  type: StructureType;
  length: number;
  averageDepth: number;
}

const EMPTY_PROFILE: VerticalProfileDef = {
  profileVersion: 1,
  knots: [
    { t: 0, elevation: 0 },
    { t: 1, elevation: 0 },
  ],
};

const ZERO_COSTS: ConstructionCostBreakdown = {
  track: 0,
  earthworks: 0,
  bridge: 0,
  tunnel: 0,
  total: 0,
};

const CURVATURE_EPSILON = 1e-10;
const LENGTH_EPSILON = 1e-6;
const ARC_LOOKUP_INTERVALS = MAX_ANALYSIS_SAMPLES * 16;

function remedyFor(reasonCode: ConstructionReasonCode): string {
  const remedies: Record<ConstructionReasonCode, string> = {
    ok: '',
    'too-short': 'Extend the segment to at least 64 world units.',
    'too-long': 'Split the route into shorter construction segments.',
    'out-of-bounds': 'Keep the entire route inside the terrain boundary.',
    grade: 'Choose endpoints with less elevation difference.',
    curvature: 'Use a broader curve with a larger radius.',
    clearance: 'Move the route away from existing infrastructure.',
    misaligned: 'Align the new route with the connected track tangent.',
  };
  return remedies[reasonCode];
}

function invalidProposal(
  geometry: TrackGeometryDef,
  length: number,
  reasonCode: ConstructionReasonCode,
  minimumRadius = Infinity,
): ConstructionProposal {
  return {
    geometry,
    verticalProfile: EMPTY_PROFILE,
    length,
    minimumRadius,
    maximumGradePercent: 0,
    maximumGradeT: 0,
    structures: [],
    costs: ZERO_COSTS,
    valid: false,
    reasonCode,
    remedy: remedyFor(reasonCode),
  };
}

function derivatives(
  def: TrackGeometryDef,
  t: number,
): { dx: number; dy: number; ddx: number; ddy: number } {
  const inverse = 1 - t;
  return {
    dx: 3 * (
      inverse ** 2 * (def.p1.x - def.p0.x)
      + 2 * inverse * t * (def.p2.x - def.p1.x)
      + t ** 2 * (def.p3.x - def.p2.x)
    ),
    dy: 3 * (
      inverse ** 2 * (def.p1.y - def.p0.y)
      + 2 * inverse * t * (def.p2.y - def.p1.y)
      + t ** 2 * (def.p3.y - def.p2.y)
    ),
    ddx: 6 * (
      inverse * (def.p2.x - 2 * def.p1.x + def.p0.x)
      + t * (def.p3.x - 2 * def.p2.x + def.p1.x)
    ),
    ddy: 6 * (
      inverse * (def.p2.y - 2 * def.p1.y + def.p0.y)
      + t * (def.p3.y - 2 * def.p2.y + def.p1.y)
    ),
  };
}

function derivativePolynomial(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): { a: number; b: number; c: number } {
  return {
    a: 3 * (-p0 + 3 * p1 - 3 * p2 + p3),
    b: 6 * (p0 - 2 * p1 + p2),
    c: 3 * (p1 - p0),
  };
}

function realQuadraticRoots(a: number, b: number, c: number): number[] {
  const coefficientScale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
  const epsilon = coefficientScale * 1e-12;
  if (Math.abs(a) <= epsilon) {
    return Math.abs(b) <= epsilon ? [] : [-c / b];
  }

  const discriminant = b * b - 4 * a * c;
  const discriminantTolerance = coefficientScale * coefficientScale * 1e-12;
  if (discriminant < -discriminantTolerance) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [
    (-b - root) / (2 * a),
    (-b + root) / (2 * a),
  ];
}

function hasStationaryPoint(def: TrackGeometryDef): boolean {
  const x = derivativePolynomial(def.p0.x, def.p1.x, def.p2.x, def.p3.x);
  const y = derivativePolynomial(def.p0.y, def.p1.y, def.p2.y, def.p3.y);
  const candidates = [
    0,
    1,
    ...realQuadraticRoots(x.a, x.b, x.c),
    ...realQuadraticRoots(y.a, y.b, y.c),
  ];
  const controlScale = Math.max(
    1,
    Math.hypot(def.p1.x - def.p0.x, def.p1.y - def.p0.y),
    Math.hypot(def.p2.x - def.p1.x, def.p2.y - def.p1.y),
    Math.hypot(def.p3.x - def.p2.x, def.p3.y - def.p2.y),
  );
  const speedTolerance = controlScale * 1e-7;

  return candidates.some((candidate) => {
    if (candidate < -1e-12 || candidate > 1 + 1e-12) return false;
    const t = Math.max(0, Math.min(1, candidate));
    const { dx, dy } = derivatives(def, t);
    return Math.hypot(dx, dy) <= speedTolerance;
  });
}

export function minimumRadiusForGeometry(def: TrackGeometryDef): number {
  if (hasStationaryPoint(def)) return 0;

  const sampledPoints = createTrackGeometry(def).sample(MAX_ANALYSIS_SAMPLES);
  let previousDirection: { x: number; y: number } | null = null;
  for (let index = 1; index < sampledPoints.length; index++) {
    const x = sampledPoints[index].point.x - sampledPoints[index - 1].point.x;
    const y = sampledPoints[index].point.y - sampledPoints[index - 1].point.y;
    const length = Math.hypot(x, y);
    if (length < LENGTH_EPSILON) return 0;
    const direction = { x: x / length, y: y / length };
    if (
      previousDirection
      && previousDirection.x * direction.x + previousDirection.y * direction.y <= 0
    ) {
      return 0;
    }
    previousDirection = direction;
  }

  let minimumRadius = Infinity;
  for (let index = 0; index <= MAX_ANALYSIS_SAMPLES; index++) {
    const { dx, dy, ddx, ddy } = derivatives(
      def,
      index / MAX_ANALYSIS_SAMPLES,
    );
    const denominator = Math.pow(dx * dx + dy * dy, 1.5);
    if (denominator < CURVATURE_EPSILON) continue;
    const curvature = Math.abs(dx * ddy - dy * ddx) / denominator;
    if (curvature > CURVATURE_EPSILON) {
      minimumRadius = Math.min(minimumRadius, 1 / curvature);
    }
  }
  return minimumRadius;
}

function typeForDepth(depth: number): StructureType {
  if (depth >= ConstructionConfig.BRIDGE_CLEARANCE) return 'bridge';
  if (depth <= -ConstructionConfig.TUNNEL_DEPTH) return 'tunnel';
  if (depth > ConstructionConfig.SURFACE_TOLERANCE) return 'fill';
  if (depth < -ConstructionConfig.SURFACE_TOLERANCE) return 'cut';
  return 'surface';
}

function classifyStructures(
  samples: TerrainProfileSample[],
  alignment: VerticalAlignmentResult,
): { structures: StructureInterval[]; segments: AnalysedSegment[] } {
  const structures: StructureInterval[] = [];
  const segments: AnalysedSegment[] = [];

  for (let index = 1; index < samples.length; index++) {
    const start = samples[index - 1];
    const end = samples[index];
    const startElevation = alignment.sampleElevations[index - 1];
    const endElevation = alignment.sampleElevations[index];
    const startDepth = startElevation - start.terrainElevation;
    const endDepth = endElevation - end.terrainElevation;
    const representativeDepth = Math.abs(startDepth) >= Math.abs(endDepth)
      ? startDepth
      : endDepth;
    const type = typeForDepth(representativeDepth);
    const segment = {
      type,
      length: end.distance - start.distance,
      averageDepth: (Math.abs(startDepth) + Math.abs(endDepth)) / 2,
    };
    segments.push(segment);

    const previous = structures[structures.length - 1];
    if (previous?.type === type) {
      previous.endT = end.t;
      previous.endElevation = endElevation;
    } else {
      structures.push({
        type,
        startT: start.t,
        endT: end.t,
        startElevation,
        endElevation,
      });
    }
  }

  return { structures, segments };
}

function calculateCosts(length: number, segments: AnalysedSegment[]): ConstructionCostBreakdown {
  const track = Math.round(length * ConstructionConfig.TRACK_COST_PER_UNIT);
  let earthworksQuantity = 0;
  let bridgeLength = 0;
  let tunnelLength = 0;

  for (const segment of segments) {
    if (segment.type !== 'surface') {
      earthworksQuantity += segment.length * segment.averageDepth;
    }
    if (segment.type === 'bridge') {
      bridgeLength += segment.length;
    } else if (segment.type === 'tunnel') {
      tunnelLength += segment.length;
    }
  }

  const earthworks = Math.round(
    earthworksQuantity * ConstructionConfig.EARTHWORKS_COST_PER_DEPTH_UNIT,
  );
  const bridge = Math.round(bridgeLength * ConstructionConfig.BRIDGE_COST_PER_UNIT);
  const tunnel = Math.round(tunnelLength * ConstructionConfig.TUNNEL_COST_PER_UNIT);
  return {
    track,
    earthworks,
    bridge,
    tunnel,
    total: track + earthworks + bridge + tunnel,
  };
}

function buildArcLookup(geometry: ReturnType<typeof createTrackGeometry>): {
  samples: Array<{ t: number; point: { x: number; y: number }; distance: number }>;
  length: number;
} {
  let distance = 0;
  const samples = geometry.sample(ARC_LOOKUP_INTERVALS).map((sample, index, all) => {
    if (index > 0) {
      distance += Math.hypot(
        sample.point.x - all[index - 1].point.x,
        sample.point.y - all[index - 1].point.y,
      );
    }
    return { ...sample, distance };
  });
  return { samples, length: distance };
}

function sampleAtArcDistances(
  geometry: ReturnType<typeof createTrackGeometry>,
  lookup: ReturnType<typeof buildArcLookup>,
  sampleCount: number,
): Array<{ t: number; point: { x: number; y: number }; distance: number }> {
  let lookupIndex = 1;
  return Array.from({ length: sampleCount }, (_, index) => {
    if (index === 0) {
      return { t: 0, point: geometry.pointAt(0), distance: 0 };
    }
    if (index === sampleCount - 1) {
      return { t: 1, point: geometry.pointAt(1), distance: lookup.length };
    }
    const distance = lookup.length * index / (sampleCount - 1);
    while (
      lookupIndex < lookup.samples.length - 1
      && lookup.samples[lookupIndex].distance < distance
    ) {
      lookupIndex++;
    }
    const end = lookup.samples[lookupIndex];
    const start = lookup.samples[lookupIndex - 1];
    const span = end.distance - start.distance;
    const ratio = span > 0 ? (distance - start.distance) / span : 0;
    const t = start.t + (end.t - start.t) * ratio;
    return { t, point: geometry.pointAt(t), distance };
  });
}

function refineOversizedGaps(
  geometry: ReturnType<typeof createTrackGeometry>,
  samples: Array<{ t: number; point: { x: number; y: number }; distance: number }>,
): Array<{ t: number; point: { x: number; y: number }; distance: number }> {
  const refined = [...samples];
  let index = 1;
  while (index < refined.length && refined.length < MAX_ANALYSIS_SAMPLES) {
    const previous = refined[index - 1];
    const current = refined[index];
    const gap = Math.hypot(
      current.point.x - previous.point.x,
      current.point.y - previous.point.y,
    );
    if (gap > TERRAIN_ANALYSIS_SPACING + LENGTH_EPSILON) {
      const t = (previous.t + current.t) / 2;
      refined.splice(index, 0, {
        t,
        point: geometry.pointAt(t),
        distance: (previous.distance + current.distance) / 2,
      });
    } else {
      index++;
    }
  }
  return refined;
}

export class ConstructionAnalyzer {
  constructor(private readonly terrain: TerrainHeightSource) {}

  analyze(
    geometryDef: TrackGeometryDef,
    options: ConstructionAnalysisOptions = {},
  ): ConstructionProposal {
    const geometry = createTrackGeometry(geometryDef);
    const arcLookup = buildArcLookup(geometry);
    const estimatedLength = arcLookup.length;

    if (estimatedLength < ConstructionConfig.MIN_SEGMENT_LENGTH - LENGTH_EPSILON) {
      return invalidProposal(geometryDef, estimatedLength, 'too-short');
    }
    if (estimatedLength > MAX_SEGMENT_LENGTH + LENGTH_EPSILON) {
      return invalidProposal(geometryDef, estimatedLength, 'too-long');
    }

    const halfWidth = GameConfig.TERRAIN.WORLD_WIDTH / 2;
    const halfHeight = GameConfig.TERRAIN.WORLD_HEIGHT / 2;
    if (arcLookup.samples.some(({ point }) => (
      point.x < -halfWidth
      || point.x > halfWidth
      || point.y < -halfHeight
      || point.y > halfHeight
    ))) {
      return invalidProposal(geometryDef, estimatedLength, 'out-of-bounds');
    }

    const minimumRadius = minimumRadiusForGeometry(geometryDef);
    if (minimumRadius < ConstructionConfig.MINIMUM_RADIUS) {
      return invalidProposal(
        geometryDef,
        estimatedLength,
        'curvature',
        minimumRadius,
      );
    }
    if ((options.connectionAngleDeg ?? 0) > GameConfig.TRACK.ALIGNMENT_ANGLE_DEG) {
      return invalidProposal(
        geometryDef,
        estimatedLength,
        'misaligned',
        minimumRadius,
      );
    }

    const sampleCount = Math.min(
      MAX_ANALYSIS_SAMPLES,
      Math.ceil((estimatedLength - LENGTH_EPSILON) / TERRAIN_ANALYSIS_SPACING) + 1,
    );
    const curveSamples = refineOversizedGaps(
      geometry,
      sampleAtArcDistances(geometry, arcLookup, sampleCount),
    );
    const totalLength = arcLookup.length;
    const terrainSamples: TerrainProfileSample[] = curveSamples.map(
      ({ t, point, distance }, index) => ({
        t,
        distance,
        terrainElevation: this.terrain.getHeightAt(point.x, point.y),
        point,
        segmentLength: index === 0 ? 0 : distance - curveSamples[index - 1].distance,
        totalLength,
      }),
    );
    const alignment = deriveVerticalAlignment(terrainSamples);
    const classified = classifyStructures(terrainSamples, alignment);
    const costs = calculateCosts(totalLength, classified.segments);
    const valid = alignment.maximumGradePercent
      <= ConstructionConfig.MAX_GRADE_PERCENT + 1e-9;
    const reasonCode: ConstructionReasonCode = valid ? 'ok' : 'grade';

    return {
      geometry: geometryDef,
      verticalProfile: alignment.verticalProfile,
      length: totalLength,
      minimumRadius,
      maximumGradePercent: alignment.maximumGradePercent,
      maximumGradeT: alignment.maximumGradeT,
      structures: classified.structures,
      costs,
      valid,
      reasonCode,
      remedy: remedyFor(reasonCode),
    };
  }
}
