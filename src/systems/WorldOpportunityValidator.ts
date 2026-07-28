import { ENDPOINT_CONNECTION_COST } from '../config/ConstructionConfig';
import { MAX_STARTER_CORRIDOR_COST } from '../config/FreightProgression';
import {
  MAX_OPPORTUNITY_ATTEMPTS,
  WorldGenerationConfig,
} from '../config/WorldGeneration';
import type {
  OpportunityCorridorDef,
  StarterOpportunityDef,
  WorldGenerationConfigDef,
} from '../config/WorldData';
import { validateStarterOpportunityData } from '../config/WorldData';
import {
  ConstructionAnalyzer,
  type ConstructionAnalysisDetail,
  type TerrainHeightSource,
} from './ConstructionAnalyzer';
import {
  ENGINEERED_GRADE_COMPARISON_EPSILON,
  meanAbsoluteEngineeredGrade,
} from './ConstructionGradeMetrics';

export { MAX_STARTER_CORRIDOR_COST } from '../config/FreightProgression';

export type OpportunityValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

function invalid(reason: string): OpportunityValidationResult {
  return { valid: false, reason };
}

function siteRelief(
  terrain: TerrainHeightSource,
  x: number,
  y: number,
  radius: number,
): number | null {
  const samples: number[] = [];
  for (const dx of [-radius, 0, radius]) {
    for (const dy of [-radius, 0, radius]) {
      const sample = terrain.getHeightAt(x + dx, y + dy);
      if (!Number.isFinite(sample)) return null;
      samples.push(sample);
    }
  }
  return Math.max(...samples) - Math.min(...samples);
}

export function validateGeneratedOpportunityData(
  value: unknown,
): value is StarterOpportunityDef {
  return validateStarterOpportunityData(value)
    && value.sites[0].id === 'managed-forest'
    && value.sites[0].label === 'Managed Forest'
    && value.sites[1].id === 'sawmill'
    && value.sites[1].label === 'Sawmill';
}

function corridorMetrics(
  corridor: OpportunityCorridorDef,
  analyzer: ConstructionAnalyzer,
): { length: number; meanAbsoluteGrade: number } | null {
  if (corridor.feasibilityWitness.segments.length !== corridor.waypoints.length - 1) {
    return null;
  }
  let length = 0;
  const details: ConstructionAnalysisDetail[] = [];
  for (
    let index = 0;
    index < corridor.feasibilityWitness.segments.length;
    index++
  ) {
    const segment = corridor.feasibilityWitness.segments[index];
    if (JSON.stringify(segment.geometry.p0) !== JSON.stringify(corridor.waypoints[index])
      || JSON.stringify(segment.geometry.p3)
        !== JSON.stringify(corridor.waypoints[index + 1])) {
      return null;
    }
    if (index > 0) {
      const previous = corridor.feasibilityWitness.segments[index - 1].geometry;
      const incoming = {
        x: previous.p3.x - previous.p2.x,
        y: previous.p3.y - previous.p2.y,
      };
      const outgoing = {
        x: segment.geometry.p1.x - segment.geometry.p0.x,
        y: segment.geometry.p1.y - segment.geometry.p0.y,
      };
      const lengths = Math.hypot(incoming.x, incoming.y)
        * Math.hypot(outgoing.x, outgoing.y);
      const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
      const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
      if (lengths === 0 || Math.abs(cross) > lengths * 1e-10 || dot <= 0) {
        return null;
      }
    }
    const expectedTopologyCost = index === 0 ? 0 : ENDPOINT_CONNECTION_COST;
    if (segment.topologyCost !== expectedTopologyCost) return null;
    const detail = analyzer.analyzeDetailed(segment.geometry);
    const proposal = detail.proposal;
    if (!proposal.valid
      || JSON.stringify(proposal.verticalProfile) !== JSON.stringify(segment.verticalProfile)
      || JSON.stringify(proposal.structures) !== JSON.stringify(segment.structures)
      || JSON.stringify(proposal.costs) !== JSON.stringify(segment.costs)) {
      return null;
    }
    length += proposal.length;
    details.push(detail);
  }
  if (length <= 0) return null;
  return {
    length,
    meanAbsoluteGrade: meanAbsoluteEngineeredGrade(details),
  };
}

export class WorldOpportunityValidator {
  constructor(
    private readonly terrain: TerrainHeightSource,
    private readonly analyzer = new ConstructionAnalyzer(terrain),
  ) {}

