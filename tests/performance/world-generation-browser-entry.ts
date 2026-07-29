import { MAX_ANALYSIS_SAMPLES } from '../../src/config/ConstructionConfig';
import {
  MAX_ECONOMY_SITE_CANDIDATES,
  MAX_OPPORTUNITY_ATTEMPTS,
  MAX_SITE_CANDIDATES_PER_ATTEMPT,
} from '../../src/config/WorldGeneration';
import {
  MAX_CEMENT_SUPPLY_PAIR_ANALYSES,
  type EconomyGenerationResult,
  WorldEconomyGenerator,
  validateGeneratedEconomy,
} from '../../src/economy/WorldEconomyGenerator';
import {
  analyzeCementSupplyOpportunity,
} from '../../src/economy/CementSupplyOpportunity';
import {
  MAX_CEMENT_SUPPLY_LINK_COST,
  MODULE_REFERENCE_REVENUE,
  MAX_REGIONAL_CONSTRUCTION_LINK_COST,
  MAX_REGIONAL_PAIR_ANALYSES,
  MAX_STARTER_CORRIDOR_COST,
  REFERENCE_MANOEUVRE_TICKS,
  REFERENCE_RUNNING_COST_PER_ACTIVE_TICK,
  REFERENCE_SPEED_WORLD_UNITS_PER_TICK,
  STEEL_REFERENCE_REVENUE,
} from '../../src/config/FreightProgression';
import {
  analyzePrefabricationExtension,
  resolvePrefabricationExtensionStart,
} from '../../src/economy/PrefabricationOpportunity';
import { WorldManager } from '../../src/managers/WorldManager';
import { ConstructionAnalyzer } from '../../src/systems/ConstructionAnalyzer';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import {
  createRegionalConstructionOpportunityAnalyzer,
  type RegionalConstructionOpportunityWitness,
} from '../../src/economy/RegionalConstructionOpportunity';
import type {
  CementSupplyOpportunityWitness,
} from '../../src/economy/CementSupplyOpportunity';
import type {
  PrefabricationExtensionWitness,
} from '../../src/economy/PrefabricationOpportunity';
import type {
  StarterOpportunityDef,
  Vec2Def,
} from '../../src/config/WorldData';
import {
  deriveAutomaticCubic,
  deriveTrackEndpointOutward,
  type TrackGeometryDef,
} from '../../src/systems/TrackGeometry';
import {
  sampleConstructionCurve,
} from '../../src/systems/ConstructionCurveSampler';
import { equalPlainData } from '../../src/utils/PlainData';

export interface WorldGenerationAuditRange {
  readonly start: number;
  readonly end: number;
}

export const DEFAULT_WORLD_GENERATION_AUDIT_RANGE:
Readonly<WorldGenerationAuditRange> = Object.freeze({
  start: 601,
  end: 884,
});

interface IndependentRegionalReference {
  readonly portGeometry: TrackGeometryDef;
  readonly townGeometry: TrackGeometryDef;
  readonly steelPathLength: number;
  readonly modulePathLength: number;
  readonly steelReferenceActiveTicks: number;
  readonly moduleReferenceActiveTicks: number;
  readonly minimumSteelMargin: number;
  readonly minimumModuleMargin: number;
}

