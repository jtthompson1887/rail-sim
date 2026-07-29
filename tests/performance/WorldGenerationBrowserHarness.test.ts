/**
 * @jest-environment jsdom
 */
import {
  MAX_ECONOMY_SITE_CANDIDATES,
} from '../../src/config/WorldGeneration';
import {
  DEFAULT_WORLD_GENERATION_AUDIT_RANGE,
} from './world-generation-browser-entry';

describe('world generation browser harness', () => {
  it('measures opportunity and bounded economy generation together', () => {
    expect(DEFAULT_WORLD_GENERATION_AUDIT_RANGE).toEqual({
      start: 601,
      end: 884,
    });
    const measurement = window.__runWorldGenerationBenchmark!({
      start: 633,
      end: 633,
    });

    expect(measurement.jointAudit.seedsEvaluated).toBe(1);
    expect(measurement.jointAudit.range).toEqual({
      startSeed: 'playtest-633',
      endSeed: 'playtest-633',
    });
    expect(measurement.seed)
      .toBe(measurement.jointAudit.firstWorstSeed);
    expect(
      measurement.opportunityResult.opportunity.resolvedAttempt
        * measurement.candidatesCap
        + measurement.totalEconomyCandidatesEvaluated,
    ).toBe(measurement.jointAudit.maxJointWorkUnits);
    expect(Number.isFinite(
      measurement.jointAudit.maxGenerationDurationMs,
    )).toBe(true);
    expect(measurement.economyCandidatesCap)
      .toBe(MAX_ECONOMY_SITE_CANDIDATES);
    expect(measurement.opportunityResult.ok).toBe(true);
    expect(measurement.economyResult.ok).toBe(true);
    if (!measurement.economyResult.ok) return;
    expect(measurement.economyResult.economy.facilities).toHaveLength(7);
    expect(measurement.economyResult.diagnostics.candidatesEvaluated)
      .toBeLessThanOrEqual(MAX_ECONOMY_SITE_CANDIDATES);
    expect(measurement.prefabWitnessCost).not.toBeNull();
    expect(measurement.prefabWitnessCost).toBeLessThanOrEqual(194_000);
    expect(measurement.starterCorridorCost)
      .toBeLessThanOrEqual(measurement.starterCorridorCostCap);
    expect(measurement.cementSupplyWitnessCost).not.toBeNull();
    expect(measurement.cementSupplyWitnessCost)
      .toBeLessThanOrEqual(measurement.cementSupplyLinkCostCap);
    expect(measurement.totalMineralPairAnalyses)
      .toBeLessThanOrEqual(
        measurement.economyEvaluations * measurement.mineralPairAnalysesCap,
      );
    expect(measurement.economyEvaluations).toBeGreaterThanOrEqual(1);
    expect(measurement.totalEconomyCandidatesEvaluated)
      .toBeGreaterThanOrEqual(
        measurement.economyResult.diagnostics.candidatesEvaluated,
      );
    expect(measurement.blankInfrastructure).toBe(true);
    expect(measurement.deterministicReplay).toBe(true);
  });
});
