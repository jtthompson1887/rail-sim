import { ENDPOINT_CONNECTION_COST } from '../config/ConstructionConfig';
import { MAX_CEMENT_SUPPLY_LINK_COST } from '../config/FreightProgression';
import type {
  StarterOpportunityDef,
  Vec2Def,
} from '../config/WorldData';
import type {
  ConstructionAnalysisDetail,
  ConstructionAnalyzer,
  ConstructionProposal,
} from '../systems/ConstructionAnalyzer';
import {
  hasConstructionClearance,
  type ClearanceEndpointConnection,
  type ClearanceTrack,
} from '../systems/TrackClearance';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
} from '../systems/TrackGeometry';
import { clonePlainData } from '../utils/PlainData';
import type {
  PrefabricationExtensionWitness,
} from './PrefabricationOpportunity';

export interface CementSupplySites {
  readonly quarry: Readonly<Vec2Def>;
  readonly cementWorks: Readonly<Vec2Def>;
  readonly prefabricationPlant: Readonly<Vec2Def>;
}

export interface CementSupplyLegWitness {
  readonly proposal: ConstructionProposal;
}

export interface CementSupplyOpportunityWitness {
  readonly quarryToCement: CementSupplyLegWitness;
  readonly cementToPrefabrication: CementSupplyLegWitness;
  readonly topologyCost: number;
  readonly totalCost: number;
}

type AnalyzerPort = Pick<ConstructionAnalyzer, 'analyzeDetailed'>;
export type CementSupplyOpportunityAnalyzer = (
  sites: CementSupplySites,
) => CementSupplyOpportunityWitness | null;

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

function usableDetail(detail: ConstructionAnalysisDetail): boolean {
  return detail.proposal.valid
    && Number.isSafeInteger(detail.proposal.costs.total)
    && detail.proposal.costs.total >= 0;
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

function selectedStarterDetails(
  analyzer: AnalyzerPort,
  opportunity: StarterOpportunityDef,
): ConstructionAnalysisDetail[] | null {
  const corridor = [...opportunity.corridors].sort(
    (left, right) => left.estimatedCost - right.estimatedCost
      || left.id.localeCompare(right.id),
  )[0];
  if (!corridor || corridor.feasibilityWitness.segments.length === 0) {
    return null;
  }
  const details = corridor.feasibilityWitness.segments.map(
    ({ geometry }) => analyzer.analyzeDetailed(geometry),
  );
  return details.every(usableDetail) ? details : null;
}

/**
 * Replays the same sequential construction analysis a player will perform.
 * The returned witness is detached, deeply immutable, and is never persisted.
 */
export function createCementSupplyOpportunityAnalyzer(
  analyzer: AnalyzerPort,
  opportunity: StarterOpportunityDef,
  prefabricationExtension: PrefabricationExtensionWitness,
): CementSupplyOpportunityAnalyzer | null {
  const starterDetails = selectedStarterDetails(analyzer, opportunity);
  if (!starterDetails) return null;

  const prefabDetail = analyzer.analyzeDetailed(
    prefabricationExtension.proposal.geometry,
  );
  if (!usableDetail(prefabDetail)
    || !pointsMatch(
      prefabDetail.proposal.geometry.p3,
      prefabricationExtension.proposal.geometry.p3,
    )) {
    return null;
  }
  const protectedTracks = [
    ...starterDetails.map((detail, index) => (
      protectedTrack(`starter-${index}`, detail)
    )),
    protectedTrack('prefabrication-extension', prefabDetail),
  ];
  const cementToPrefabCache = new Map<
    string,
    Map<string, ConstructionAnalysisDetail>
  >();

  return (sites) => {
  if (!pointsMatch(
    sites.prefabricationPlant,
    prefabDetail.proposal.geometry.p3,
  )) return null;
  const quarryToCementDetail = analyzer.analyzeDetailed(
    deriveAutomaticCubic({
      start: sites.quarry,
      end: sites.cementWorks,
    }),
  );
  if (!usableDetail(quarryToCementDetail)
    || !hasConstructionClearance(
      {
        geometry: quarryToCementDetail.proposal.geometry,
        curveSamples: quarryToCementDetail.curveSamples,
      },
      protectedTracks,
      [],
    )) {
    return null;
  }

  const cementToPrefabricationGeometry = deriveAutomaticCubic({
    start: sites.cementWorks,
    end: sites.prefabricationPlant,
    startOutward: deriveTrackEndpointOutward(
      quarryToCementDetail.proposal.geometry,
      'end',
    ),
    endOutward: deriveTrackEndpointOutward(
      prefabDetail.proposal.geometry,
      'end',
    ),
  });
  const cementKey = `${sites.cementWorks.x}:${sites.cementWorks.y}`;
  let cacheForCement = cementToPrefabCache.get(cementKey);
  if (!cacheForCement) {
    cacheForCement = new Map();
    cementToPrefabCache.set(cementKey, cacheForCement);
  }
  const geometryKey = JSON.stringify(cementToPrefabricationGeometry);
  let cementToPrefabricationDetail = cacheForCement.get(geometryKey);
  if (!cementToPrefabricationDetail) {
    cementToPrefabricationDetail = analyzer.analyzeDetailed(
      cementToPrefabricationGeometry,
    );
    cacheForCement.set(geometryKey, cementToPrefabricationDetail);
  }
  const cementConnection: ClearanceEndpointConnection = {
    kind: 'endpoint-connection',
    existingTrackUUID: 'quarry-to-cement',
    existingEndpoint: 'end',
    newEndpoint: 'start',
    point: { ...sites.cementWorks },
  };
  const prefabConnection: ClearanceEndpointConnection = {
    kind: 'endpoint-connection',
    existingTrackUUID: 'prefabrication-extension',
    existingEndpoint: 'end',
    newEndpoint: 'end',
    point: { ...sites.prefabricationPlant },
  };
  if (!usableDetail(cementToPrefabricationDetail)
    || !hasConstructionClearance(
      {
        geometry: cementToPrefabricationDetail.proposal.geometry,
        curveSamples: cementToPrefabricationDetail.curveSamples,
      },
      [
        ...protectedTracks,
        protectedTrack('quarry-to-cement', quarryToCementDetail),
      ],
      [cementConnection, prefabConnection],
    )) {
    return null;
  }

  const topologyCost = ENDPOINT_CONNECTION_COST * 2;
  const totalCost = quarryToCementDetail.proposal.costs.total
    + cementToPrefabricationDetail.proposal.costs.total
    + topologyCost;
  if (!Number.isSafeInteger(totalCost)
    || totalCost > MAX_CEMENT_SUPPLY_LINK_COST) {
    return null;
  }

  return deepFreeze({
    quarryToCement: {
      proposal: clonePlainData(quarryToCementDetail.proposal),
    },
    cementToPrefabrication: {
      proposal: clonePlainData(cementToPrefabricationDetail.proposal),
    },
    topologyCost,
    totalCost,
  });
  };
}

export function analyzeCementSupplyOpportunity(
  analyzer: AnalyzerPort,
  opportunity: StarterOpportunityDef,
  prefabricationExtension: PrefabricationExtensionWitness,
  sites: CementSupplySites,
): CementSupplyOpportunityWitness | null {
  return createCementSupplyOpportunityAnalyzer(
    analyzer,
    opportunity,
    prefabricationExtension,
  )?.(sites) ?? null;
}
