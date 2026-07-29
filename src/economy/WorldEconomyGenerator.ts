import {
  MAX_ECONOMY_SITE_CANDIDATES,
  REGIONAL_ENDPOINT_MAX_CHORD,
  REGIONAL_ENDPOINT_MIN_CHORD,
  WorldGenerationConfig,
} from '../config/WorldGeneration';
import {
  ConstructionConfig,
  ENDPOINT_CONNECTION_COST,
} from '../config/ConstructionConfig';
import {
  MAX_CEMENT_SUPPLY_LINK_COST,
  MAX_REGIONAL_CONSTRUCTION_LINK_COST,
  MAX_REGIONAL_PAIR_ANALYSES,
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
  type CementSupplyOpportunityWitness,
} from './CementSupplyOpportunity';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
} from '../systems/TrackGeometry';
import type { TrackGeometryDef } from '../systems/TrackGeometry';
import type {
  PrefabricationExtensionWitness,
} from './PrefabricationOpportunity';
import {
  createRegionalConstructionOpportunityAnalyzer,
  type RegionalConstructionOpportunityWitness,
} from './RegionalConstructionOpportunity';
import {
  ENGINEERED_GRADE_COMPARISON_EPSILON,
} from '../systems/ConstructionGradeMetrics';

export interface EconomyGenerationDiagnostics {
  candidatesEvaluated: number;
  prefabAnalyses: number;
  mineralPairAnalyses: number;
  regionalPairAnalyses: number;
  regionalTopologyCost: number;
  regionalTotalCost: number;
  regionalSteelPathLength: number;
  regionalModulePathLength: number;
  regionalSteelReferenceActiveTicks: number;
  regionalModuleReferenceActiveTicks: number;
  regionalMinimumSteelMargin: number;
  regionalMinimumModuleMargin: number;
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
      regionalPairAnalyses: number;
      facilitiesPlaced: number;
    };
  };

interface FacilityPosition {
  x: number;
  y: number;
}

interface TerrainFacilityPosition extends FacilityPosition {
  elevation: number;
}

const CANDIDATE_GRID_SIZE = 16;
const CANDIDATE_SEARCH_HALF_SPAN = 3_200;
export const MAX_CEMENT_SUPPLY_PAIR_ANALYSES = 256;
const MAX_REGIONAL_ENDPOINT_ANALYSES = 48;
interface RegionalEndpointOffset {
  x: number;
  y: number;
  dx: number;
  dy: number;
  chord: number;
}
export function buildRegionalEndpointOffsets(
  source: Readonly<FacilityPosition>,
): readonly RegionalEndpointOffset[] {
  const step = GameConfig.WORLD.SNAP_GRID_SIZE;
  const offsets: RegionalEndpointOffset[] = [];
  const minX = Math.ceil(
    (source.x - REGIONAL_ENDPOINT_MAX_CHORD) / step,
  ) * step;
  const maxX = Math.floor(
    (source.x + REGIONAL_ENDPOINT_MAX_CHORD) / step,
  ) * step;
  const minY = Math.ceil(
    (source.y - REGIONAL_ENDPOINT_MAX_CHORD) / step,
  ) * step;
  const maxY = Math.floor(
    (source.y + REGIONAL_ENDPOINT_MAX_CHORD) / step,
  ) * step;
  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      const dx = x - source.x;
      const dy = y - source.y;
      const chord = Math.hypot(dx, dy);
      if (chord >= REGIONAL_ENDPOINT_MIN_CHORD
        && chord <= REGIONAL_ENDPOINT_MAX_CHORD) {
        offsets.push({
          x,
          y,
          dx,
          dy,
          chord,
        });
      }
    }
  }
  offsets.sort((left, right) => left.chord - right.chord
    || left.x - right.x || left.y - right.y);
  return offsets;
}
const MIN_REGIONAL_ENDPOINT_TRACK_COST = REGIONAL_ENDPOINT_MIN_CHORD
  * ConstructionConfig.TRACK_COST_PER_UNIT;
const MAX_TOWN_CONSTRUCTION_COST_WITH_MINIMUM_PORT =
  MAX_REGIONAL_CONSTRUCTION_LINK_COST
    - ENDPOINT_CONNECTION_COST * 2
    - MIN_REGIONAL_ENDPOINT_TRACK_COST;

