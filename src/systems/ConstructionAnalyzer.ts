import { GameConfig } from '../config/GameConfig';
import {
  ConstructionConfig,
  MAX_SEGMENT_LENGTH,
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
  sampleConstructionCurve,
  type ConstructionCurveSample,
} from './ConstructionCurveSampler';
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
  maximumGradeDistance: number;
  structures: StructureInterval[];
  structureLengths: Record<StructureType, number>;
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

function emptyStructureLengths(): Record<StructureType, number> {
  return {
    surface: 0,
    cut: 0,
    fill: 0,
    bridge: 0,
    tunnel: 0,
  };
}

function structureLengthsFor(
  segments: AnalysedSegment[],
): Record<StructureType, number> {
  const lengths = emptyStructureLengths();
  for (const segment of segments) lengths[segment.type] += segment.length;
  return lengths;
}

const CURVATURE_EPSILON = 1e-10;
const LENGTH_EPSILON = 1e-6;

function remedyFor(reasonCode: ConstructionReasonCode): string {
  const remedies: Record<ConstructionReasonCode, string> = {
    ok: '',
    'too-short': 'Extend the segment to at least 64 world units.',
    'too-long': 'Section too long to survey safely — build a shorter section.',
    'out-of-bounds': 'Keep the entire route inside the terrain boundary.',
    grade: 'Too steep here — move the endpoint downhill or use a shorter section.',
    curvature: 'Curve radius too tight — widen the approach.',
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
    maximumGradeDistance: 0,
    structures: [],
    structureLengths: emptyStructureLengths(),
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

export function minimumRadiusForGeometry(
  def: TrackGeometryDef,
  sampledPoints: readonly ConstructionCurveSample[],
): number {
  if (hasStationaryPoint(def)) return 0;

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
  for (const { t } of sampledPoints) {
    const { dx, dy, ddx, ddy } = derivatives(def, t);
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

function geometryIsOutsideBounds(def: TrackGeometryDef): boolean {
  const halfWidth = GameConfig.TERRAIN.WORLD_WIDTH / 2;
  const halfHeight = GameConfig.TERRAIN.WORLD_HEIGHT / 2;
  const candidateTs = [0, 1];
  for (const coordinates of [
    [def.p0.x, def.p1.x, def.p2.x, def.p3.x],
    [def.p0.y, def.p1.y, def.p2.y, def.p3.y],
  ]) {
    const polynomial = derivativePolynomial(...coordinates as [number, number, number, number]);
    candidateTs.push(...realQuadraticRoots(
      polynomial.a,
      polynomial.b,
      polynomial.c,
    ).filter((t) => t > 0 && t < 1));
  }
  const geometry = createTrackGeometry(def);
  return candidateTs.some((t) => {
    const point = geometry.pointAt(t);
    return point.x < -halfWidth
      || point.x > halfWidth
      || point.y < -halfHeight
      || point.y > halfHeight;
  });
}

export interface ConstructionAnalysisDetail {
  readonly proposal: ConstructionProposal;
  readonly curveSamples: readonly ConstructionCurveSample[];
}

export class ConstructionAnalyzer {
  constructor(private readonly terrain: TerrainHeightSource) {}

  analyze(
    geometryDef: TrackGeometryDef,
    options: ConstructionAnalysisOptions = {},
  ): ConstructionProposal {
    return this.analyzeDetailed(geometryDef, options).proposal;
  }

  analyzeDetailed(
    geometryDef: TrackGeometryDef,
    options: ConstructionAnalysisOptions = {},
  ): ConstructionAnalysisDetail {
    const curveProfile = sampleConstructionCurve(geometryDef);
    if (curveProfile.ok === false) {
      if (hasStationaryPoint(geometryDef)) {
        return {
          proposal: invalidProposal(
            geometryDef,
            curveProfile.lowerBoundLength,
            'curvature',
            0,
          ),
          curveSamples: Object.freeze([]),
        };
      }
      return {
        proposal: invalidProposal(
          geometryDef,
          curveProfile.lowerBoundLength,
          'too-long',
        ),
        curveSamples: Object.freeze([]),
      };
    }
    const estimatedLength = curveProfile.length;

    if (estimatedLength < ConstructionConfig.MIN_SEGMENT_LENGTH - LENGTH_EPSILON) {
      return {
        proposal: invalidProposal(geometryDef, estimatedLength, 'too-short'),
        curveSamples: curveProfile.samples,
      };
    }
    if (estimatedLength > MAX_SEGMENT_LENGTH + LENGTH_EPSILON) {
      return {
        proposal: invalidProposal(geometryDef, estimatedLength, 'too-long'),
        curveSamples: curveProfile.samples,
      };
    }

    if (geometryIsOutsideBounds(geometryDef)) {
      return {
        proposal: invalidProposal(geometryDef, estimatedLength, 'out-of-bounds'),
        curveSamples: curveProfile.samples,
      };
    }

    const minimumRadius = minimumRadiusForGeometry(geometryDef, curveProfile.samples);
    if (minimumRadius < ConstructionConfig.MINIMUM_RADIUS) {
      return {
        proposal: invalidProposal(
          geometryDef,
          estimatedLength,
          'curvature',
          minimumRadius,
        ),
        curveSamples: curveProfile.samples,
      };
    }
    if ((options.connectionAngleDeg ?? 0) > GameConfig.TRACK.ALIGNMENT_ANGLE_DEG) {
      return {
        proposal: invalidProposal(
          geometryDef,
          estimatedLength,
          'misaligned',
          minimumRadius,
        ),
        curveSamples: curveProfile.samples,
      };
    }

    const totalLength = curveProfile.length;
    const terrainSamples: TerrainProfileSample[] = curveProfile.samples.map(
      ({ t, point, distance }, index) => ({
        t,
        distance,
        terrainElevation: this.terrain.getHeightAt(point.x, point.y),
        point,
        segmentLength: curveProfile.samples[index].segmentLength,
        totalLength,
      }),
    );
    const alignment = deriveVerticalAlignment(terrainSamples);
    const classified = classifyStructures(terrainSamples, alignment);
    const costs = calculateCosts(totalLength, classified.segments);
    const maximumGradeDistance = terrainSamples.find(
      ({ t }) => t === alignment.maximumGradeT,
    )?.distance ?? 0;
    const valid = alignment.maximumGradePercent
      <= ConstructionConfig.MAX_GRADE_PERCENT + 1e-9;
    const reasonCode: ConstructionReasonCode = valid ? 'ok' : 'grade';

    return {
      proposal: {
        geometry: geometryDef,
        verticalProfile: alignment.verticalProfile,
        length: totalLength,
        minimumRadius,
        maximumGradePercent: alignment.maximumGradePercent,
        maximumGradeT: alignment.maximumGradeT,
        maximumGradeDistance,
        structures: classified.structures,
        structureLengths: structureLengthsFor(classified.segments),
        costs,
        valid,
        reasonCode,
        remedy: remedyFor(reasonCode),
      },
      curveSamples: curveProfile.samples,
    };
  }
}
