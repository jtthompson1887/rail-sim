import {
  MAX_ECONOMY_SITE_CANDIDATES,
  WorldGenerationConfig,
} from '../config/WorldGeneration';
import { ENDPOINT_CONNECTION_COST } from '../config/ConstructionConfig';
import {
  MAX_CEMENT_SUPPLY_LINK_COST,
  MAX_STARTER_CORRIDOR_COST,
} from '../config/FreightProgression';
import type {
  EconomyStateDef,
  StarterOpportunityDef,
  WorldGenerationConfigDef,
} from '../config/WorldData';
import {
  validateEconomyStateData,
  validateStarterOpportunityData,
} from '../config/WorldData';
import type {
  FacilityDefinition,
  FacilityEconomyDef,
  InventorySlotDef,
} from './EconomyData';
import {
  INITIAL_FACILITY_DEFINITIONS,
  INITIAL_PRODUCTS,
} from './InitialEconomyContent';
import {
  ConstructionAnalyzer,
  type ConstructionAnalysisDetail,
  type ConstructionAnalysisOptions,
  type TerrainHeightSource,
} from '../systems/ConstructionAnalyzer';
import { createSeededRandom } from '../utils/SeededRandom';
import {
  analyzePrefabricationExtension,
  resolvePrefabricationExtensionStart,
} from './PrefabricationOpportunity';
import { canonicalizeConstructionGridPoint } from '../systems/ConstructionGrid';
import { GameConfig } from '../config/GameConfig';
import {
  analyzeCementSupplyOpportunity,
  createCementSupplyOpportunityAnalyzer,
  type CementSupplyOpportunityAnalyzer,
} from './CementSupplyOpportunity';
import { deriveTrackEndpointOutward } from '../systems/TrackGeometry';
import type { TrackGeometryDef } from '../systems/TrackGeometry';
import type {
  PrefabricationExtensionWitness,
} from './PrefabricationOpportunity';

export interface EconomyGenerationDiagnostics {
  candidatesEvaluated: number;
  prefabAnalyses: number;
  mineralPairAnalyses: number;
}

export type EconomyGenerationResult =
  | {
    ok: true;
    economy: EconomyStateDef;
    diagnostics: EconomyGenerationDiagnostics;
  }
  | {
    ok: false;
    error: {
      code: 'economy-exhausted';
      seed: string;
      candidatesEvaluated: number;
      prefabAnalyses: number;
      mineralPairAnalyses: number;
      facilitiesPlaced: number;
    };
  };

interface FacilityPosition {
  x: number;
  y: number;
}

const CANDIDATE_GRID_SIZE = 16;
const CANDIDATE_SEARCH_HALF_SPAN = 3_200;
export const MAX_CEMENT_SUPPLY_PAIR_ANALYSES = 256;

function footprintRelief(
  terrain: TerrainHeightSource,
  position: FacilityPosition,
): number | null {
  const radius = WorldGenerationConfig.SITE_FOOTPRINT_RADIUS;
  const heights: number[] = [];
  for (const dx of [-radius, 0, radius]) {
    for (const dy of [-radius, 0, radius]) {
      const height = terrain.getHeightAt(position.x + dx, position.y + dy);
      if (!Number.isFinite(height)) return null;
      heights.push(height);
    }
  }
  return Math.max(...heights) - Math.min(...heights);
}

function instantiateFacility(
  definition: FacilityDefinition,
  position: FacilityPosition,
): FacilityEconomyDef {
  const inventories: Record<string, InventorySlotDef> = {};
  definition.inventory.forEach((template) => {
    inventories[template.productId] = {
      productId: template.productId,
      quantity: template.initialQuantity,
      reservedQuantity: 0,
      capacity: template.capacity,
      recentInflow: 0,
      recentOutflow: 0,
      targetStock: template.targetStock,
    };
  });
  return {
    id: definition.id,
    definitionId: definition.id,
    name: definition.displayName,
    x: position.x,
    y: position.y,
    railAccess: {
      x: position.x,
      y: position.y,
      radius: WorldGenerationConfig.FACILITY_RAIL_ACCESS_RADIUS,
    },
    inventories,
    activeRecipeId: definition.recipeIds[0] ?? null,
    recipeProgressTicks: 0,
  };
}