function minimumMineralEngineeringCost(
  firstDistance: number,
  secondDistance: number,
): number {
  return Math.round(
    firstDistance * ConstructionConfig.TRACK_COST_PER_UNIT,
  ) + Math.round(
    secondDistance * ConstructionConfig.TRACK_COST_PER_UNIT,
  ) + ENDPOINT_CONNECTION_COST * 2;
}

function footprintMetrics(
  terrain: TerrainHeightSource,
  position: FacilityPosition,
): { relief: number; centerElevation: number } | null {
  const radius = WorldGenerationConfig.SITE_FOOTPRINT_RADIUS;
  const heights: number[] = [];
  let centerElevation = Number.NaN;
  for (const dx of [-radius, 0, radius]) {
    for (const dy of [-radius, 0, radius]) {
      const height = terrain.getHeightAt(position.x + dx, position.y + dy);
      if (!Number.isFinite(height)) return null;
      if (dx === 0 && dy === 0) centerElevation = height;
      heights.push(height);
    }
  }
  return {
    relief: Math.max(...heights) - Math.min(...heights),
    centerElevation,
  };
}

function footprintRelief(
  terrain: TerrainHeightSource,
  position: FacilityPosition,
): number | null {
  return footprintMetrics(terrain, position)?.relief ?? null;
}

function controlPolygonLength(geometry: TrackGeometryDef): number {
  return Math.hypot(
    geometry.p1.x - geometry.p0.x,
    geometry.p1.y - geometry.p0.y,
  ) + Math.hypot(
    geometry.p2.x - geometry.p1.x,
    geometry.p2.y - geometry.p1.y,
  ) + Math.hypot(
    geometry.p3.x - geometry.p2.x,
    geometry.p3.y - geometry.p2.y,
  );
}

