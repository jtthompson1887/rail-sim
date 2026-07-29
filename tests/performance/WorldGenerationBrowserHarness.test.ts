/**
 * @jest-environment jsdom
 */
import {
  MAX_ECONOMY_SITE_CANDIDATES,
} from '../../src/config/WorldGeneration';
import { WorldManager } from '../../src/managers/WorldManager';
import {
  DEFAULT_WORLD_GENERATION_AUDIT_RANGE,
} from './world-generation-browser-entry';
import * as RegionalConstructionOpportunity
  from '../../src/economy/RegionalConstructionOpportunity';

describe('world generation browser harness', () => {
  it('measures opportunity and bounded economy generation together', async () => {
    expect(DEFAULT_WORLD_GENERATION_AUDIT_RANGE).toEqual({
      start: 601,
      end: 884,
    });
    const compactAudit = await window.__auditWorldGenerationRange!({
      start: 633,
      end: 633,
    });
    expect(compactAudit).toEqual(expect.objectContaining({
      range: {
        startSeed: 'playtest-633',
        endSeed: 'playtest-633',
      },
      seedsEvaluated: 1,
      seedsResolved: 1,
      seedsExhausted: 0,
    }));
    const measuredSeed = window.__measureWorldGenerationSeed!(
      'playtest-633',
    );
    expect(measuredSeed).toEqual(expect.objectContaining({
      seed: 'playtest-633',
      witnessDurationMs: expect.any(Number),
      opportunityResult: expect.objectContaining({ ok: true }),
      economyResult: expect.objectContaining({ ok: true }),
    }));
    expect(measuredSeed.witnessDurationMs).toBeGreaterThan(0);
    const measurement = await window.__runWorldGenerationBenchmark!({
      start: 633,
      end: 633,
    });

    expect(measurement.jointAudit.seedsEvaluated).toBe(1);
    expect(measurement.jointAudit.range).toEqual({
      startSeed: 'playtest-633',
      endSeed: 'playtest-633',
    });
    expect(measurement.seed)
      .toBe(measurement.jointAudit.firstSlowestSeed);
    expect(
      measurement.opportunityResult.opportunity.resolvedAttempt
        * measurement.candidatesCap
        + measurement.totalEconomyCandidatesEvaluated,
    ).toBeLessThanOrEqual(measurement.jointAudit.maxJointWorkUnits);
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
    expect((measurement as any).regionalConstructionWitness).toEqual(
      expect.objectContaining({
        totalCost: expect.any(Number),
        steelReferenceActiveTicks: expect.any(Number),
        moduleReferenceActiveTicks: expect.any(Number),
        minimumSteelMargin: expect.any(Number),
        minimumModuleMargin: expect.any(Number),
      }),
    );
    expect((measurement as any).regionalConstructionWitness.totalCost)
      .toBeLessThanOrEqual(
        (measurement as any).regionalConstructionLinkCostCap,
      );
    expect(measurement.jointAudit.maxRegionalConstructionCost)
      .toBe(measurement.economyResult.diagnostics.regionalTotalCost);
    expect(measurement.jointAudit.maxRegionalSteelReferenceActiveTicks)
      .toBe(
        measurement.economyResult.diagnostics
          .regionalSteelReferenceActiveTicks,
      );
    expect(measurement.jointAudit.maxRegionalModuleReferenceActiveTicks)
      .toBe(
        measurement.economyResult.diagnostics
          .regionalModuleReferenceActiveTicks,
      );
    expect(measurement.jointAudit.minimumRegionalSteelMargin)
      .toBe(measurement.economyResult.diagnostics.regionalMinimumSteelMargin);
    expect(measurement.jointAudit.minimumRegionalModuleMargin)
      .toBe(measurement.economyResult.diagnostics.regionalMinimumModuleMargin);
    expect((measurement as any).totalRegionalPairAnalyses)
      .toBeLessThanOrEqual(
        measurement.economyEvaluations
          * (measurement as any).regionalPairAnalysesCap,
      );
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

  it('yields between seeds without changing measured slowest telemetry', async () => {
    const originalTryCreateNew = WorldManager.tryCreateNew.bind(WorldManager);
    const createSpy = jest.spyOn(WorldManager, 'tryCreateNew')
      .mockImplementationOnce(() => {
        throw new Error('forced exhausted seed');
      })
      .mockImplementation((...args) => originalTryCreateNew(...args));
    const nowSpy = jest.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(101)
      .mockReturnValueOnce(101)
      .mockReturnValueOnce(101)
      .mockReturnValueOnce(102);
    const timeoutSpy = jest.spyOn(globalThis, 'setTimeout')
      .mockImplementation(((callback: () => void) => {
        callback();
        return 0;
      }) as typeof setTimeout);

    try {
      const measurement = await window.__runWorldGenerationBenchmark!({
        start: 633,
        end: 634,
      });

      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
      expect(measurement.jointAudit.seedsEvaluated).toBe(2);
      expect(measurement.jointAudit.seedsExhausted).toBe(1);
      expect(measurement.jointAudit.exhaustedSeeds)
        .toEqual(['playtest-633']);
      expect(measurement.jointAudit.firstSlowestSeed)
        .toBe('playtest-633');
      expect(measurement.jointAudit.maxGenerationDurationMs).toBe(100);
      expect(measurement.jointAudit.firstWorstSeed).toBe('playtest-634');
      expect(measurement.seed).toBe('playtest-633');
    } finally {
      timeoutSpy.mockRestore();
      nowSpy.mockRestore();
      createSpy.mockRestore();
    }
  });

  it('exhausts a seed when the production regional reference formula lies', async () => {
    const realCreate =
      RegionalConstructionOpportunity
        .createRegionalConstructionOpportunityAnalyzer;
    const regionalSpy = jest.spyOn(
      RegionalConstructionOpportunity,
      'createRegionalConstructionOpportunityAnalyzer',
    ).mockImplementation((...args) => {
      const analyze = realCreate(...args);
      if (!analyze) return null;
      return (sites) => {
        const witness = analyze(sites);
        return witness
          ? {
            ...witness,
            steelReferenceActiveTicks:
              witness.steelReferenceActiveTicks + 1,
            minimumSteelMargin: witness.minimumSteelMargin - 20,
          }
          : null;
      };
    });

    try {
      const audit = await window.__auditWorldGenerationRange!({
        start: 633,
        end: 633,
      });

      expect(audit.seedsResolved).toBe(0);
      expect(audit.seedsExhausted).toBe(1);
      expect(audit.exhaustedSeeds).toEqual(['playtest-633']);
      expect(audit.exhaustedErrors[0])
        .toContain('independent regional reference mismatch');
    } finally {
      regionalSpy.mockRestore();
    }
  });
});
