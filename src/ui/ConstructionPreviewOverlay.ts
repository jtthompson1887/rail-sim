import Phaser from 'phaser';
import type { StructureType } from '../config/WorldData';
import type {
  PredictedEndpointConnectionDef,
} from '../systems/ConstructionService';
import type { ConstructionProposal } from '../systems/ConstructionAnalyzer';
import { createTrackGeometry } from '../systems/TrackGeometry';

export type ConstructionToolPhase =
  | 'idle'
  | 'dragging'
  | 'review'
  | 'committed'
  | 'chained';

export interface ConstructionPreviewModel {
  readonly phase: ConstructionToolPhase;
  readonly proposal: ConstructionProposal;
  readonly predictedConnections: ReadonlyArray<PredictedEndpointConnectionDef>;
  readonly totalCost: number;
  readonly affordable: boolean;
  readonly canConfirm: boolean;
  readonly stale: boolean;
  readonly message: string;
  readonly actions: ReadonlyArray<'confirm' | 'backstep' | 'cancel'>;
}

export interface ConstructionPreviewEvent {
  readonly phase: ConstructionToolPhase;
  readonly preview: ConstructionPreviewModel | null;
}

interface PreviewLineStyle {
  readonly width: number;
  readonly color: number;
  readonly alpha: number;
}

export const PREVIEW_STRUCTURE_STYLES: Readonly<Record<
  StructureType,
  PreviewLineStyle
>> = Object.freeze({
  surface: Object.freeze({ width: 5, color: 0x58d6ff, alpha: 0.95 }),
  cut: Object.freeze({ width: 6, color: 0xffa24a, alpha: 0.95 }),
  fill: Object.freeze({ width: 6, color: 0xd6c45a, alpha: 0.95 }),
  bridge: Object.freeze({ width: 7, color: 0x5f8dff, alpha: 1 }),
  tunnel: Object.freeze({ width: 7, color: 0xb784ff, alpha: 0.7 }),
});
export const INVALID_PREVIEW_STYLE: Readonly<PreviewLineStyle> = Object.freeze({
  width: 5,
  color: 0xff5c70,
  alpha: 0.9,
});

const CURVE_DRAW_INTERVALS = 64;
const ENDPOINT_COLOR = 0xffffff;
const GRADE_MARKER_COLOR = 0xff5c70;
const CONNECTION_COLOR = 0x58ffad;

/**
 * Reusable, world-space engineering preview. It draws only into one Graphics
 * object; no live RailTrack or physics objects are created during pointer move.
 */
export class ConstructionPreviewOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics()
      .setDepth(598)
      .setScrollFactor(1);
  }

  render(model: ConstructionPreviewModel): void {
    this.graphics.clear();
    const geometry = createTrackGeometry(model.proposal.geometry);

    const intervals = model.proposal.structures.length > 0
      ? model.proposal.structures.map((interval) => ({
        startT: interval.startT,
        endT: interval.endT,
        style: PREVIEW_STRUCTURE_STYLES[interval.type],
      }))
      : [{ startT: 0, endT: 1, style: INVALID_PREVIEW_STYLE }];
    for (const interval of intervals) {
      const style = interval.style;
      const intervalCount = Math.max(
        1,
        Math.ceil((interval.endT - interval.startT) * CURVE_DRAW_INTERVALS),
      );
      this.graphics.lineStyle(style.width, style.color, style.alpha);
      this.graphics.beginPath();
      const start = geometry.pointAt(interval.startT);
      this.graphics.moveTo(start.x, start.y);
      for (let index = 1; index <= intervalCount; index++) {
        const t = interval.startT
          + (interval.endT - interval.startT) * (index / intervalCount);
        const point = geometry.pointAt(t);
        this.graphics.lineTo(point.x, point.y);
      }
      this.graphics.strokePath();
    }

    this.graphics.fillStyle(ENDPOINT_COLOR, 1);
    this.graphics.fillCircle(
      model.proposal.geometry.p0.x,
      model.proposal.geometry.p0.y,
      5,
    );
    this.graphics.fillCircle(
      model.proposal.geometry.p3.x,
      model.proposal.geometry.p3.y,
      5,
    );

    const steepest = geometry.pointAt(model.proposal.maximumGradeT);
    this.graphics.fillStyle(GRADE_MARKER_COLOR, 1);
    this.graphics.fillCircle(steepest.x, steepest.y, 4);

    this.graphics.fillStyle(CONNECTION_COLOR, 1);
    for (const connection of model.predictedConnections) {
      this.graphics.fillCircle(connection.point.x, connection.point.y, 7);
    }
  }

  clear(): void {
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
