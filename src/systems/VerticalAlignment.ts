import {
  ConstructionConfig,
} from '../config/ConstructionConfig';
import type { Vec2Def, VerticalProfileDef } from '../config/WorldData';

export interface TerrainProfileSample {
  t: number;
  distance: number;
  terrainElevation: number;
  point: Vec2Def;
  segmentLength: number;
  totalLength: number;
}

export interface VerticalAlignmentResult {
  verticalProfile: VerticalProfileDef;
  sampleElevations: number[];
  maximumGradePercent: number;
  maximumGradeT: number;
}

function assertSamples(samples: TerrainProfileSample[]): void {
  if (samples.length < 2) {
    throw new RangeError('Vertical alignment requires at least two terrain samples.');
  }
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    if (!Number.isFinite(sample.t)
      || !Number.isFinite(sample.distance)
      || !Number.isFinite(sample.terrainElevation)
      || (index > 0 && sample.t <= samples[index - 1].t)
      || (index > 0 && sample.distance <= samples[index - 1].distance)) {
      throw new RangeError('Vertical alignment samples must be finite and strictly ordered.');
    }
  }
  if (samples[0].t !== 0 || samples[samples.length - 1].t !== 1) {
    throw new RangeError('Vertical alignment samples must start at t=0 and end at t=1.');
  }
}

function linearEndpointProfile(samples: TerrainProfileSample[]): number[] {
  const start = samples[0];
  const end = samples[samples.length - 1];
  const totalDistance = end.distance - start.distance;
  return samples.map((sample) => {
    const ratio = totalDistance === 0
      ? sample.t
      : (sample.distance - start.distance) / totalDistance;
    return start.terrainElevation
      + (end.terrainElevation - start.terrainElevation) * ratio;
  });
}

function smoothTerrain(samples: TerrainProfileSample[]): number[] {
  const values = samples.map((sample) => sample.terrainElevation);
  const smoothed = values.map((_, index) => {
    if (index === 0 || index === values.length - 1) return values[index];
    const start = Math.max(0, index - 2);
    const end = Math.min(values.length - 1, index + 2);
    let total = 0;
    for (let cursor = start; cursor <= end; cursor++) total += values[cursor];
    return total / (end - start + 1);
  });
  smoothed[0] = values[0];
  smoothed[smoothed.length - 1] = values[values.length - 1];
  return smoothed;
}

function constrainGrades(samples: TerrainProfileSample[], values: number[]): void {
  const maximumGrade = ConstructionConfig.MAX_GRADE_PERCENT / 100;
  const finalIndex = values.length - 1;

  for (let pass = 0; pass < values.length; pass++) {
    for (let index = 1; index < finalIndex; index++) {
      const maximumRise = (samples[index].distance - samples[index - 1].distance)
        * maximumGrade;
      values[index] = Math.max(
        values[index - 1] - maximumRise,
        Math.min(values[index - 1] + maximumRise, values[index]),
      );
    }
    for (let index = finalIndex - 1; index > 0; index--) {
      const maximumRise = (samples[index + 1].distance - samples[index].distance)
        * maximumGrade;
      values[index] = Math.max(
        values[index + 1] - maximumRise,
        Math.min(values[index + 1] + maximumRise, values[index]),
      );
    }
  }
}

function profileFromSamples(
  samples: TerrainProfileSample[],
  elevations: number[],
): VerticalProfileDef {
  const knots = samples.map((sample, index) => ({
    t: sample.t,
    elevation: elevations[index],
  }));
  const compact = [knots[0]];

  for (let index = 1; index < knots.length - 1; index++) {
    const previous = compact[compact.length - 1];
    const current = knots[index];
    const next = knots[index + 1];
    const before = (current.elevation - previous.elevation) / (current.t - previous.t);
    const after = (next.elevation - current.elevation) / (next.t - current.t);
    if (Math.abs(before - after) > 1e-10) compact.push(current);
  }
  compact.push(knots[knots.length - 1]);

  return { profileVersion: 1, knots: compact };
}

function maximumGrade(
  samples: TerrainProfileSample[],
  elevations: number[],
): { maximumGradePercent: number; maximumGradeT: number } {
  let result = 0;
  let resultT = 0;
  for (let index = 1; index < samples.length; index++) {
    const run = samples[index].distance - samples[index - 1].distance;
    const grade = run > 0
      ? Math.abs(elevations[index] - elevations[index - 1]) / run * 100
      : 0;
    if (grade >= result) {
      result = grade;
      resultT = samples[index].t;
    }
  }
  return { maximumGradePercent: result, maximumGradeT: resultT };
}

export function deriveVerticalAlignment(
  samples: TerrainProfileSample[],
): VerticalAlignmentResult {
  assertSamples(samples);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const totalDistance = last.distance - first.distance;
  const endpointGrade = Math.abs(last.terrainElevation - first.terrainElevation)
    / totalDistance * 100;
  const sampleElevations = endpointGrade > ConstructionConfig.MAX_GRADE_PERCENT
    ? linearEndpointProfile(samples)
    : smoothTerrain(samples);

  if (endpointGrade <= ConstructionConfig.MAX_GRADE_PERCENT) {
    constrainGrades(samples, sampleElevations);
  }

  const grade = maximumGrade(samples, sampleElevations);
  return {
    verticalProfile: profileFromSamples(samples, sampleElevations),
    sampleElevations,
    ...grade,
  };
}

export function elevationAtProfile(
  profile: VerticalProfileDef,
  rawT: number,
): number {
  const t = Math.max(0, Math.min(1, rawT));
  const knots = profile.knots;
  if (t <= knots[0].t) return knots[0].elevation;
  for (let index = 1; index < knots.length; index++) {
    const end = knots[index];
    if (t <= end.t) {
      const start = knots[index - 1];
      const ratio = (t - start.t) / (end.t - start.t);
      return start.elevation + (end.elevation - start.elevation) * ratio;
    }
  }
  return knots[knots.length - 1].elevation;
}