export function validateGeneratedEconomy(
  value: unknown,
  opportunity: unknown,
  terrain: TerrainHeightSource,
): value is EconomyStateDef {
  if (!validateStarterOpportunityData(opportunity)
    || opportunity.sites[0].id !== 'managed-forest'
    || opportunity.sites[0].label !== 'Managed Forest'
    || opportunity.sites[1].id !== 'sawmill'
    || opportunity.sites[1].label !== 'Sawmill'
    || !validateEconomyStateData(value)
    || value.tick !== 0
    || value.facilities.length !== INITIAL_FACILITY_DEFINITIONS.length
    || value.market.constructionIndexBps !== 10_000) {
    return false;
  }

  for (let index = 0; index < INITIAL_FACILITY_DEFINITIONS.length; index++) {
    const definition = INITIAL_FACILITY_DEFINITIONS[index];
    const facility = value.facilities[index];
    if (facility.id !== definition.id
      || facility.definitionId !== definition.id
      || facility.name !== definition.displayName
      || facility.railAccess.x !== facility.x
      || facility.railAccess.y !== facility.y
      || facility.railAccess.radius
        !== WorldGenerationConfig.FACILITY_RAIL_ACCESS_RADIUS
      || Math.abs(facility.x) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
        > WorldGenerationConfig.WORLD_HALF_WIDTH
      || Math.abs(facility.y) + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
        > WorldGenerationConfig.WORLD_HALF_HEIGHT
      || facility.activeRecipeId !== (definition.recipeIds[0] ?? null)
      || facility.recipeProgressTicks !== 0) {
      return false;
    }
    const relief = footprintRelief(terrain, facility);
    if (relief === null || relief > WorldGenerationConfig.MAX_SITE_RELIEF) {
      return false;
    }
    for (const template of definition.inventory) {
      const slot = facility.inventories[template.productId];
      if (slot.quantity !== template.initialQuantity
        || slot.reservedQuantity !== 0
        || slot.recentInflow !== 0
        || slot.recentOutflow !== 0) {
        return false;
      }
    }
    for (
      let otherIndex = index + 1;
      otherIndex < value.facilities.length;
      otherIndex++
    ) {
      const other = value.facilities[otherIndex];
      if (Math.hypot(other.x - facility.x, other.y - facility.y)
        < WorldGenerationConfig.MIN_FACILITY_SEPARATION) {
        return false;
      }
    }
  }

  const forest = value.facilities[0];
  const sawmill = value.facilities[1];
  const prefabricationPlant = value.facilities.find(
    ({ id }) => id === 'prefabrication-plant',
  );
  const quarry = value.facilities.find(({ id }) => id === 'quarry');
  const cementWorks = value.facilities.find(
    ({ id }) => id === 'cement-works',
  );
  const extensionStart = resolvePrefabricationExtensionStart(opportunity);
  const prefabWitness = prefabricationPlant && extensionStart
    ? analyzePrefabricationExtension(
      new ConstructionAnalyzer(terrain),
      extensionStart,
      prefabricationPlant.railAccess,
    )
    : null;
  return forest.x === opportunity.sites[0].x
    && forest.y === opportunity.sites[0].y
    && sawmill.x === opportunity.sites[1].x
    && sawmill.y === opportunity.sites[1].y
    && prefabricationPlant !== undefined
    && quarry !== undefined
    && cementWorks !== undefined
    && extensionStart !== null
    && Math.min(...opportunity.corridors.map(
      (corridor) => corridor.estimatedCost,
    )) <= MAX_STARTER_CORRIDOR_COST
    && prefabWitness !== null
    && analyzeCementSupplyOpportunity(
      new ConstructionAnalyzer(terrain),
      opportunity,
      prefabWitness,
      {
        quarry: quarry.railAccess,
        cementWorks: cementWorks.railAccess,
        prefabricationPlant: prefabricationPlant.railAccess,
      },
    ) !== null;
}