  validate(
    opportunity: StarterOpportunityDef,
    generationConfig: WorldGenerationConfigDef,
  ): OpportunityValidationResult {
    if (generationConfig.constructionDifficultyId !== 'standard'
      || opportunity.opportunityVersion !== 1
      || !Number.isInteger(opportunity.resolvedAttempt)
      || opportunity.resolvedAttempt < 1
      || opportunity.resolvedAttempt > MAX_OPPORTUNITY_ATTEMPTS
      || opportunity.sites.length !== 2
      || opportunity.sites[0].id !== 'managed-forest'
      || opportunity.sites[0].label !== 'Managed Forest'
      || opportunity.sites[1].id !== 'sawmill'
      || opportunity.sites[1].label !== 'Sawmill'
      || opportunity.corridors.length !== 2
      || !Number.isFinite(opportunity.recommendedCamera.x)
      || !Number.isFinite(opportunity.recommendedCamera.y)
      || !Number.isFinite(opportunity.recommendedCamera.zoom)
      || opportunity.recommendedCamera.zoom <= 0) {
      return invalid('invalid opportunity header');
    }

    for (const site of opportunity.sites) {
      const relief = siteRelief(
        this.terrain,
        site.x,
        site.y,
        site.footprintRadius,
      );
      if (!Number.isFinite(site.x)
        || !Number.isFinite(site.y)
        || site.footprintRadius !== WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
        || Math.abs(site.x) + site.footprintRadius > WorldGenerationConfig.WORLD_HALF_WIDTH
        || Math.abs(site.y) + site.footprintRadius > WorldGenerationConfig.WORLD_HALF_HEIGHT
        || relief === null
        || relief > WorldGenerationConfig.MAX_SITE_RELIEF) {
        return invalid('unusable planning site');
      }
    }
    const siteSeparation = Math.hypot(
      opportunity.sites[1].x - opportunity.sites[0].x,
      opportunity.sites[1].y - opportunity.sites[0].y,
    );
    if (siteSeparation < WorldGenerationConfig.MIN_SITE_SEPARATION
      || siteSeparation > WorldGenerationConfig.MAX_SITE_SEPARATION) {
      return invalid('planning sites are not sufficiently separated');
    }

    const metrics = opportunity.corridors.map((corridor) => {
      if (corridor.waypoints.some((waypoint) => (
        Math.abs(waypoint.x) > WorldGenerationConfig.WORLD_HALF_WIDTH
        || Math.abs(waypoint.y) > WorldGenerationConfig.WORLD_HALF_HEIGHT
      ))
        || JSON.stringify(corridor.waypoints[0])
          !== JSON.stringify({
            x: opportunity.sites[0].x,
            y: opportunity.sites[0].y,
          })
        || JSON.stringify(corridor.waypoints[corridor.waypoints.length - 1])
          !== JSON.stringify({
            x: opportunity.sites[1].x,
            y: opportunity.sites[1].y,
          })) {
        return null;
      }
      const expectedTotal = corridor.feasibilityWitness.segments.reduce(
        (sum, segment) => sum + segment.costs.total + segment.topologyCost,
        0,
      );
      if (corridor.feasibilityWitness.witnessVersion !== 1
        || corridor.feasibilityWitness.totalCost !== expectedTotal
        || corridor.estimatedCost !== expectedTotal) {
        return null;
      }
      return corridorMetrics(corridor, this.analyzer);
    });
    if (metrics.some((value) => value === null)) {
      return invalid('invalid feasibility witness');
    }
    if (JSON.stringify(opportunity.corridors[0].waypoints)
      === JSON.stringify(opportunity.corridors[1].waypoints)) {
      return invalid('corridors are not spatially distinct');
    }

    const shortIndex = opportunity.corridors.findIndex(
      (corridor) => corridor.dominantTradeoff === 'short-steep',
    );
    const flatIndex = opportunity.corridors.findIndex(
      (corridor) => corridor.dominantTradeoff === 'long-flat',
    );
    if (shortIndex < 0 || flatIndex < 0 || shortIndex === flatIndex) {
      return invalid('unsupported trade-off labels');
    }
    if (opportunity.corridors[0].estimatedCost
      === opportunity.corridors[1].estimatedCost) {
      return invalid('corridors do not expose a cost trade-off');
    }
    const short = metrics[shortIndex]!;
    const flat = metrics[flatIndex]!;
    if (short.length >= flat.length
      || short.meanAbsoluteGrade
        <= flat.meanAbsoluteGrade + ENGINEERED_GRADE_COMPARISON_EPSILON) {
      return invalid('trade-off labels do not match engineering');
    }

    const cheaper = Math.min(...opportunity.corridors.map(
      (corridor) => corridor.estimatedCost,
    ));
    if (cheaper > MAX_STARTER_CORRIDOR_COST) {
      return invalid('opportunity breaches starter reserve');
    }
    return { valid: true };
  }
}
