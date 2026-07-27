import {
  ENDPOINT_CONNECTION_COST,
} from '../config/ConstructionConfig';
import { GameConfig } from '../config/GameConfig';
import {
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
  OPPORTUNITY_CAMERA_PADDING,
  WorldGenerationConfig,
} from '../config/WorldGeneration';
import type {
  OpportunityCorridorDef,
  PlanningSiteDef,
  StarterOpportunityDef,
  Vec2Def,
  WorldGenerationConfigDef,
} from '../config/WorldData';
import { createSeededRandom } from '../utils/SeededRandom';
import {
  ConstructionAnalyzer,
  type ConstructionProposal,
  type TerrainHeightSource,
} from './ConstructionAnalyzer';
import {
  ENGINEERED_GRADE_COMPARISON_EPSILON,
  meanAbsoluteEngineeredGrade,
} from './ConstructionGradeMetrics';
import { canonicalizeConstructionGridPoint } from './ConstructionGrid';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
} from './TrackGeometry';
import {
  MAX_STARTER_CORRIDOR_COST,
  WorldOpportunityValidator,
} from './WorldOpportunityValidator';

export interface OpportunityGenerationDiagnostics {
  attemptsEvaluated: number;
  maxSiteCandidatesEvaluated: number;
}

export type OpportunityGenerationResult =
  | {
    ok: true;
    opportunity: StarterOpportunityDef;
    diagnostics: OpportunityGenerationDiagnostics;
  }
  | {
    ok: false;
    error: {
      code: 'opportunity-exhausted';
      seed: string;
      attemptsEvaluated: number;
      maxSiteCandidatesEvaluated: number;
    };
  };

export type OpportunityAcceptancePredicate = (
  opportunity: StarterOpportunityDef,
) => boolean;

interface Candidate {
  x: number;
  y: number;
  elevation: number;
}

function canonicalConstructionPoint(
  point: Readonly<{ x: number; y: number }>,
): Vec2Def {
  const canonical = canonicalizeConstructionGridPoint(
    point.x,
    point.y,
    GameConfig.WORLD.SNAP_GRID_SIZE,
  );
  return { x: canonical.x, y: canonical.y };
}

function siteRelief(
  terrain: TerrainHeightSource,
  candidate: Candidate,
): number {
  const radius = WorldGenerationConfig.SITE_FOOTPRINT_RADIUS;
  const samples: number[] = [];
  for (const dx of [-radius, 0, radius]) {
    for (const dy of [-radius, 0, radius]) {
      samples.push(terrain.getHeightAt(candidate.x + dx, candidate.y + dy));
    }
  }
  return Math.max(...samples) - Math.min(...samples);
}

function witnessSegment(
  proposal: ConstructionProposal,
  topologyCost: 0 | typeof ENDPOINT_CONNECTION_COST,
) {
  return {
    geometry: {
      geometryVersion: 1 as const,
      p0: { ...proposal.geometry.p0 },
      p1: { ...proposal.geometry.p1 },
      p2: { ...proposal.geometry.p2 },
      p3: { ...proposal.geometry.p3 },
    },
    verticalProfile: {
      profileVersion: 1 as const,
      knots: proposal.verticalProfile.knots.map((knot) => ({ ...knot })),
    },
    structures: proposal.structures.map((interval) => ({ ...interval })),
    costs: { ...proposal.costs },
    topologyCost,
  };
}

function corridor(
  id: string,
  waypoints: Vec2Def[],
  proposals: ConstructionProposal[],
  dominantTradeoff: OpportunityCorridorDef['dominantTradeoff'],
): OpportunityCorridorDef {
  const segments = proposals.map((proposal, index) => witnessSegment(
    proposal,
    index === 0 ? 0 : ENDPOINT_CONNECTION_COST,
  ));
  const totalCost = segments.reduce(
    (sum, segment) => sum + segment.costs.total + segment.topologyCost,
    0,
  );
  return {
    id,
    waypoints: waypoints.map((waypoint) => ({ ...waypoint })),
    estimatedCost: totalCost,
    dominantTradeoff,
    feasibilityWitness: {
      witnessVersion: 1,
      segments,
      totalCost,
    },
  };
}

export class WorldOpportunityGenerator {
  private readonly analyzer: ConstructionAnalyzer;
  private readonly validator: WorldOpportunityValidator;

  constructor(
    private readonly terrain: TerrainHeightSource,
    private readonly acceptsOpportunity: OpportunityAcceptancePredicate =
      () => true,
  ) {
    this.analyzer = new ConstructionAnalyzer(terrain);
    this.validator = new WorldOpportunityValidator(terrain, this.analyzer);
  }

