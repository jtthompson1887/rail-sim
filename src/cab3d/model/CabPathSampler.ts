import type { StructureType } from './CabWorldSnapshot';
import type { CabTrackSample } from './CabWorldSnapshot';
import { curvatureFromPoints } from './CabCurvature';

export interface CabPathPoint2D {
  x: number;
  y: number;
}

export interface CabPathTangent2D {
  x: number;
  y: number;
}

/**
 * A single span of the cab-view track path, parameterised from u=0 to u=1 in
 * the direction of travel.  Spans are ordered from the most negative distance
 * (behind the eye) to the most positive distance (ahead of the eye).
 */
export interface CabPathSpan {
  /** Length of this span in metres. */
  readonly length: number;
  /** Distance from the eye at u=0. */
  readonly startDistance: number;
  /** Distance from the eye at u=1. */
  readonly endDistance: number;
  /** Point at parameter u along the span, in world metres. */
  pointAt(u: number): CabPathPoint2D;
  /** Normalised tangent at parameter u, in the direction of travel. */
  tangentAt(u: number): CabPathTangent2D;
  /** Elevation at parameter u, in metres. */
  elevationAt(u: number): number;
  /** Structure at parameter u. */
  structureAt(u: number): StructureType;
}

export interface CabPathSampleOptions {
  /** Distance at the first sample, in metres (normally negative). */
  near: number;
  /** Distance at the last sample, in metres. */
  far: number;
  /** Spacing between consecutive samples, in metres. */
  spacing: number;
}

/**
 * Pure cab-view path sampler.
 *
 * Walks a chain of {@link CabPathSpan}s and produces arc-length reparametrised
 * track samples at a fixed spacing.  Curvature is computed from each sample and
 * its two neighbours.
 */
export class CabPathSampler {
  sample(
    spans: readonly CabPathSpan[],
    options: CabPathSampleOptions,
  ): ReadonlyArray<CabTrackSample> {
    const { near, far, spacing } = options;
    if (spacing <= 0 || far < near || spans.length === 0) {
      return Object.freeze([]);
    }

    const sampleCount = Math.round((far - near) / spacing);
    if (sampleCount < 0) return Object.freeze([]);

    const rawPoints: CabPathPoint2D[] = [];
    const rawSamples: Omit<CabTrackSample, 'curvature'>[] = [];

    let spanIndex = 0;

    for (let i = 0; i <= sampleCount; i++) {
      const distance = near + i * spacing;
      const { span, u } = this.findSpanAndU(spans, distance, spanIndex);

      const point = span.pointAt(u);
      const tangent = span.tangentAt(u);
      const elevation = span.elevationAt(u);
      const structure = span.structureAt(u);
      const headingRad = Math.atan2(tangent.y, tangent.x);

      rawPoints.push(point);
      rawSamples.push({
        x: point.x,
        y: point.y,
        elevation,
        headingRad,
        structure,
        distance,
      });

      // The spans are ordered by distance, so the next sample will either use
      // the same span or a later one.
      if (spanIndex < spans.length - 1 && distance > spans[spanIndex].endDistance) {
        spanIndex++;
      }
    }

    const finalSamples: CabTrackSample[] = rawSamples.map((sample, index) => ({
      ...sample,
      curvature: this.curvatureAt(rawPoints, index),
    }));

    return Object.freeze(finalSamples);
  }

  private findSpanAndU(
    spans: readonly CabPathSpan[],
    distance: number,
    startIndex: number,
  ): { span: CabPathSpan; u: number } {
    let index = Math.max(0, Math.min(startIndex, spans.length - 1));

    // Search forward if the distance is beyond the current span.
    while (index < spans.length - 1 && distance > spans[index].endDistance) {
      index++;
    }
    // Search backward if the distance is before the current span.
    while (index > 0 && distance < spans[index].startDistance) {
      index--;
    }

    const span = spans[index];
    const clampedDistance = Math.max(
      span.startDistance,
      Math.min(span.endDistance, distance),
    );
    const u =
      span.length > 0
        ? (clampedDistance - span.startDistance) / span.length
        : 0;

    return { span, u: Math.max(0, Math.min(1, u)) };
  }

  private curvatureAt(
    points: readonly CabPathPoint2D[],
    index: number,
  ): number {
    if (index === 0 || index === points.length - 1) return 0;
    return curvatureFromPoints(points[index - 1], points[index], points[index + 1]);
  }
}