function independentlySamplePathLength(
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

function independentlyReconstructRegionalReference(
  opportunity: StarterOpportunityDef,
  prefabrication: PrefabricationExtensionWitness,
  cementSupply: CementSupplyOpportunityWitness,
  sites: {
    readonly portInterchange: Readonly<Vec2Def>;
    readonly townConstructionMarket: Readonly<Vec2Def>;
  },
): IndependentRegionalReference | null {
  const corridor = [...opportunity.corridors].sort(
    (left, right) => left.estimatedCost - right.estimatedCost
      || left.id.localeCompare(right.id),
  )[0];
  const starterGeometries = corridor?.feasibilityWitness.segments.map(
    ({ geometry }) => geometry,
  );
  const firstStarterGeometry = starterGeometries?.[0];
  if (!starterGeometries?.length || !firstStarterGeometry) return null;

  const quarryToCementGeometry =
    cementSupply.quarryToCement.proposal.geometry;
  const portGeometry = deriveAutomaticCubic({
    start: quarryToCementGeometry.p0,
    end: sites.portInterchange,
    startOutward: deriveTrackEndpointOutward(
      quarryToCementGeometry,
      'start',
    ),
  });
  const townGeometry = deriveAutomaticCubic({
    start: firstStarterGeometry.p0,
    end: sites.townConstructionMarket,
    startOutward: deriveTrackEndpointOutward(
      firstStarterGeometry,
      'start',
    ),
  });
  const steelPathLength = independentlySamplePathLength([
    portGeometry,
    quarryToCementGeometry,
    cementSupply.cementToPrefabrication.proposal.geometry,
  ]);
  const modulePathLength = independentlySamplePathLength([
    prefabrication.proposal.geometry,
    ...starterGeometries.slice().reverse(),
    townGeometry,
  ]);
  if (steelPathLength === null || modulePathLength === null) return null;

  const steelReferenceActiveTicks = Math.ceil(
    steelPathLength / REFERENCE_SPEED_WORLD_UNITS_PER_TICK,
  ) + REFERENCE_MANOEUVRE_TICKS;
  const moduleReferenceActiveTicks = Math.ceil(
    modulePathLength / REFERENCE_SPEED_WORLD_UNITS_PER_TICK,
  ) + REFERENCE_MANOEUVRE_TICKS;
  return {
    portGeometry,
    townGeometry,
    steelPathLength,
    modulePathLength,
    steelReferenceActiveTicks,
    moduleReferenceActiveTicks,
    minimumSteelMargin: STEEL_REFERENCE_REVENUE
      - steelReferenceActiveTicks * REFERENCE_RUNNING_COST_PER_ACTIVE_TICK,
    minimumModuleMargin: MODULE_REFERENCE_REVENUE
      - moduleReferenceActiveTicks * REFERENCE_RUNNING_COST_PER_ACTIVE_TICK,
  };
}

function regionalReferenceMatches(
  production: RegionalConstructionOpportunityWitness,
  independent: IndependentRegionalReference | null,
): independent is IndependentRegionalReference {
  return independent !== null
    && equalPlainData(
      production.portExtension.proposal.geometry,
      independent.portGeometry,
    )
    && equalPlainData(
      production.townExtension.proposal.geometry,
      independent.townGeometry,
    )
    && production.steelPathLength === independent.steelPathLength
    && production.modulePathLength === independent.modulePathLength
    && production.steelReferenceActiveTicks
      === independent.steelReferenceActiveTicks
    && production.moduleReferenceActiveTicks
      === independent.moduleReferenceActiveTicks
    && production.minimumSteelMargin === independent.minimumSteelMargin
    && production.minimumModuleMargin === independent.minimumModuleMargin;
}

function generate(seed: string) {
  const terrain = new TerrainGenerator(seed);
  const originalGenerate = WorldEconomyGenerator.prototype.generate;
  let economyEvaluations = 0;
  let totalEconomyCandidatesEvaluated = 0;
  let totalPrefabAnalyses = 0;
  let totalMineralPairAnalyses = 0;
  let totalRegionalPairAnalyses = 0;
  let pairCapHits = 0;
  let regionalPairCapHits = 0;
  const economyFailures: unknown[] = [];
  let acceptedEconomy: Extract<
    EconomyGenerationResult,
    { ok: true }
  > | null = null;

  let creationResult: ReturnType<typeof WorldManager.tryCreateNew>;
  try {
    WorldEconomyGenerator.prototype.generate = function measuredGenerate(
      generationConfig,
      opportunity,
    ) {
      economyEvaluations += 1;
      const result = originalGenerate.call(
        this,
        generationConfig,
        opportunity,
      );
      totalEconomyCandidatesEvaluated += result.ok
        ? result.diagnostics.candidatesEvaluated
        : result.error.candidatesEvaluated;
      totalPrefabAnalyses += result.ok
        ? result.diagnostics.prefabAnalyses
        : result.error.prefabAnalyses;
      totalMineralPairAnalyses += result.ok
        ? result.diagnostics.mineralPairAnalyses
        : result.error.mineralPairAnalyses;
      totalRegionalPairAnalyses += result.ok
        ? result.diagnostics.regionalPairAnalyses
        : result.error.regionalPairAnalyses;
      if ((result.ok
        ? result.diagnostics.mineralPairAnalyses
        : result.error.mineralPairAnalyses)
        === MAX_CEMENT_SUPPLY_PAIR_ANALYSES) {
        pairCapHits += 1;
      }
      if ((result.ok
        ? result.diagnostics.regionalPairAnalyses
        : result.error.regionalPairAnalyses) === MAX_REGIONAL_PAIR_ANALYSES) {
        regionalPairCapHits += 1;
      }
      if (result.ok) acceptedEconomy = result;
      else if (economyFailures.length < 5) economyFailures.push(result.error);
      return result;
    };
    localStorage.clear();
    WorldManager.reset();
    creationResult = WorldManager.tryCreateNew(seed, seed);
  } finally {
    WorldEconomyGenerator.prototype.generate = originalGenerate;
  }
  if (creationResult.ok === false || acceptedEconomy === null) {
    throw new Error(
      `audited joint generation failed for ${seed}: `
      + `${JSON.stringify(creationResult)}; `
      + `economyEvaluations=${economyEvaluations}; `
      + `regionalPairAnalyses=${totalRegionalPairAnalyses}; `
      + `economyFailures=${JSON.stringify(economyFailures)}`,
    );
  }
  const economyResult = acceptedEconomy as Extract<
    EconomyGenerationResult,
    { ok: true }
  >;
  if (!validateGeneratedEconomy(
    creationResult.world.economy,
    creationResult.world.starterOpportunity,
    terrain,
  )) {
    throw new Error(`audited economy validation failed for ${seed}`);
  }

  const prefab = creationResult.world.economy.facilities.find(
    ({ id }) => id === 'prefabrication-plant',
  )!;
  const extensionStart = resolvePrefabricationExtensionStart(
    creationResult.world.starterOpportunity,
  );
  const prefabWitnessCost = analyzePrefabricationExtension(
    new ConstructionAnalyzer(terrain),
    extensionStart!,
    prefab.railAccess,
  )?.totalCost ?? null;
  const facility = (id: string) => creationResult.world.economy.facilities.find(
    (candidate) => candidate.id === id,
  )!;
  const prefabWitness = analyzePrefabricationExtension(
    new ConstructionAnalyzer(terrain),
    extensionStart!,
    facility('prefabrication-plant').railAccess,
  );
  const cementSupplyWitnessCost = prefabWitness
    ? analyzeCementSupplyOpportunity(
      new ConstructionAnalyzer(terrain),
      creationResult.world.starterOpportunity,
      prefabWitness,
      {
        quarry: facility('quarry').railAccess,
        cementWorks: facility('cement-works').railAccess,
        prefabricationPlant: facility('prefabrication-plant').railAccess,
      },
    )?.totalCost ?? null
    : null;
  const replayAnalyzer = new ConstructionAnalyzer(terrain);
  const replayPrefabWitness = analyzePrefabricationExtension(
    replayAnalyzer,
    extensionStart!,
    facility('prefabrication-plant').railAccess,
  );
  const replayCementWitness = replayPrefabWitness
    ? analyzeCementSupplyOpportunity(
      replayAnalyzer,
      creationResult.world.starterOpportunity,
      replayPrefabWitness,
      {
        quarry: facility('quarry').railAccess,
        cementWorks: facility('cement-works').railAccess,
        prefabricationPlant: facility('prefabrication-plant').railAccess,
      },
    )
    : null;
  const replayRegionalConstructionWitness = replayPrefabWitness
    && replayCementWitness
    ? createRegionalConstructionOpportunityAnalyzer(
      replayAnalyzer,
      creationResult.world.starterOpportunity,
      replayPrefabWitness,
      replayCementWitness,
    )?.({
      portInterchange: facility('port-interchange').railAccess,
      townConstructionMarket:
        facility('town-construction-market').railAccess,
    }) ?? null
    : null;
  const independentRegionalReference = replayPrefabWitness
    && replayCementWitness
    ? independentlyReconstructRegionalReference(
      creationResult.world.starterOpportunity,
      replayPrefabWitness,
      replayCementWitness,
      {
        portInterchange: facility('port-interchange').railAccess,
        townConstructionMarket:
          facility('town-construction-market').railAccess,
      },
    )
    : null;
  if (!replayRegionalConstructionWitness
    || !regionalReferenceMatches(
      replayRegionalConstructionWitness,
      independentRegionalReference,
    )) {
    throw new Error(
      `independent regional reference mismatch for ${seed}: `
      + `${JSON.stringify({
        production: replayRegionalConstructionWitness,
        independent: independentRegionalReference,
      })}`,
    );
  }
  const regionalConstructionWitness = replayRegionalConstructionWitness
    ? {
      totalCost: replayRegionalConstructionWitness.totalCost,
      steelReferenceActiveTicks:
        replayRegionalConstructionWitness.steelReferenceActiveTicks,
      moduleReferenceActiveTicks:
        replayRegionalConstructionWitness.moduleReferenceActiveTicks,
      minimumSteelMargin:
        replayRegionalConstructionWitness.minimumSteelMargin,
      minimumModuleMargin:
        replayRegionalConstructionWitness.minimumModuleMargin,
    }
    : null;
  const starterCorridorCost = Math.min(
    ...creationResult.world.starterOpportunity.corridors.map(
      ({ estimatedCost }) => estimatedCost,
    ),
  );
  const blankInfrastructure = creationResult.world.tracks.length === 0
    && creationResult.world.junctions.length === 0
    && creationResult.world.stations.length === 0
    && creationResult.world.trains.length === 0
    && !('services' in creationResult.world);
  const opportunityResult = {
    ok: true as const,
    opportunity: creationResult.world.starterOpportunity,
    diagnostics: {
      attemptsEvaluated:
        creationResult.world.starterOpportunity.resolvedAttempt,
      maxSiteCandidatesEvaluated: MAX_SITE_CANDIDATES_PER_ATTEMPT,
    },
  };

  return {
    opportunityResult,
    economyResult,
    prefabWitnessCost,
    cementSupplyWitnessCost,
    starterCorridorCost,
    economyEvaluations,
    totalEconomyCandidatesEvaluated,
    totalPrefabAnalyses,
    totalMineralPairAnalyses,
    totalRegionalPairAnalyses,
    pairCapHits,
    regionalPairCapHits,
    regionalConstructionWitness,
    blankInfrastructure,
  };
}

async function auditJointSeeds(
  range: Readonly<WorldGenerationAuditRange>
    = DEFAULT_WORLD_GENERATION_AUDIT_RANGE,
) {
  const startedAt = performance.now();
  let maxResolvedAttempt = 0;
  let maxEconomyEvaluations = 0;
  let maxTotalEconomyCandidatesEvaluated = 0;
  let maxTotalPrefabAnalyses = 0;
  let maxTotalMineralPairAnalyses = 0;
  let totalPairCapHits = 0;
  let maxPairCapHits = 0;
  let maxTotalRegionalPairAnalyses = 0;
  let totalRegionalPairCapHits = 0;
  let maxRegionalPairCapHits = 0;
  let maxRegionalConstructionCost = 0;
  let maxRegionalSteelReferenceActiveTicks = 0;
  let maxRegionalModuleReferenceActiveTicks = 0;
  let minimumRegionalSteelMargin = Number.POSITIVE_INFINITY;
  let minimumRegionalModuleMargin = Number.POSITIVE_INFINITY;
  let maxJointWorkUnits = 0;
  let maxGenerationDurationMs = 0;
  let firstSlowestSeed = '';
  let firstWorstSeed = '';
  let seedsEvaluated = 0;
  let seedsResolved = 0;
  let seedsExhausted = 0;
  const exhaustedSeeds: string[] = [];
  const exhaustedErrors: string[] = [];

  for (let index = range.start; index <= range.end; index++) {
    const seed = `playtest-${index}`;
    let result: ReturnType<typeof generate> | undefined;
    const generationStartedAt = performance.now();
    try {
      result = generate(seed);
    } catch (error) {
      seedsEvaluated += 1;
      seedsExhausted += 1;
      exhaustedSeeds.push(seed);
      exhaustedErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
    const generationDurationMs = performance.now() - generationStartedAt;
    if (generationDurationMs > maxGenerationDurationMs) {
      maxGenerationDurationMs = generationDurationMs;
      firstSlowestSeed = seed;
    }
    if (result === undefined) {
      if (index < range.end) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      continue;
    }
    seedsEvaluated += 1;
    seedsResolved += 1;
    const resolvedAttempt = result.opportunityResult.opportunity.resolvedAttempt;
    maxResolvedAttempt = Math.max(maxResolvedAttempt, resolvedAttempt);
    maxEconomyEvaluations = Math.max(
      maxEconomyEvaluations,
      result.economyEvaluations,
    );
    maxTotalEconomyCandidatesEvaluated = Math.max(
      maxTotalEconomyCandidatesEvaluated,
      result.totalEconomyCandidatesEvaluated,
    );
    maxTotalPrefabAnalyses = Math.max(
      maxTotalPrefabAnalyses,
      result.totalPrefabAnalyses,
    );
    maxTotalMineralPairAnalyses = Math.max(
      maxTotalMineralPairAnalyses,
      result.totalMineralPairAnalyses,
    );
    maxTotalRegionalPairAnalyses = Math.max(
      maxTotalRegionalPairAnalyses,
      result.totalRegionalPairAnalyses,
    );
    totalPairCapHits += result.pairCapHits;
    maxPairCapHits = Math.max(maxPairCapHits, result.pairCapHits);
    totalRegionalPairCapHits += result.regionalPairCapHits;
    maxRegionalPairCapHits = Math.max(
      maxRegionalPairCapHits,
      result.regionalPairCapHits,
    );
    const regionalWitness = result.regionalConstructionWitness!;
    maxRegionalConstructionCost = Math.max(
      maxRegionalConstructionCost,
      regionalWitness.totalCost,
    );
    maxRegionalSteelReferenceActiveTicks = Math.max(
      maxRegionalSteelReferenceActiveTicks,
      regionalWitness.steelReferenceActiveTicks,
    );
    maxRegionalModuleReferenceActiveTicks = Math.max(
      maxRegionalModuleReferenceActiveTicks,
      regionalWitness.moduleReferenceActiveTicks,
    );
    minimumRegionalSteelMargin = Math.min(
      minimumRegionalSteelMargin,
      regionalWitness.minimumSteelMargin,
    );
    minimumRegionalModuleMargin = Math.min(
      minimumRegionalModuleMargin,
      regionalWitness.minimumModuleMargin,
    );
    const jointWorkUnits = resolvedAttempt * MAX_SITE_CANDIDATES_PER_ATTEMPT
      + result.totalEconomyCandidatesEvaluated;
    if (jointWorkUnits > maxJointWorkUnits) {
      maxJointWorkUnits = jointWorkUnits;
      firstWorstSeed = seed;
    }
    if (index < range.end) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    range: {
      startSeed: `playtest-${range.start}`,
      endSeed: `playtest-${range.end}`,
    },
    seedsEvaluated,
    seedsResolved,
    seedsExhausted,
    exhaustedSeeds,
    exhaustedErrors,
    maxResolvedAttempt,
    maxEconomyEvaluations,
    maxTotalEconomyCandidatesEvaluated,
    maxTotalPrefabAnalyses,
    maxTotalMineralPairAnalyses,
    maxTotalRegionalPairAnalyses,
    totalPairCapHits,
    maxPairCapHits,
    totalRegionalPairCapHits,
    maxRegionalPairCapHits,
    maxRegionalConstructionCost,
    maxRegionalSteelReferenceActiveTicks,
    maxRegionalModuleReferenceActiveTicks,
    minimumRegionalSteelMargin: Number.isFinite(minimumRegionalSteelMargin)
      ? minimumRegionalSteelMargin
      : 0,
    minimumRegionalModuleMargin: Number.isFinite(minimumRegionalModuleMargin)
      ? minimumRegionalModuleMargin
      : 0,
    maxJointWorkUnits,
    maxGenerationDurationMs,
    firstSlowestSeed,
    firstWorstSeed,
    durationMs: performance.now() - startedAt,
  };
}

function measuredSeedPayload(seed: string) {
  const startedAt = performance.now();
  const result = generate(seed);
  const witnessDurationMs = performance.now() - startedAt;
  return {
    seed,
    witnessDurationMs,
    attemptsCap: MAX_OPPORTUNITY_ATTEMPTS,
    candidatesCap: MAX_SITE_CANDIDATES_PER_ATTEMPT,
    economyCandidatesCap: MAX_ECONOMY_SITE_CANDIDATES,
    analysisSamplesCap: MAX_ANALYSIS_SAMPLES,
    opportunityResult: result.opportunityResult,
    economyResult: result.economyResult,
    prefabWitnessCost: result.prefabWitnessCost,
    cementSupplyWitnessCost: result.cementSupplyWitnessCost,
    starterCorridorCost: result.starterCorridorCost,
    economyEvaluations: result.economyEvaluations,
    totalEconomyCandidatesEvaluated:
      result.totalEconomyCandidatesEvaluated,
    totalPrefabAnalyses: result.totalPrefabAnalyses,
    totalMineralPairAnalyses: result.totalMineralPairAnalyses,
    totalRegionalPairAnalyses: result.totalRegionalPairAnalyses,
    mineralPairAnalysesCap: MAX_CEMENT_SUPPLY_PAIR_ANALYSES,
    regionalPairAnalysesCap: MAX_REGIONAL_PAIR_ANALYSES,
    starterCorridorCostCap: MAX_STARTER_CORRIDOR_COST,
    cementSupplyLinkCostCap: MAX_CEMENT_SUPPLY_LINK_COST,
    regionalConstructionLinkCostCap:
      MAX_REGIONAL_CONSTRUCTION_LINK_COST,
    regionalConstructionWitness: result.regionalConstructionWitness,
    blankInfrastructure: result.blankInfrastructure,
  };
}

declare global {
  interface Window {
    __probeWorldGenerationSeeds?: (
      seeds: readonly string[],
    ) => Array<Record<string, unknown>>;
    __auditWorldGenerationRange?: (
      auditRange: Readonly<WorldGenerationAuditRange>,
    ) => Promise<Awaited<ReturnType<typeof auditJointSeeds>>>;
    __measureWorldGenerationSeed?: (
      seed: string,
    ) => ReturnType<typeof measuredSeedPayload>;
    __runWorldGenerationBenchmark?: (
      auditRange?: Readonly<WorldGenerationAuditRange>,
    ) => Promise<{
      seed: string;
      durationMs: number;
      jointAudit: Awaited<ReturnType<typeof auditJointSeeds>>;
      attemptsCap: number;
      candidatesCap: number;
      economyCandidatesCap: number;
      analysisSamplesCap: number;
      opportunityResult: ReturnType<typeof generate>['opportunityResult'];
      economyResult: ReturnType<typeof generate>['economyResult'];
      prefabWitnessCost: number | null;
      cementSupplyWitnessCost: number | null;
      starterCorridorCost: number;
      economyEvaluations: number;
      totalEconomyCandidatesEvaluated: number;
      totalPrefabAnalyses: number;
      totalMineralPairAnalyses: number;
      totalRegionalPairAnalyses: number;
      mineralPairAnalysesCap: number;
      regionalPairAnalysesCap: number;
      starterCorridorCostCap: number;
      cementSupplyLinkCostCap: number;
      regionalConstructionLinkCostCap: number;
      regionalConstructionWitness: {
        totalCost: number;
        steelReferenceActiveTicks: number;
        moduleReferenceActiveTicks: number;
        minimumSteelMargin: number;
        minimumModuleMargin: number;
      } | null;
      blankInfrastructure: boolean;
      deterministicReplay: boolean;
    }>;
  }
}

window.__probeWorldGenerationSeeds = (seeds) => seeds.map((seed) => {
  const startedAt = performance.now();
  try {
    const result = generate(seed);
    return {
      seed,
      ok: true,
      durationMs: performance.now() - startedAt,
      resolvedAttempt: result.opportunityResult.opportunity.resolvedAttempt,
      economyEvaluations: result.economyEvaluations,
    };
  } catch (error) {
    return {
      seed,
      ok: false,
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

window.__auditWorldGenerationRange = auditJointSeeds;
window.__measureWorldGenerationSeed = measuredSeedPayload;

window.__runWorldGenerationBenchmark = async (
  auditRange = DEFAULT_WORLD_GENERATION_AUDIT_RANGE,
) => {
  const jointAudit = await auditJointSeeds(auditRange);
  const seed = jointAudit.firstSlowestSeed;
  if (!seed) {
    throw new Error(`joint audit resolved no seed: ${JSON.stringify(
      jointAudit,
    )}`);
  }
  const measurement = measuredSeedPayload(seed);
  const replay = generate(seed);
  return {
    ...measurement,
    durationMs: measurement.witnessDurationMs,
    jointAudit,
    deterministicReplay: JSON.stringify({
      opportunityResult: replay.opportunityResult,
      economyResult: replay.economyResult,
      prefabWitnessCost: replay.prefabWitnessCost,
      cementSupplyWitnessCost: replay.cementSupplyWitnessCost,
      starterCorridorCost: replay.starterCorridorCost,
      economyEvaluations: replay.economyEvaluations,
      totalEconomyCandidatesEvaluated:
        replay.totalEconomyCandidatesEvaluated,
      totalPrefabAnalyses: replay.totalPrefabAnalyses,
      totalMineralPairAnalyses: replay.totalMineralPairAnalyses,
      totalRegionalPairAnalyses: replay.totalRegionalPairAnalyses,
      regionalConstructionWitness: replay.regionalConstructionWitness,
      blankInfrastructure: replay.blankInfrastructure,
    }) === JSON.stringify({
      opportunityResult: measurement.opportunityResult,
      economyResult: measurement.economyResult,
      prefabWitnessCost: measurement.prefabWitnessCost,
      cementSupplyWitnessCost: measurement.cementSupplyWitnessCost,
      starterCorridorCost: measurement.starterCorridorCost,
      economyEvaluations: measurement.economyEvaluations,
      totalEconomyCandidatesEvaluated:
        measurement.totalEconomyCandidatesEvaluated,
      totalPrefabAnalyses: measurement.totalPrefabAnalyses,
      totalMineralPairAnalyses: measurement.totalMineralPairAnalyses,
      totalRegionalPairAnalyses: measurement.totalRegionalPairAnalyses,
      regionalConstructionWitness: measurement.regionalConstructionWitness,
      blankInfrastructure: measurement.blankInfrastructure,
    }),
  };
};