  generate(config: WorldGenerationConfigDef): OpportunityGenerationResult {
    let maxSiteCandidatesEvaluated = 0;
    for (let attempt = 1; attempt <= MAX_OPPORTUNITY_ATTEMPTS; attempt++) {
      const random = createSeededRandom(`${config.seed}:${attempt}`);
      const candidates = this.siteCandidates(random);
      maxSiteCandidatesEvaluated = Math.max(
        maxSiteCandidatesEvaluated,
        MAX_SITE_CANDIDATES_PER_ATTEMPT,
      );
      const opportunity = this.tryAttempt(config, attempt, candidates, random);
      if (opportunity) {
        return {
          ok: true,
          opportunity,
          diagnostics: {
            attemptsEvaluated: attempt,
            maxSiteCandidatesEvaluated,
          },
        };
      }
    }
    return {
      ok: false,
      error: {
        code: 'opportunity-exhausted',
        seed: config.seed,
        attemptsEvaluated: MAX_OPPORTUNITY_ATTEMPTS,
        maxSiteCandidatesEvaluated,
      },
    };
  }

  private siteCandidates(random: () => number): Candidate[] {
    const gridSize = WorldGenerationConfig.SITE_GRID_SIZE;
    const xLimit = WorldGenerationConfig.WORLD_HALF_WIDTH
      - WorldGenerationConfig.SITE_SEARCH_MARGIN;
    const yLimit = WorldGenerationConfig.WORLD_HALF_HEIGHT
      - WorldGenerationConfig.SITE_SEARCH_MARGIN;
    const cellWidth = xLimit * 2 / gridSize;
    const cellHeight = yLimit * 2 / gridSize;
    const usable: Candidate[] = [];
    const seenCoordinates = new Set<string>();

    for (let row = 0; row < gridSize; row++) {
      for (let column = 0; column < gridSize; column++) {
        const canonical = canonicalConstructionPoint({
          x: -xLimit + (column + 0.2 + random() * 0.6) * cellWidth,
          y: -yLimit + (row + 0.2 + random() * 0.6) * cellHeight,
        });
        const coordinateKey = `${canonical.x}:${canonical.y}`;
        if (seenCoordinates.has(coordinateKey)) continue;
        seenCoordinates.add(coordinateKey);
        const candidate = {
          ...canonical,
          elevation: 0,
        };
        candidate.elevation = this.terrain.getHeightAt(candidate.x, candidate.y);
        if (siteRelief(this.terrain, candidate) <= WorldGenerationConfig.MAX_SITE_RELIEF) {
          usable.push(candidate);
        }
      }
    }
    return usable;
  }

  private tryAttempt(
    config: WorldGenerationConfigDef,
    attempt: number,
    candidates: Candidate[],
    random: () => number,
  ): StarterOpportunityDef | null {
    if (candidates.length < 2) return null;
    const pairKeys = new Set<string>();
    for (
      let evaluation = 0;
      evaluation < WorldGenerationConfig.MAX_PAIR_EVALUATIONS_PER_ATTEMPT;
      evaluation++
    ) {
      const firstIndex = Math.floor(random() * candidates.length);
      const secondIndex = Math.floor(random() * candidates.length);
      if (firstIndex === secondIndex) continue;
      const key = firstIndex < secondIndex
        ? `${firstIndex}:${secondIndex}`
        : `${secondIndex}:${firstIndex}`;
      if (pairKeys.has(key)) continue;
      pairKeys.add(key);
      const first = candidates[firstIndex];
      const second = candidates[secondIndex];
      const opportunity = this.buildOpportunity(config, attempt, first, second);
      if (opportunity && this.acceptsOpportunity(opportunity)) {
        return opportunity;
      }
    }
    return null;
  }

