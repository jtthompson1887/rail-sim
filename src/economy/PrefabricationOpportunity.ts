import { ENDPOINT_CONNECTION_COST } from '../config/ConstructionConfig';
import { MAX_PREFAB_EXTENSION_WITNESS_COST } from '../config/FreightProgression';
import type {
  StarterOpportunityDef,
  Vec2Def,
} from '../config/WorldData';
import type {
  ConstructionAnalyzer,
  ConstructionProposal,
} from '../systems/ConstructionAnalyzer';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
} from '../systems/TrackGeometry';

export interface PrefabricationExtensionWitness {
  readonly proposal: ConstructionProposal;
  readonly topologyCost: typeof ENDPOINT_CONNECTION_COST;
  readonly totalCost: number;
}

export interface PrefabricationExtensionStart {
  readonly point: Readonly<Vec2Def>;
  readonly outward: Readonly<Vec2Def>;
}

export function resolvePrefabricationExtensionStart(
  opportunity: StarterOpportunityDef,
): PrefabricationExtensionStart | null {
  const corridor = [...opportunity.corridors].sort(
    (left, right) => left.estimatedCost - right.estimatedCost
      || left.id.localeCompare(right.id),
  )[0];
  const terminal = corridor?.feasibilityWitness.segments[
    corridor.feasibilityWitness.segments.length - 1
  ]?.geometry;
  const sawmill = opportunity.sites[1];
  if (!terminal
    || !sawmill
    || terminal.p3.x !== sawmill.x
    || terminal.p3.y !== sawmill.y) {
    return null;
  }
  return {
    point: { ...terminal.p3 },
    outward: deriveTrackEndpointOutward(terminal, 'end'),
  };
}

export function analyzePrefabricationExtension(
  analyzer: Pick<ConstructionAnalyzer, 'analyze'>,
  start: PrefabricationExtensionStart,
  prefabricationPlant: Readonly<Vec2Def>,
): PrefabricationExtensionWitness | null {
  const proposal = analyzer.analyze(deriveAutomaticCubic({
    start: start.point,
    end: prefabricationPlant,
    startOutward: start.outward,
  }));
  const totalCost = proposal.costs.total + ENDPOINT_CONNECTION_COST;
  if (!proposal.valid
    || !Number.isSafeInteger(proposal.costs.total)
    || proposal.costs.total < 0
    || !Number.isSafeInteger(totalCost)
    || totalCost > MAX_PREFAB_EXTENSION_WITNESS_COST) {
    return null;
  }
  return {
    proposal,
    topologyCost: ENDPOINT_CONNECTION_COST,
    totalCost,
  };
}
