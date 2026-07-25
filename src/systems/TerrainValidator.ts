import Phaser from 'phaser';
import type { TerrainGenerator } from './TerrainGenerator';
import type TrackManager from '../managers/TrackManager';
import {
  ConstructionAnalyzer,
  type ConstructionProposal,
} from './ConstructionAnalyzer';
import { deriveAutomaticCubic, type TrackGeometryDef } from './TrackGeometry';

export type TrackValidationResult = ConstructionProposal;

/**
 * Phaser-facing compatibility adapter around the pure ConstructionAnalyzer.
 * Vector and live-tangent adaptation stays here; engineering rules stay pure.
 */
export class TerrainValidator {
  private readonly analyser: ConstructionAnalyzer;

  constructor(terrain: TerrainGenerator) {
    this.analyser = new ConstructionAnalyzer(terrain);
  }

  canPlaceTrack(
    p0: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    sampleCount?: number,
  ): TrackValidationResult;
  canPlaceTrack(
    p0: Phaser.Math.Vector2,
    p1: Phaser.Math.Vector2,
    p2: Phaser.Math.Vector2,
    p3: Phaser.Math.Vector2,
    sampleCount?: number,
    trackManager?: TrackManager | null,
  ): TrackValidationResult;
  canPlaceTrack(
    p0: Phaser.Math.Vector2,
    p1OrP3: Phaser.Math.Vector2,
    p2OrCount?: Phaser.Math.Vector2 | number,
    p3OrCount?: Phaser.Math.Vector2 | number,
    _sampleCount = 20,
    trackManager: TrackManager | null = null,
  ): TrackValidationResult {
    let geometry: TrackGeometryDef;
    let manager: TrackManager | null;

    if (p3OrCount instanceof Phaser.Math.Vector2) {
      const p2 = p2OrCount as Phaser.Math.Vector2;
      geometry = {
        geometryVersion: 1,
        p0: { x: p0.x, y: p0.y },
        p1: { x: p1OrP3.x, y: p1OrP3.y },
        p2: { x: p2.x, y: p2.y },
        p3: { x: p3OrCount.x, y: p3OrCount.y },
      };
      manager = trackManager;
    } else {
      geometry = deriveAutomaticCubic({
        start: { x: p0.x, y: p0.y },
        end: { x: p1OrP3.x, y: p1OrP3.y },
      });
      manager = null;
    }

    const connectionAngleDeg = manager
      ? this.connectionAngle(geometry, manager)
      : 0;
    return this.analyser.analyze(geometry, { connectionAngleDeg });
  }

  private connectionAngle(
    geometry: TrackGeometryDef,
    trackManager: TrackManager,
  ): number {
    const p0 = new Phaser.Math.Vector2(geometry.p0.x, geometry.p0.y);
    const near = trackManager.findEndpointNear(p0, 60);
    if (!near) return 0;
    const dx = geometry.p1.x - geometry.p0.x;
    const dy = geometry.p1.y - geometry.p0.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return 0;
    const dot = Math.max(-1, Math.min(
      1,
      dx / length * near.tangent.x + dy / length * near.tangent.y,
    ));
    return Math.acos(dot) * (180 / Math.PI);
  }
}
