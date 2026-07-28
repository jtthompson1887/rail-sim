import { ENDPOINT_CONNECTION_COST } from '../config/ConstructionConfig';
import {
  MAX_MODULE_REFERENCE_ACTIVE_TICKS,
  MAX_REGIONAL_CONSTRUCTION_LINK_COST,
  MAX_STEEL_REFERENCE_ACTIVE_TICKS,
  REFERENCE_MANOEUVRE_TICKS,
  REFERENCE_SPEED_WORLD_UNITS_PER_TICK,
} from '../config/FreightProgression';
import { WorldGenerationConfig } from '../config/WorldGeneration';
import type {
  StarterOpportunityDef,
  Vec2Def,
} from '../config/WorldData';
import { validateStarterOpportunityData } from '../config/WorldData';
import type {
  ConstructionAnalysisDetail,
  ConstructionAnalyzer,
  ConstructionProposal,
} from '../systems/ConstructionAnalyzer';
import { sampleConstructionCurve } from '../systems/ConstructionCurveSampler';
import {
  hasConstructionClearance,
  type ClearanceEndpointConnection,
  type ClearanceTrack,
} from '../systems/TrackClearance';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
  type TrackGeometryDef,
} from '../systems/TrackGeometry';
import {
  clonePlainData,
  equalPlainData,
} from '../utils/PlainData';
import type {
  CementSupplyOpportunityWitness,
} from './CementSupplyOpportunity';
import type {
  PrefabricationExtensionWitness,
} from './PrefabricationOpportunity';

export interface RegionalConstructionSites {
  readonly portInterchange: Readonly<Vec2Def>;
  readonly townConstructionMarket: Readonly<Vec2Def>;
}

export interface RegionalConstructionOpportunityWitness {
  readonly portExtension: { readonly proposal: ConstructionProposal };
  readonly townExtension: { readonly proposal: ConstructionProposal };
  readonly topologyCost: number;
  readonly totalCost: number;
  readonly steelPathLength: number;
  readonly modulePathLength: number;
  readonly steelReferenceActiveTicks: number;
  readonly moduleReferenceActiveTicks: number;
  readonly minimumSteelMargin: number;
  readonly minimumModuleMargin: number;
}

export type RegionalConstructionOpportunityAnalyzer = (
  sites: RegionalConstructionSites,
) => RegionalConstructionOpportunityWitness | null;

type AnalyzerPort = Pick<ConstructionAnalyzer, 'analyzeDetailed'>;
type StarterCorridor = StarterOpportunityDef['corridors'][number];
type StarterSegment =
  StarterCorridor['feasibilityWitness']['segments'][number];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    const record = value as Record<string, unknown>;
    Object.keys(record).forEach((key) => deepFreeze(record[key]));
    Object.freeze(value);
  }
  return value;
}

function pointsMatch(left: Readonly<Vec2Def>, right: Readonly<Vec2Def>): boolean {
  return left.x === right.x && left.y === right.y;
}

function pointIsInWorld(point: Readonly<Vec2Def>): boolean {
  return Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Math.abs(point.x) <= WorldGenerationConfig.WORLD_HALF_WIDTH
    && Math.abs(point.y) <= WorldGenerationConfig.WORLD_HALF_HEIGHT;
}

function usableDetail(
  detail: ConstructionAnalysisDetail,
  requestedGeometry: TrackGeometryDef,
): boolean {
  return detail.proposal.valid
    && Number.isSafeInteger(detail.proposal.costs.total)
    && detail.proposal.costs.total >= 0
    && equalPlainData(detail.proposal.geometry, requestedGeometry);
}

function replayDetail(
  analyzer: AnalyzerPort,
  proposal: ConstructionProposal,
): ConstructionAnalysisDetail | null {
  const detail = analyzer.analyzeDetailed(proposal.geometry);
  return usableDetail(detail, proposal.geometry)
    && equalPlainData(detail.proposal, proposal)
    ? clonePlainData(detail)
    : null;
}

function replayStarterDetail(
  analyzer: AnalyzerPort,
  segment: StarterSegment,
): ConstructionAnalysisDetail | null {
  const detail = analyzer.analyzeDetailed(segment.geometry);
  if (!usableDetail(detail, segment.geometry)
    || !equalPlainData(detail.proposal.verticalProfile, segment.verticalProfile)
    || !equalPlainData(detail.proposal.structures, segment.structures)
    || !equalPlainData(detail.proposal.costs, segment.costs)) {
    return null;
  }
  return clonePlainData(detail);
}

function protectedTrack(
  trackUUID: string,
  detail: ConstructionAnalysisDetail,
): ClearanceTrack {
  return {
    trackUUID,
    geometry: detail.proposal.geometry,
    curveSamples: detail.curveSamples,
  };
}