export class WorldEconomyGenerator {
  constructor(private readonly terrain: TerrainHeightSource) {}

  generate(
    config: WorldGenerationConfigDef,
    opportunity: StarterOpportunityDef,
  ): EconomyGenerationResult {
    const siteRandom = createSeededRandom(`${config.seed}:economy:sites`);
    const marketRandom = createSeededRandom(`${config.seed}:economy:market`);
    const extensionStart = resolvePrefabricationExtensionStart(opportunity);
    if (!extensionStart) {
      return {
        ok: false,
        error: {
          code: 'economy-exhausted',
          seed: config.seed,
          candidatesEvaluated: 0,
          prefabAnalyses: 0,
          mineralPairAnalyses: 0,
          facilitiesPlaced: 0,
        },
      };
    }
    const fixedPositions: FacilityPosition[] = opportunity.sites.map(
      ({ x, y }) => ({ x, y }),
    );
    const positionByDefinition = new Map<string, FacilityPosition>([
      ['managed-forest', fixedPositions[0]],
      ['sawmill', fixedPositions[1]],
    ]);
    const canonicalCandidates = new Set<string>();
    const candidates: FacilityPosition[] = [];
    const xLimit = WorldGenerationConfig.WORLD_HALF_WIDTH
      - WorldGenerationConfig.SITE_SEARCH_MARGIN;
    const yLimit = WorldGenerationConfig.WORLD_HALF_HEIGHT
      - WorldGenerationConfig.SITE_SEARCH_MARGIN;
    const searchMinX = Math.max(
      -xLimit,
      fixedPositions[1].x - CANDIDATE_SEARCH_HALF_SPAN,
    );
    const searchMaxX = Math.min(
      xLimit,
      fixedPositions[1].x + CANDIDATE_SEARCH_HALF_SPAN,
    );
    const searchMinY = Math.max(
      -yLimit,
      fixedPositions[1].y - CANDIDATE_SEARCH_HALF_SPAN,
    );
    const searchMaxY = Math.min(
      yLimit,
      fixedPositions[1].y + CANDIDATE_SEARCH_HALF_SPAN,
    );
    const cellWidth = (searchMaxX - searchMinX) / CANDIDATE_GRID_SIZE;
    const cellHeight = (searchMaxY - searchMinY) / CANDIDATE_GRID_SIZE;
    for (let row = 0; row < CANDIDATE_GRID_SIZE; row++) {
      for (let column = 0; column < CANDIDATE_GRID_SIZE; column++) {
        const rawCandidate = {
          x: searchMinX
            + (column + 0.2 + siteRandom() * 0.6) * cellWidth,
          y: searchMinY
            + (row + 0.2 + siteRandom() * 0.6) * cellHeight,
        };
        const canonical = canonicalizeConstructionGridPoint(
          rawCandidate.x,
          rawCandidate.y,
          GameConfig.WORLD.SNAP_GRID_SIZE,
        );
        const candidate = { x: canonical.x, y: canonical.y };
        const candidateKey = `${candidate.x}:${candidate.y}`;
        if (canonicalCandidates.has(candidateKey)) continue;
        canonicalCandidates.add(candidateKey);
        const relief = footprintRelief(this.terrain, candidate);
        if (relief === null
          || relief > WorldGenerationConfig.MAX_SITE_RELIEF) {
          continue;
        }
        candidates.push(candidate);
      }
    }
    const productionAnalyzer = new ConstructionAnalyzer(this.terrain);
    const analysisCache = new Map<string, ConstructionAnalysisDetail>();
    const analyzeDetailed = (
      geometry: TrackGeometryDef,
      options: ConstructionAnalysisOptions = {},
    ): ConstructionAnalysisDetail => {
      const key = JSON.stringify([geometry, options]);
      const cached = analysisCache.get(key);
      if (cached) return cached;
      const detail = productionAnalyzer.analyzeDetailed(geometry, options);
      analysisCache.set(key, detail);
      return detail;
    };
    const analyzer = {
      analyzeDetailed,
      analyze(
        geometry: TrackGeometryDef,
        options: ConstructionAnalysisOptions = {},
      ) {
        return analyzeDetailed(geometry, options).proposal;
      },
    };

    const isSeparated = (
      candidate: FacilityPosition,
      positions: readonly FacilityPosition[],
    ): boolean => positions.every((position) => Math.hypot(
      candidate.x - position.x,
      candidate.y - position.y,
    ) >= WorldGenerationConfig.MIN_FACILITY_SEPARATION);

    interface MineralPairCandidate {
      quarry: FacilityPosition;
      cementWorks: FacilityPosition;
      score: number;
    }
    interface PrefabOption {
      position: FacilityPosition;
      witness: PrefabricationExtensionWitness;
      pairs: MineralPairCandidate[];
      analyze: CementSupplyOpportunityAnalyzer | null | undefined;
    }
    let prefabAnalyses = 0;
    const buildPrefabOption = (
      prefabCandidate: FacilityPosition,
    ): PrefabOption | null => {
      if (!isSeparated(prefabCandidate, fixedPositions)) return null;
      prefabAnalyses += 1;
      const witness = analyzePrefabricationExtension(
        analyzer,
        extensionStart,
        prefabCandidate,
      );
      if (!witness) return null;
      const mineralCandidates = candidates.filter(
        (candidate) => isSeparated(
          candidate,
          [...fixedPositions, prefabCandidate],
        ),
      );
      const prefabOutward = deriveTrackEndpointOutward(
        witness.proposal.geometry,
        'end',
      );
      const pairs: MineralPairCandidate[] = [];
      for (const cementCandidate of mineralCandidates) {
        const cementFromPrefab = {
          x: cementCandidate.x - prefabCandidate.x,
          y: cementCandidate.y - prefabCandidate.y,
        };
        if (cementFromPrefab.x * prefabOutward.x
          + cementFromPrefab.y * prefabOutward.y <= 0) continue;
        for (const quarryCandidate of mineralCandidates) {
          if (!isSeparated(quarryCandidate, [cementCandidate])) continue;
          const firstDirection = {
            x: cementCandidate.x - quarryCandidate.x,
            y: cementCandidate.y - quarryCandidate.y,
          };
          const secondDirection = {
            x: prefabCandidate.x - cementCandidate.x,
            y: prefabCandidate.y - cementCandidate.y,
          };
          const firstDistance = Math.hypot(
            firstDirection.x,
            firstDirection.y,
          );
          const secondDistance = Math.hypot(
            secondDirection.x,
            secondDirection.y,
          );
          const alignment = (
            firstDirection.x * secondDirection.x
              + firstDirection.y * secondDirection.y
          ) / (firstDistance * secondDistance);
          if (alignment <= 0) continue;
          const minimumEngineeringCost = (
            firstDistance + secondDistance
          ) * 10 + ENDPOINT_CONNECTION_COST * 2;
          if (minimumEngineeringCost > MAX_CEMENT_SUPPLY_LINK_COST) continue;
          pairs.push({
            quarry: quarryCandidate,
            cementWorks: cementCandidate,
            score: minimumEngineeringCost + (1 - alignment) * 10_000,
          });
        }
      }
      pairs.sort((left, right) => left.score - right.score
        || left.cementWorks.x - right.cementWorks.x
        || left.cementWorks.y - right.cementWorks.y
        || left.quarry.x - right.quarry.x
        || left.quarry.y - right.quarry.y);
      if (pairs.length === 0) return null;
      return {
          position: prefabCandidate,
          witness,
          pairs,
          analyze: undefined,
      };
    };

    const prefabOptions: PrefabOption[] = [];
    const prefabCandidates = candidates.map((candidate) => {
      const direction = {
        x: candidate.x - extensionStart.point.x,
        y: candidate.y - extensionStart.point.y,
      };
      const distance = Math.hypot(direction.x, direction.y);
      const forwardProjection = direction.x * extensionStart.outward.x
        + direction.y * extensionStart.outward.y;
      return {
        candidate,
        distance,
        forwardAlignment: distance > 0 ? forwardProjection / distance : -1,
        score: distance > 0
          ? distance + (1 - forwardProjection / distance)
            * CANDIDATE_SEARCH_HALF_SPAN
          : Number.POSITIVE_INFINITY,
      };
    }).filter(({ candidate, forwardAlignment }) => (
      forwardAlignment > 0
        && isSeparated(candidate, fixedPositions)
    )).sort((left, right) => (
      left.score - right.score
        || left.candidate.x - right.candidate.x
        || left.candidate.y - right.candidate.y
    )).map(({ candidate }) => candidate);
    let facilitiesPlaced = 0;
    let mineralPairAnalyses = 0;
    let quarry: FacilityPosition | null = null;
    let cementWorks: FacilityPosition | null = null;
    let prefabricationPlant: FacilityPosition | null = null;
    for (
      let pairIndex = 0;
      mineralPairAnalyses < MAX_CEMENT_SUPPLY_PAIR_ANALYSES;
      pairIndex++
    ) {
      let pairAvailable = false;
      const optionsForRound = pairIndex === 0
        ? prefabCandidates
        : prefabOptions;
      for (const value of optionsForRound) {
        const option = pairIndex === 0
          ? buildPrefabOption(value as FacilityPosition)
          : value as PrefabOption;
        if (!option) continue;
        if (pairIndex === 0) {
          prefabOptions.push(option);
          facilitiesPlaced = 1;
        }
        const pair = option.pairs[pairIndex];
        if (!pair) continue;
        pairAvailable = true;
        if (option.analyze === undefined) {
          option.analyze = createCementSupplyOpportunityAnalyzer(
            analyzer,
            opportunity,
            option.witness,
          );
        }
        if (!option.analyze) continue;
        mineralPairAnalyses += 1;
        if (!option.analyze({
          quarry: pair.quarry,
          cementWorks: pair.cementWorks,
          prefabricationPlant: option.position,
        })) {
          if (mineralPairAnalyses >= MAX_CEMENT_SUPPLY_PAIR_ANALYSES) break;
          continue;
        }
        quarry = pair.quarry;
        cementWorks = pair.cementWorks;
        prefabricationPlant = option.position;
        break;
      }
      if (quarry && cementWorks && prefabricationPlant) break;
      if (!pairAvailable) break;
    }
    if (quarry && cementWorks && prefabricationPlant) {
      positionByDefinition.set('quarry', quarry);
      positionByDefinition.set('cement-works', cementWorks);
      positionByDefinition.set('prefabrication-plant', prefabricationPlant);
      facilitiesPlaced = 3;
      const accepted = [
        ...fixedPositions,
        quarry,
        cementWorks,
        prefabricationPlant,
      ];
      for (const facilityId of [
        'port-interchange',
        'town-construction-market',
      ]) {
        const candidate = candidates.find(
          (value) => isSeparated(value, accepted),
        );
        if (!candidate) break;
        accepted.push(candidate);
        positionByDefinition.set(facilityId, candidate);
        facilitiesPlaced += 1;
      }
    }

    if (facilitiesPlaced < 5) {
      return {
        ok: false,
        error: {
          code: 'economy-exhausted',
          seed: config.seed,
          candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
          prefabAnalyses,
          mineralPairAnalyses,
          facilitiesPlaced,
        },
      };
    }

    const facilities = INITIAL_FACILITY_DEFINITIONS.map((definition) => (
      instantiateFacility(definition, positionByDefinition.get(definition.id)!)
    ));
    const regionalDemandBpsByProduct: Record<string, number> = {};
    INITIAL_PRODUCTS.forEach((product) => {
      regionalDemandBpsByProduct[product.id] = 8_000
        + Math.floor(marketRandom() * 4_001);
    });

    return {
      ok: true,
      economy: {
        economyVersion: 1,
        tick: 0,
        facilities,
        market: {
          constructionIndexBps: 10_000,
          regionalDemandBpsByProduct,
        },
      },
      diagnostics: {
        candidatesEvaluated: MAX_ECONOMY_SITE_CANDIDATES,
        prefabAnalyses,
        mineralPairAnalyses,
      },
    };
  }
}
