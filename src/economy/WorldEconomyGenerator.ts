import {
  MAX_ECONOMY_SITE_CANDIDATES,
  WorldGenerationConfig,
} from '../config/WorldGeneration';
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
  type TerrainHeightSource,
} from '../systems/ConstructionAnalyzer';
import { createSeededRandom } from '../utils/SeededRandom';
import {
  analyzePrefabricationExtension,
  resolvePrefabricationExtensionStart,
} from './PrefabricationOpportunity';
import { canonicalizeConstructionGridPoint } from '../systems/ConstructionGrid';
import { GameConfig } from '../config/GameConfig';

export interface EconomyGenerationDiagnostics {
  candidatesEvaluated: number;
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
      facilitiesPlaced: number;
    };
  };

interface FacilityPosition {
  x: number;
  y: number;
}

const SECONDARY_PLACEMENT_ORDER = [
  'prefabrication-plant',
  'quarry',
  'cement-works',
  'port-interchange',
  'town-construction-market',
] as const;

const PREFAB_SEARCH_HALF_SPAN = 2_400;

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
  const extensionStart = resolvePrefabricationExtensionStart(opportunity);
  return forest.x === opportunity.sites[0].x
    && forest.y === opportunity.sites[0].y
    && sawmill.x === opportunity.sites[1].x
    && sawmill.y === opportunity.sites[1].y
    && prefabricationPlant !== undefined
    && extensionStart !== null
    && analyzePrefabricationExtension(
      new ConstructionAnalyzer(terrain),
      extensionStart,
      prefabricationPlant.railAccess,
    ) !== null;
}

export class WorldEconomyGenerator {
  constructor(private readonly terrain: TerrainHeightSource) {}

  generate(
    config: WorldGenerationConfigDef,
    opportunity: StarterOpportunityDef,
  ): EconomyGenerationResult {
    const random = createSeededRandom(`${config.seed}:economy`);
    const analyzer = new ConstructionAnalyzer(this.terrain);
    const extensionStart = resolvePrefabricationExtensionStart(opportunity);
    if (!extensionStart) {
      return {
        ok: false,
        error: {
          code: 'economy-exhausted',
          seed: config.seed,
          candidatesEvaluated: 0,
          facilitiesPlaced: 0,
        },
      };
    }
    const positions: FacilityPosition[] = opportunity.sites.map(
      ({ x, y }) => ({ x, y }),
    );
    const positionByDefinition = new Map<string, FacilityPosition>([
      ['managed-forest', positions[0]],
      ['sawmill', positions[1]],
    ]);
    const canonicalCandidates = new Set<string>();
    const deferredFacilityCandidates: FacilityPosition[] = [];
    let facilitiesPlaced = 0;
    const gridSize = Math.sqrt(MAX_ECONOMY_SITE_CANDIDATES);
    const xLimit = WorldGenerationConfig.WORLD_HALF_WIDTH
      - WorldGenerationConfig.SITE_SEARCH_MARGIN;
    const yLimit = WorldGenerationConfig.WORLD_HALF_HEIGHT
      - WorldGenerationConfig.SITE_SEARCH_MARGIN;
    const searchMinX = Math.max(
      -xLimit,
      positions[1].x - PREFAB_SEARCH_HALF_SPAN,
    );
    const searchMaxX = Math.min(
      xLimit,
      positions[1].x + PREFAB_SEARCH_HALF_SPAN,
    );
    const searchMinY = Math.max(
      -yLimit,
      positions[1].y - PREFAB_SEARCH_HALF_SPAN,
    );
    const searchMaxY = Math.min(
      yLimit,
      positions[1].y + PREFAB_SEARCH_HALF_SPAN,
    );
    const cellWidth = (searchMaxX - searchMinX) / gridSize;
    const cellHeight = (searchMaxY - searchMinY) / gridSize;
    let candidatesEvaluated = 0;

    for (
      let index = 0;
      index < MAX_ECONOMY_SITE_CANDIDATES
        && facilitiesPlaced < SECONDARY_PLACEMENT_ORDER.length;
      index++
    ) {
      const row = Math.floor(index / gridSize);
      const column = index % gridSize;
      const rawCandidate = {
        x: searchMinX + (column + 0.2 + random() * 0.6) * cellWidth,
        y: searchMinY + (row + 0.2 + random() * 0.6) * cellHeight,
      };
      candidatesEvaluated += 1;
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
      if (relief === null || relief > WorldGenerationConfig.MAX_SITE_RELIEF) {
        continue;
      }
      if (positions.some((position) => Math.hypot(
        candidate.x - position.x,
        candidate.y - position.y,
      ) < WorldGenerationConfig.MIN_FACILITY_SEPARATION)) {
        continue;
      }
      const facilityId = SECONDARY_PLACEMENT_ORDER[facilitiesPlaced];
      if (facilityId === 'prefabrication-plant') {
        if (analyzePrefabricationExtension(
          analyzer,
          extensionStart,
          candidate,
        ) === null) {
          deferredFacilityCandidates.push(candidate);
          continue;
        }
        positions.push(candidate);
        positionByDefinition.set(facilityId, candidate);
        facilitiesPlaced += 1;
        for (const deferred of deferredFacilityCandidates) {
          if (positions.some((position) => Math.hypot(
            deferred.x - position.x,
            deferred.y - position.y,
          ) < WorldGenerationConfig.MIN_FACILITY_SEPARATION)) {
            continue;
          }
          const deferredFacilityId =
            SECONDARY_PLACEMENT_ORDER[facilitiesPlaced];
          positions.push(deferred);
          positionByDefinition.set(deferredFacilityId, deferred);
          facilitiesPlaced += 1;
          if (facilitiesPlaced === SECONDARY_PLACEMENT_ORDER.length) break;
        }
        continue;
      }
      positions.push(candidate);
      positionByDefinition.set(facilityId, candidate);
      facilitiesPlaced += 1;
    }

    if (facilitiesPlaced < SECONDARY_PLACEMENT_ORDER.length) {
      return {
        ok: false,
        error: {
          code: 'economy-exhausted',
          seed: config.seed,
          candidatesEvaluated,
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
        + Math.floor(random() * 4_001);
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
      diagnostics: { candidatesEvaluated },
    };
  }
}