function exactWitnessTotal(
  constructionCosts: readonly number[],
  topologyCost: number,
): number | null {
  const total = constructionCosts.reduce(
    (sum, constructionCost) => sum + constructionCost,
    topologyCost,
  );
  return Number.isSafeInteger(total) ? total : null;
}

function samplePathLength(
  geometries: readonly TrackGeometryDef[],
): number | null {
  let length = 0;
  for (const geometry of geometries) {
    const sampled = sampleConstructionCurve(geometry);
    if (!sampled.ok) return null;
    length += sampled.length;
  }
  return Number.isFinite(length) && length >= 0 ? length : null;
}

function referenceActiveTicks(pathLength: number): number {
  return Math.ceil(pathLength / REFERENCE_SPEED_WORLD_UNITS_PER_TICK)
    + REFERENCE_MANOEUVRE_TICKS;
}

/**
 * Replays the complete guaranteed spine and proves both outer extensions.
 * The detached witness is deterministic, deeply immutable, and never persisted.
 */
export function createRegionalConstructionOpportunityAnalyzer(
  analyzer: Pick<ConstructionAnalyzer, 'analyzeDetailed'>,
  opportunity: StarterOpportunityDef,
  prefabricationExtension: PrefabricationExtensionWitness,
  cementSupply: CementSupplyOpportunityWitness,
): RegionalConstructionOpportunityAnalyzer | null {
  if (!validateStarterOpportunityData(opportunity)
    || opportunity.sites[0].id !== 'managed-forest'
    || opportunity.sites[0].label !== 'Managed Forest'
    || opportunity.sites[1].id !== 'sawmill'
    || opportunity.sites[1].label !== 'Sawmill') {
    return null;
  }
  const corridor = [...opportunity.corridors].sort(
    (left, right) => left.estimatedCost - right.estimatedCost
      || left.id.localeCompare(right.id),
  )[0];
  const starterSegments = corridor?.feasibilityWitness.segments;
  const forest = opportunity.sites[0];
  const sawmill = opportunity.sites[1];
  if (!starterSegments?.length || !forest || !sawmill) return null;

  const starterDetails: ConstructionAnalysisDetail[] = [];
  for (const segment of starterSegments) {
    const detail = replayStarterDetail(analyzer, segment);
    if (!detail) return null;
    starterDetails.push(detail);
  }
  if (!pointsMatch(starterDetails[0].proposal.geometry.p0, forest)
    || !pointsMatch(
      starterDetails[starterDetails.length - 1].proposal.geometry.p3,
      sawmill,
    )
    || starterDetails.some((detail, index) => (
      index > 0 && !pointsMatch(
        starterDetails[index - 1].proposal.geometry.p3,
        detail.proposal.geometry.p0,
      )
    ))) {
    return null;
  }

  const prefabDetail = replayDetail(
    analyzer,
    prefabricationExtension.proposal,
  );
  const quarryToCementDetail = replayDetail(
    analyzer,
    cementSupply.quarryToCement.proposal,
  );
  const cementToPrefabricationDetail = replayDetail(
    analyzer,
    cementSupply.cementToPrefabrication.proposal,
  );
  if (!prefabDetail
    || !quarryToCementDetail
    || !cementToPrefabricationDetail
    || prefabricationExtension.topologyCost !== ENDPOINT_CONNECTION_COST
    || prefabricationExtension.totalCost !== exactWitnessTotal(
      [prefabricationExtension.proposal.costs.total],
      prefabricationExtension.topologyCost,
    )
    || cementSupply.topologyCost !== ENDPOINT_CONNECTION_COST * 2
    || cementSupply.totalCost !== exactWitnessTotal(
      [
        cementSupply.quarryToCement.proposal.costs.total,
        cementSupply.cementToPrefabrication.proposal.costs.total,
      ],
      cementSupply.topologyCost,
    )) {
    return null;
  }

  const firstStarterDetail = starterDetails[0];
  const lastStarterDetail = starterDetails[starterDetails.length - 1];
  if (!pointsMatch(
    lastStarterDetail.proposal.geometry.p3,
    prefabDetail.proposal.geometry.p0,
  )
    || !pointsMatch(
      quarryToCementDetail.proposal.geometry.p3,
      cementToPrefabricationDetail.proposal.geometry.p0,
    )
    || !pointsMatch(
      cementToPrefabricationDetail.proposal.geometry.p3,
      prefabDetail.proposal.geometry.p3,
    )) {
    return null;
  }

  const priorProtectedTracks = [
    ...starterDetails.map((detail, index) => (
      protectedTrack(`starter-${index}`, detail)
    )),
    protectedTrack('prefabrication-extension', prefabDetail),
    protectedTrack('quarry-to-cement', quarryToCementDetail),
    protectedTrack(
      'cement-to-prefabrication',
      cementToPrefabricationDetail,
    ),
  ];

  return (sites) => {
    if (!pointIsInWorld(sites.portInterchange)
      || !pointIsInWorld(sites.townConstructionMarket)) {
      return null;
    }
    const portGeometry = deriveAutomaticCubic({
      start: quarryToCementDetail.proposal.geometry.p0,
      end: sites.portInterchange,
      startOutward: deriveTrackEndpointOutward(
        quarryToCementDetail.proposal.geometry,
        'start',
      ),
    });
    const analyzedPortDetail = analyzer.analyzeDetailed(portGeometry);
    if (!usableDetail(analyzedPortDetail, portGeometry)) return null;
    const portDetail = clonePlainData(analyzedPortDetail);
    const quarryConnection: ClearanceEndpointConnection = {
      kind: 'endpoint-connection',
      existingTrackUUID: 'quarry-to-cement',
      existingEndpoint: 'start',
      newEndpoint: 'start',
      point: { ...quarryToCementDetail.proposal.geometry.p0 },
    };
    if (!hasConstructionClearance(
      {
        geometry: portDetail.proposal.geometry,
        curveSamples: portDetail.curveSamples,
      },
      priorProtectedTracks,
      [quarryConnection],
    )) {
      return null;
    }

    const townGeometry = deriveAutomaticCubic({
      start: firstStarterDetail.proposal.geometry.p0,
      end: sites.townConstructionMarket,
      startOutward: deriveTrackEndpointOutward(
        firstStarterDetail.proposal.geometry,
        'start',
      ),
    });
    const analyzedTownDetail = analyzer.analyzeDetailed(townGeometry);
    if (!usableDetail(analyzedTownDetail, townGeometry)) return null;
    const townDetail = clonePlainData(analyzedTownDetail);
    const forestConnection: ClearanceEndpointConnection = {
      kind: 'endpoint-connection',
      existingTrackUUID: 'starter-0',
      existingEndpoint: 'start',
      newEndpoint: 'start',
      point: { ...firstStarterDetail.proposal.geometry.p0 },
    };
    if (!hasConstructionClearance(
      {
        geometry: townDetail.proposal.geometry,
        curveSamples: townDetail.curveSamples,
      },
      [
        ...priorProtectedTracks,
        protectedTrack('port-extension', portDetail),
      ],
      [forestConnection],
    )) {
      return null;
    }

    const topologyCost = ENDPOINT_CONNECTION_COST * 2;
    const totalCost = exactWitnessTotal(
      [
        portDetail.proposal.costs.total,
        townDetail.proposal.costs.total,
      ],
      topologyCost,
    );
    if (totalCost === null
      || totalCost > MAX_REGIONAL_CONSTRUCTION_LINK_COST) {
      return null;
    }

    const steelPathLength = samplePathLength([
      portDetail.proposal.geometry,
      quarryToCementDetail.proposal.geometry,
      cementToPrefabricationDetail.proposal.geometry,
    ]);
    const modulePathLength = samplePathLength([
      prefabDetail.proposal.geometry,
      ...starterDetails
        .map(({ proposal }) => proposal.geometry)
        .reverse(),
      townDetail.proposal.geometry,
    ]);
    if (steelPathLength === null || modulePathLength === null) return null;

    const steelReferenceActiveTicks = referenceActiveTicks(steelPathLength);
    const moduleReferenceActiveTicks = referenceActiveTicks(modulePathLength);
    const minimumSteelMargin = 31_990
      - steelReferenceActiveTicks * 20;
    const minimumModuleMargin = 21_216
      - moduleReferenceActiveTicks * 20;
    if (!Number.isSafeInteger(steelReferenceActiveTicks)
      || !Number.isSafeInteger(moduleReferenceActiveTicks)
      || steelReferenceActiveTicks > MAX_STEEL_REFERENCE_ACTIVE_TICKS
      || moduleReferenceActiveTicks > MAX_MODULE_REFERENCE_ACTIVE_TICKS
      || minimumSteelMargin <= 0
      || minimumModuleMargin <= 0) {
      return null;
    }

    return deepFreeze(clonePlainData({
      portExtension: {
        proposal: portDetail.proposal,
      },
      townExtension: {
        proposal: townDetail.proposal,
      },
      topologyCost,
      totalCost,
      steelPathLength,
      modulePathLength,
      steelReferenceActiveTicks,
      moduleReferenceActiveTicks,
      minimumSteelMargin,
      minimumModuleMargin,
    }));
  };
}