  private buildOpportunity(
    config: WorldGenerationConfigDef,
    attempt: number,
    first: Candidate,
    second: Candidate,
  ): StarterOpportunityDef | null {
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    if (distance < WorldGenerationConfig.MIN_SITE_SEPARATION
      || distance > WorldGenerationConfig.MAX_SITE_SEPARATION
      || Math.abs(second.elevation - first.elevation)
        < WorldGenerationConfig.MIN_SITE_ELEVATION_DIFFERENCE) {
      return null;
    }

    const start = { x: first.x, y: first.y };
    const end = { x: second.x, y: second.y };
    const directDetail = this.analyzer.analyzeDetailed(
      deriveAutomaticCubic({ start, end }),
    );
    const directProposal = directDetail.proposal;
    if (!directProposal.valid) return null;

    const dx = (second.x - first.x) / distance;
    const dy = (second.y - first.y) / distance;
    const signedOffsets: number[] = [];
    for (const offset of WorldGenerationConfig.DETOUR_OFFSETS) {
      signedOffsets.push(offset, -offset);
    }
    for (const signedOffset of signedOffsets) {
      const waypoint = canonicalConstructionPoint({
        x: (first.x + second.x) / 2 - dy * signedOffset,
        y: (first.y + second.y) / 2 + dx * signedOffset,
      });
      if (Math.abs(waypoint.x) > WorldGenerationConfig.WORLD_HALF_WIDTH
        || Math.abs(waypoint.y) > WorldGenerationConfig.WORLD_HALF_HEIGHT) {
        continue;
      }
      const firstDetail = this.analyzer.analyzeDetailed(
        deriveAutomaticCubic({
          start,
          end: waypoint,
        }),
      );
      const firstLeg = firstDetail.proposal;
      if (!firstLeg.valid) continue;
      const secondDetail = this.analyzer.analyzeDetailed(
        deriveAutomaticCubic({
          start: firstLeg.geometry.p3,
          end,
          startOutward: deriveTrackEndpointOutward(
            firstLeg.geometry,
            'end',
          ),
        }),
      );
      const secondLeg = secondDetail.proposal;
      if (!secondLeg.valid) continue;

      const detourLength = firstLeg.length + secondLeg.length;
      const directMeanGrade = meanAbsoluteEngineeredGrade([directDetail]);
      const detourMeanGrade = meanAbsoluteEngineeredGrade([
        firstDetail,
        secondDetail,
      ]);
      if (detourLength <= directProposal.length
        || detourMeanGrade
          >= directMeanGrade - ENGINEERED_GRADE_COMPARISON_EPSILON) {
        continue;
      }

      const sites: [PlanningSiteDef, PlanningSiteDef] = [
        {
          id: 'managed-forest',
          label: 'Managed Forest',
          ...start,
          footprintRadius: WorldGenerationConfig.SITE_FOOTPRINT_RADIUS,
        },
        {
          id: 'sawmill',
          label: 'Sawmill',
          ...end,
          footprintRadius: WorldGenerationConfig.SITE_FOOTPRINT_RADIUS,
        },
      ];
      const corridors: [OpportunityCorridorDef, OpportunityCorridorDef] = [
        corridor('direct', [start, end], [directProposal], 'short-steep'),
        corridor('detour', [start, waypoint, end], [firstLeg, secondLeg], 'long-flat'),
      ];
      if (Math.min(...corridors.map((value) => value.estimatedCost))
        > MAX_STARTER_CORRIDOR_COST) {
        continue;
      }
      const surveyPoints = [start, waypoint, end];
      const xs = surveyPoints.map((point) => point.x);
      const ys = surveyPoints.map((point) => point.y);
      const minX = Math.min(
        ...xs,
        ...sites.map((site) => site.x - site.footprintRadius),
      );
      const maxX = Math.max(
        ...xs,
        ...sites.map((site) => site.x + site.footprintRadius),
      );
      const minY = Math.min(
        ...ys,
        ...sites.map((site) => site.y - site.footprintRadius),
      );
      const maxY = Math.max(
        ...ys,
        ...sites.map((site) => site.y + site.footprintRadius),
      );
      const paddedWidth = maxX - minX + OPPORTUNITY_CAMERA_PADDING * 2;
      const paddedHeight = maxY - minY + OPPORTUNITY_CAMERA_PADDING * 2;
      const widthZoom = WorldGenerationConfig.CAMERA_VIEWPORT_WIDTH
        / Math.max(1, paddedWidth);
      const heightZoom = WorldGenerationConfig.CAMERA_VIEWPORT_HEIGHT
        / Math.max(1, paddedHeight);
      const fitZoom = Math.min(widthZoom, heightZoom)
        * (1 - Number.EPSILON);
      const opportunity: StarterOpportunityDef = {
        opportunityVersion: 1,
        resolvedAttempt: attempt,
        sites,
        corridors,
        recommendedCamera: {
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
          zoom: Math.max(
            WorldGenerationConfig.CAMERA_MIN_ZOOM,
            Math.min(
              WorldGenerationConfig.CAMERA_MAX_ZOOM,
              fitZoom,
            ),
          ),
        },
      };
      if (this.validator.validate(
        opportunity,
        config,
      ).valid) {
        return opportunity;
      }
    }
    return null;
  }
}
