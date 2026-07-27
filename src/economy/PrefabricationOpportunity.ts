import { ENDPOINT_CONNECTION_COST } from '../config/ConstructionConfig';
import { MAX_PREFAB_EXTENSION_WITNESS_COST } from '../config/FreightProgression';
import type { Vec2Def } from '../config/WorldData';
import type {
  ConstructionAnalyzer,
  ConstructionProposal,
} from '../systems/ConstructionAnalyzer';
import { deriveAutomaticCubic } from '../systems/TrackGeometry';

export interface PrefabricationExtensionWitness {
  readonly proposal: ConstructionProposal;
  readonly topologyCost: typeof ENDPOINT_CONNECTION_COST;
  readonly totalCost: number;
}

export function analyzePrefabricationExtension(
  analyzer: Pick<ConstructionAnalyzer, 'analyze'>,
  sawmill: Readonly<Vec2Def>,
  prefabricationPlant: Readonly<Vec2Def>,
): PrefabricationExtensionWitness | null {
  const proposal = analyzer.analyze(deriveAutomaticCubic({
    start: sawmill,
    end: prefabricationPlant,
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
