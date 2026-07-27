/**
 * @jest-environment jsdom
 */
import {
  MAX_ECONOMY_SITE_CANDIDATES,
} from '../../src/config/WorldGeneration';
import './world-generation-browser-entry';

describe('world generation browser harness', () => {
  it('measures opportunity and bounded economy generation together', () => {
    const measurement = window.__runWorldGenerationBenchmark!();

    expect(measurement.jointAudit.seedsEvaluated).toBe(284);
    expect(measurement.seed)
      .toBe(measurement.jointAudit.firstWorstSeed);
    expect(
      measurement.opportunityResult.opportunity.resolvedAttempt
        * measurement.candidatesCap
        + measurement.totalEconomyCandidatesEvaluated,
    ).toBe(measurement.jointAudit.maxJointWorkUnits);
    expect(measurement.jointAudit.maxGenerationDurationMs)
      .toBeLessThan(2_000);
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
    expect(measurement.economyEvaluations).toBeGreaterThanOrEqual(1);
    expect(measurement.totalEconomyCandidatesEvaluated)
      .toBeGreaterThanOrEqual(
        measurement.economyResult.diagnostics.candidatesEvaluated,
      );
    expect(measurement.blankInfrastructure).toBe(true);
    expect(measurement.deterministicReplay).toBe(true);
  });
});
