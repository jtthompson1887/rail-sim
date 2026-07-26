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

    expect(measurement.opportunityAudit.seedsEvaluated).toBe(284);
    expect(measurement.seed)
      .toBe(measurement.opportunityAudit.firstWorstSeed);
    expect(measurement.opportunityResult.opportunity.resolvedAttempt)
      .toBe(measurement.opportunityAudit.maxResolvedAttempt);
    expect(measurement.economyCandidatesCap)
      .toBe(MAX_ECONOMY_SITE_CANDIDATES);
    expect(measurement.opportunityResult.ok).toBe(true);
    expect(measurement.economyResult.ok).toBe(true);
    if (!measurement.economyResult.ok) return;
    expect(measurement.economyResult.economy.facilities).toHaveLength(7);
    expect(measurement.economyResult.diagnostics.candidatesEvaluated)
      .toBeLessThanOrEqual(MAX_ECONOMY_SITE_CANDIDATES);
    expect(measurement.deterministicReplay).toBe(true);
  });
});
