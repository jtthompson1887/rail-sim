import { elevationAtProfile } from './VerticalAlignment';
import type { ConstructionAnalysisDetail } from './ConstructionAnalyzer';

export const ENGINEERED_GRADE_COMPARISON_EPSILON = 1e-9;

export function meanAbsoluteEngineeredGrade(
  details: readonly ConstructionAnalysisDetail[],
): number {
  let absoluteRise = 0;
  let length = 0;
  for (const { proposal, curveSamples } of details) {
    for (let index = 1; index < curveSamples.length; index++) {
      const start = curveSamples[index - 1];
      const end = curveSamples[index];
      absoluteRise += Math.abs(
        elevationAtProfile(proposal.verticalProfile, end.t)
          - elevationAtProfile(proposal.verticalProfile, start.t),
      );
      length += end.segmentLength;
    }
  }
  return length > 0 ? absoluteRise / length * 100 : Infinity;
}
