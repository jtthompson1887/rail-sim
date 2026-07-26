import {
  deriveVerticalAlignment,
  elevationAtProfile,
  type TerrainProfileSample,
} from '../../src/systems/VerticalAlignment';
import { ConstructionConfig } from '../../src/config/ConstructionConfig';

function samples(elevations: number[], spacing = 64): TerrainProfileSample[] {
  const finalDistance = spacing * (elevations.length - 1);
  return elevations.map((terrainElevation, index) => ({
    t: index / (elevations.length - 1),
    distance: index * spacing,
    terrainElevation,
    point: { x: index * spacing, y: 0 },
    segmentLength: index === 0 ? 0 : spacing,
    totalLength: finalDistance,
  }));
}

describe('deriveVerticalAlignment', () => {
  it('produces a finite, ordered version-1 profile with exact endpoints', () => {
    const result = deriveVerticalAlignment(samples([25, 40, 10, 55, 30]));

    expect(result.verticalProfile.profileVersion).toBe(1);
    expect(result.verticalProfile.knots.length).toBeGreaterThanOrEqual(2);
    expect(result.verticalProfile.knots[0]).toEqual({ t: 0, elevation: 25 });
    expect(result.verticalProfile.knots.at(-1)).toEqual({ t: 1, elevation: 30 });
    expect(result.verticalProfile.knots.every(
      (knot) => Number.isFinite(knot.t) && Number.isFinite(knot.elevation),
    )).toBe(true);
    for (let index = 1; index < result.verticalProfile.knots.length; index++) {
      expect(result.verticalProfile.knots[index].t)
        .toBeGreaterThan(result.verticalProfile.knots[index - 1].t);
    }
  });

  it('rejects samples that do not cover the complete 0-to-1 profile domain', () => {
    const incompleteStart = samples([0, 0, 0]);
    incompleteStart[0].t = 0.1;
    const incompleteEnd = samples([0, 0, 0]);
    incompleteEnd[incompleteEnd.length - 1].t = 0.9;

    expect(() => deriveVerticalAlignment(incompleteStart)).toThrow(
      'start at t=0 and end at t=1',
    );
    expect(() => deriveVerticalAlignment(incompleteEnd)).toThrow(
      'start at t=0 and end at t=1',
    );
  });

  it('smooths rolling terrain while keeping every adjacent grade bounded', () => {
    const terrain = samples([0, 30, 0, -30, 0, 30, 0]);
    const result = deriveVerticalAlignment(terrain);

    expect(result.sampleElevations).not.toEqual(terrain.map((sample) => sample.terrainElevation));
    expect(result.maximumGradePercent).toBeLessThanOrEqual(
      ConstructionConfig.MAX_GRADE_PERCENT + 1e-9,
    );
    for (let index = 1; index < result.sampleElevations.length; index++) {
      const rise = Math.abs(result.sampleElevations[index] - result.sampleElevations[index - 1]);
      expect((rise / 64) * 100).toBeLessThanOrEqual(
        ConstructionConfig.MAX_GRADE_PERCENT + 1e-9,
      );
    }
  });

  it('reports an infeasible endpoint grade and its steepest location', () => {
    const result = deriveVerticalAlignment(samples([0, 0, 0, 80]));

    expect(result.maximumGradePercent).toBeCloseTo((80 / 192) * 100, 8);
    expect(result.maximumGradeT).toBe(1);
  });

  it('interpolates elevations from the exact persisted profile', () => {
    const profile = {
      profileVersion: 1 as const,
      knots: [
        { t: 0, elevation: 10 },
        { t: 0.25, elevation: 30 },
        { t: 1, elevation: 0 },
      ],
    };

    expect(elevationAtProfile(profile, 0)).toBe(10);
    expect(elevationAtProfile(profile, 0.125)).toBe(20);
    expect(elevationAtProfile(profile, 0.625)).toBe(15);
    expect(elevationAtProfile(profile, 1)).toBe(0);
  });
});