function endpointGradeCanFit(
  geometry: TrackGeometryDef,
  startElevation: number,
  endElevation: number,
): boolean {
  return Math.abs(endElevation - startElevation)
    <= controlPolygonLength(geometry)
      * (
        ConstructionConfig.MAX_GRADE_PERCENT
          + ENGINEERED_GRADE_COMPARISON_EPSILON
      ) / 100;
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
  diagnostics?: unknown,
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
  const portInterchange = value.facilities.find(
    ({ id }) => id === 'port-interchange',
  );
  const townConstructionMarket = value.facilities.find(
    ({ id }) => id === 'town-construction-market',
  );
  const extensionStart = resolvePrefabricationExtensionStart(opportunity);
  const analyzer = new ConstructionAnalyzer(terrain);
  const prefabWitness = prefabricationPlant && extensionStart
    ? analyzePrefabricationExtension(
      analyzer,
      extensionStart,
      prefabricationPlant.railAccess,
    )
    : null;
  const cementWitness = prefabWitness && quarry && cementWorks
    ? analyzeCementSupplyOpportunity(
      analyzer,
      opportunity,
      prefabWitness,
      {
        quarry: quarry.railAccess,
        cementWorks: cementWorks.railAccess,
        prefabricationPlant: prefabricationPlant!.railAccess,
      },
    )
    : null;
  const regionalAnalyzer = prefabWitness && cementWitness
    ? createRegionalConstructionOpportunityAnalyzer(
      analyzer,
      opportunity,
      prefabWitness,
      cementWitness,
    )
    : null;
  const regionalWitness = regionalAnalyzer
    && portInterchange
    && townConstructionMarket
    ? regionalAnalyzer({
      portInterchange: portInterchange.railAccess,
      townConstructionMarket: townConstructionMarket.railAccess,
    })
    : null;
  const diagnosticsMatch = diagnostics === undefined || (
    typeof diagnostics === 'object'
    && diagnostics !== null
    && !Array.isArray(diagnostics)
    && regionalWitness !== null
    && Number.isInteger(
      (diagnostics as EconomyGenerationDiagnostics).regionalPairAnalyses,
    )
    && (diagnostics as EconomyGenerationDiagnostics).regionalPairAnalyses >= 1
    && (diagnostics as EconomyGenerationDiagnostics).regionalPairAnalyses
      <= MAX_REGIONAL_PAIR_ANALYSES
    && (diagnostics as EconomyGenerationDiagnostics).regionalTopologyCost
      === regionalWitness.topologyCost
    && (diagnostics as EconomyGenerationDiagnostics).regionalTotalCost
      === regionalWitness.totalCost
    && (diagnostics as EconomyGenerationDiagnostics).regionalSteelPathLength
      === regionalWitness.steelPathLength
    && (diagnostics as EconomyGenerationDiagnostics).regionalModulePathLength
      === regionalWitness.modulePathLength
    && (
      diagnostics as EconomyGenerationDiagnostics
    ).regionalSteelReferenceActiveTicks
      === regionalWitness.steelReferenceActiveTicks
    && (
      diagnostics as EconomyGenerationDiagnostics
    ).regionalModuleReferenceActiveTicks
      === regionalWitness.moduleReferenceActiveTicks
    && (
      diagnostics as EconomyGenerationDiagnostics
    ).regionalMinimumSteelMargin === regionalWitness.minimumSteelMargin
    && (
      diagnostics as EconomyGenerationDiagnostics
    ).regionalMinimumModuleMargin === regionalWitness.minimumModuleMargin
  );
  return forest.x === opportunity.sites[0].x
    && forest.y === opportunity.sites[0].y
    && sawmill.x === opportunity.sites[1].x
    && sawmill.y === opportunity.sites[1].y
    && prefabricationPlant !== undefined
    && quarry !== undefined
    && cementWorks !== undefined
    && portInterchange !== undefined
    && townConstructionMarket !== undefined
    && extensionStart !== null
    && Math.min(...opportunity.corridors.map(
      (corridor) => corridor.estimatedCost,
    )) <= MAX_STARTER_CORRIDOR_COST
    && prefabWitness !== null
    && cementWitness !== null
    && regionalWitness !== null
    && diagnosticsMatch;
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
          regionalPairAnalyses: 0,
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
    const candidates: TerrainFacilityPosition[] = [];
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
        const metrics = footprintMetrics(this.terrain, candidate);
        if (metrics === null
          || metrics.relief > WorldGenerationConfig.MAX_SITE_RELIEF) {
          continue;
        }
        candidates.push({
          ...candidate,
          elevation: metrics.centerElevation,
        });
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
    const regionalEndpointOffsetsBySource = new Map<
      string,
      readonly RegionalEndpointOffset[]
    >();
    const selectPhysicalRegionalEndpoints = (
      source: FacilityPosition,
      outward: Readonly<FacilityPosition>,
      excluded: readonly FacilityPosition[],
    ): Array<FacilityPosition & { chord: number }> => {
      const physical: Array<FacilityPosition & { chord: number }> = [];
      const sourceKey = `${source.x}:${source.y}`;
      let offsets = regionalEndpointOffsetsBySource.get(sourceKey);
      if (!offsets) {
        offsets = buildRegionalEndpointOffsets(source);
        regionalEndpointOffsetsBySource.set(sourceKey, offsets);
      }
      for (const {
        x,
        y,
        dx,
        dy,
        chord,
      } of offsets) {
        const candidate = { x, y };
        if (dx * outward.x + dy * outward.y < 0
          || Math.abs(candidate.x)
            + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
              > WorldGenerationConfig.WORLD_HALF_WIDTH
          || Math.abs(candidate.y)
            + WorldGenerationConfig.SITE_FOOTPRINT_RADIUS
              > WorldGenerationConfig.WORLD_HALF_HEIGHT
          || !isSeparated(candidate, excluded)) {
          continue;
        }
        const relief = footprintRelief(this.terrain, candidate);
        if (relief === null
          || relief > WorldGenerationConfig.MAX_SITE_RELIEF) {
          continue;
        }
        physical.push({ ...candidate, chord });
        if (physical.length === MAX_REGIONAL_ENDPOINT_ANALYSES) break;
      }
      return physical;
    };

    const selectedStarterCorridor = [...opportunity.corridors].sort(
      (left, right) => left.estimatedCost - right.estimatedCost
        || left.id.localeCompare(right.id),
    )[0];
    const forestOutward = deriveTrackEndpointOutward(
      selectedStarterCorridor.feasibilityWitness.segments[0].geometry,
      'start',
    );
    const forest = fixedPositions[0];
    const townAnalysisByCoordinate = new Map<
      string,
      ConstructionAnalysisDetail
    >();
    const analyzeTownCandidate = (
      candidate: FacilityPosition,
    ): ConstructionAnalysisDetail => {
      const key = `${candidate.x}:${candidate.y}`;
      const cached = townAnalysisByCoordinate.get(key);
      if (cached) return cached;
      const detail = analyzer.analyzeDetailed(deriveAutomaticCubic({
        start: forest,
        end: candidate,
        startOutward: forestOutward,
      }));
      townAnalysisByCoordinate.set(key, detail);
      return detail;
    };
    interface MineralPairCandidate {
      quarry: TerrainFacilityPosition;
      cementWorks: TerrainFacilityPosition;
      score: number;
    }
    interface PrefabOption {
      position: TerrainFacilityPosition;
      witness: PrefabricationExtensionWitness;
      pairs: MineralPairCandidate[];
      analyze: CementSupplyOpportunityAnalyzer | null | undefined;
    }
    let prefabAnalyses = 0;
    const extensionStartElevation = this.terrain.getHeightAt(
      extensionStart.point.x,
      extensionStart.point.y,
    );
    const buildPrefabOption = (
      prefabCandidate: TerrainFacilityPosition,
    ): PrefabOption | null => {
      if (!isSeparated(prefabCandidate, fixedPositions)) return null;
      const prefabGeometry = deriveAutomaticCubic({
        start: extensionStart.point,
        end: prefabCandidate,
        startOutward: extensionStart.outward,
      });
      if (!Number.isFinite(extensionStartElevation)
        || !endpointGradeCanFit(
          prefabGeometry,
          extensionStartElevation,
          prefabCandidate.elevation,
        )) {
        return null;
      }
      const mineralCandidates = candidates.filter(
        (candidate) => isSeparated(
          candidate,
          [...fixedPositions, prefabCandidate],
        ),
      );
      const prefabOutward = deriveTrackEndpointOutward(
        prefabGeometry,
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
          const minimumEngineeringCost = minimumMineralEngineeringCost(
            firstDistance,
            secondDistance,
          );
          if (minimumEngineeringCost > MAX_CEMENT_SUPPLY_LINK_COST) continue;
          const quarryToCementGeometry = deriveAutomaticCubic({
            start: quarryCandidate,
            end: cementCandidate,
          });
          if (!endpointGradeCanFit(
            quarryToCementGeometry,
            quarryCandidate.elevation,
            cementCandidate.elevation,
          )) {
            continue;
          }
          const cementToPrefabGeometry = deriveAutomaticCubic({
            start: cementCandidate,
            end: prefabCandidate,
            startOutward: deriveTrackEndpointOutward(
              quarryToCementGeometry,
              'end',
            ),
            endOutward: prefabOutward,
          });
          if (!endpointGradeCanFit(
            cementToPrefabGeometry,
            cementCandidate.elevation,
            prefabCandidate.elevation,
          )) {
            continue;
          }
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
      prefabAnalyses += 1;
      const witness = analyzePrefabricationExtension(
        analyzer,
        extensionStart,
        prefabCandidate,
      );
      if (!witness) return null;
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
    let regionalPairAnalyses = 0;
    let regionalWitness: RegionalConstructionOpportunityWitness | null = null;
    interface MineralResolution {
      quarry: FacilityPosition;
      cementWorks: FacilityPosition;
      prefabricationPlant: FacilityPosition;
      prefabricationWitness: PrefabricationExtensionWitness;
      cementSupplyWitness: CementSupplyOpportunityWitness;
    }
    interface RegionalResolution {
      mineral: MineralResolution;
      portInterchange: FacilityPosition;
      townConstructionMarket: FacilityPosition;
      witness: RegionalConstructionOpportunityWitness;
    }
    interface RegionalCursor {
      tryNext(): {
        attempted: boolean;
        resolution: RegionalResolution | null;
      };
    }
    const buildEndpointLattice = (
      source: FacilityPosition,
      outward: Readonly<FacilityPosition>,
      excluded: readonly FacilityPosition[],
    ): Array<FacilityPosition & { constructionCost: number }> => {
      const analyzed: Array<
        FacilityPosition & { constructionCost: number }
      > = [];
      for (const candidate of selectPhysicalRegionalEndpoints(
        source,
        outward,
        excluded,
      )) {
        const detail = analyzer.analyzeDetailed(deriveAutomaticCubic({
          start: source,
          end: candidate,
          startOutward: outward,
        }));
        if (!detail.proposal.valid) continue;
        analyzed.push({
          x: candidate.x,
          y: candidate.y,
          constructionCost: detail.proposal.costs.total,
        });
      }
      return analyzed;
    };
    const createRegionalCursor = (
      mineral: MineralResolution,
    ): RegionalCursor | null => {
      const regionalAnalyzer = createRegionalConstructionOpportunityAnalyzer(
        analyzer,
        opportunity,
        mineral.prefabricationWitness,
        mineral.cementSupplyWitness,
      );
      if (!regionalAnalyzer) return null;
      const accepted = [
        ...fixedPositions,
        mineral.quarry,
        mineral.cementWorks,
        mineral.prefabricationPlant,
      ];
      const townCandidates: Array<
        FacilityPosition & { constructionCost: number }
      > = [];
      for (const candidate of selectPhysicalRegionalEndpoints(
        forest,
        forestOutward,
        accepted,
      )) {
        const detail = analyzeTownCandidate(candidate);
        if (!detail.proposal.valid
          || detail.proposal.costs.total
            > MAX_TOWN_CONSTRUCTION_COST_WITH_MINIMUM_PORT) {
          continue;
        }
        townCandidates.push({
          x: candidate.x,
          y: candidate.y,
          constructionCost: detail.proposal.costs.total,
        });
      }
      if (townCandidates.length === 0) return null;
      const cheapestTownConstructionCost = Math.min(
        ...townCandidates.map(({ constructionCost }) => constructionCost),
      );
      const quarryOutward = deriveTrackEndpointOutward(
        mineral.cementSupplyWitness.quarryToCement.proposal.geometry,
        'start',
      );
      const portCandidates = buildEndpointLattice(
        mineral.quarry,
        quarryOutward,
        accepted,
      ).filter(({ constructionCost }) => (
        constructionCost
          + cheapestTownConstructionCost
          + ENDPOINT_CONNECTION_COST * 2
            <= MAX_REGIONAL_CONSTRUCTION_LINK_COST
      ));
      const pairs: Array<{
        portInterchange: FacilityPosition;
        townConstructionMarket: FacilityPosition;
        score: number;
      }> = [];
      for (const port of portCandidates) {
        for (const town of townCandidates) {
          if (!isSeparated(town, [port])
            || port.constructionCost
              + town.constructionCost
              + ENDPOINT_CONNECTION_COST * 2
                > MAX_REGIONAL_CONSTRUCTION_LINK_COST) {
            continue;
          }
          pairs.push({
            portInterchange: { x: port.x, y: port.y },
            townConstructionMarket: { x: town.x, y: town.y },
            score: Math.hypot(
              port.x - mineral.quarry.x,
              port.y - mineral.quarry.y,
            ) + Math.hypot(
              town.x - fixedPositions[0].x,
              town.y - fixedPositions[0].y,
            ),
          });
        }
      }
      pairs.sort((left, right) => left.score - right.score
        || left.portInterchange.x - right.portInterchange.x
        || left.portInterchange.y - right.portInterchange.y
        || left.townConstructionMarket.x - right.townConstructionMarket.x
        || left.townConstructionMarket.y - right.townConstructionMarket.y);
      if (pairs.length === 0) return null;
      let nextPairIndex = 0;
      return {
        tryNext() {
          if (nextPairIndex >= pairs.length
            || regionalPairAnalyses >= MAX_REGIONAL_PAIR_ANALYSES) {
            return { attempted: false, resolution: null };
          }
          const pair = pairs[nextPairIndex];
          nextPairIndex += 1;
          regionalPairAnalyses += 1;
          const witness = regionalAnalyzer(pair);
          return {
            attempted: true,
            resolution: witness ? { mineral, ...pair, witness } : null,
          };
        },
      };
    };
    let regionalResolution: RegionalResolution | null = null;
    const regionalCursors: RegionalCursor[] = [];
    mineralSearch:
    for (
      let pairIndex = 0;
      mineralPairAnalyses < MAX_CEMENT_SUPPLY_PAIR_ANALYSES
        && regionalPairAnalyses < MAX_REGIONAL_PAIR_ANALYSES;
      pairIndex++
    ) {
      let pairAvailable = false;
      const optionsForRound = pairIndex === 0
        ? prefabCandidates
        : prefabOptions;
      for (const value of optionsForRound) {
        const option = pairIndex === 0
          ? buildPrefabOption(value as TerrainFacilityPosition)
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
        if (mineralPairAnalyses >= MAX_CEMENT_SUPPLY_PAIR_ANALYSES) {
          break mineralSearch;
        }
        mineralPairAnalyses += 1;
        const witness = option.analyze({
          quarry: pair.quarry,
          cementWorks: pair.cementWorks,
          prefabricationPlant: option.position,
        });
        if (!witness) continue;
        facilitiesPlaced = 3;
        const regionalCursor = createRegionalCursor({
          quarry: pair.quarry,
          cementWorks: pair.cementWorks,
          prefabricationPlant: option.position,
          prefabricationWitness: option.witness,
          cementSupplyWitness: witness,
        });
        if (regionalCursor) {
          const queuedPriorCursorCount = regionalCursors.length;
          const head = regionalCursor.tryNext();
          regionalResolution = head.resolution;
          if (!regionalResolution && head.attempted) {
            regionalCursors.push(regionalCursor);
          }
          if (!regionalResolution
            && regionalPairAnalyses < MAX_REGIONAL_PAIR_ANALYSES
            && queuedPriorCursorCount > 0) {
            const priorCursor = regionalCursors.shift()!;
            const prior = priorCursor.tryNext();
            regionalResolution = prior.resolution;
            if (!regionalResolution && prior.attempted) {
              regionalCursors.push(priorCursor);
            }
          }
        }
        if (regionalResolution
          || regionalPairAnalyses >= MAX_REGIONAL_PAIR_ANALYSES) {
          break mineralSearch;
        }
      }
      if (!pairAvailable) break;
    }
    while (!regionalResolution
      && regionalPairAnalyses < MAX_REGIONAL_PAIR_ANALYSES
      && regionalCursors.length > 0) {
      const cursor = regionalCursors.shift()!;
      const next = cursor.tryNext();
      regionalResolution = next.resolution;
      if (!regionalResolution && next.attempted) {
        regionalCursors.push(cursor);
      }
    }
    if (regionalResolution) {
      const { mineral } = regionalResolution;
      regionalWitness = regionalResolution.witness;
      positionByDefinition.set('quarry', mineral.quarry);
      positionByDefinition.set('cement-works', mineral.cementWorks);
      positionByDefinition.set(
        'prefabrication-plant',
        mineral.prefabricationPlant,
      );
      positionByDefinition.set(
        'port-interchange',
        regionalResolution.portInterchange,
      );
      positionByDefinition.set(
        'town-construction-market',
        regionalResolution.townConstructionMarket,
      );
      facilitiesPlaced = 5;
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
          regionalPairAnalyses,
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
        regionalPairAnalyses,
        regionalTopologyCost: regionalWitness!.topologyCost,
        regionalTotalCost: regionalWitness!.totalCost,
        regionalSteelPathLength: regionalWitness!.steelPathLength,
        regionalModulePathLength: regionalWitness!.modulePathLength,
        regionalSteelReferenceActiveTicks:
          regionalWitness!.steelReferenceActiveTicks,
        regionalModuleReferenceActiveTicks:
          regionalWitness!.moduleReferenceActiveTicks,
        regionalMinimumSteelMargin: regionalWitness!.minimumSteelMargin,
        regionalMinimumModuleMargin: regionalWitness!.minimumModuleMargin,
      },
    };
  }
}
