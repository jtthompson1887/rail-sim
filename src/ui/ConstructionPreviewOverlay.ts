import Phaser from 'phaser';
import type { StructureType } from '../config/WorldData';
import type {
  PredictedEndpointConnectionDef,
} from '../systems/ConstructionService';
import type { ConstructionProposal } from '../systems/ConstructionAnalyzer';
import { createTrackGeometry } from '../systems/TrackGeometry';
import type { ConstructionGuidanceDto } from '../freight/ConstructionGuidance';
import type { TrackDraftHandle } from '../systems/TrackDraft';

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
  readonly engineeringSubtotal: number;
  readonly topologyCost: number;
  readonly totalCost: number;
  readonly cashBefore: number;
  readonly cashAfter: number;
  readonly structureLengths: Readonly<Record<StructureType, number>>;
  readonly affordable: boolean;
  readonly canConfirm: boolean;
  readonly stale: boolean;
  readonly message: string;
  readonly actions: ReadonlyArray<'confirm' | 'backstep' | 'cancel'>;
  readonly guidance: ConstructionGuidanceDto;
  readonly breachesReserve: boolean;
  readonly draft?: {
    readonly selectedHandle: TrackDraftHandle | null;
    readonly startDirectionLocked: boolean;
    readonly endDirectionLocked: boolean;
    readonly canUndo: boolean;
  };
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

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics()
      .setDepth(598)
      .setScrollFactor(1);
  }

  render(model: ConstructionPreviewModel): void {
    this.graphics.clear();
    const geometry = createTrackGeometry(model.proposal.geometry);

    const intervals = model.proposal.valid && model.proposal.structures.length > 0
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
    if (model.phase === 'review' && model.draft) this.drawDraftHandles(model);
  }

  private drawDraftHandles(model: ConstructionPreviewModel): void {
    const { p0, p1, p2, p3 } = model.proposal.geometry;
    const zoom = this.scene.cameras?.main?.zoom || 1;
    const scale = 1 / zoom;
    const selected = model.draft!.selectedHandle;
    const pairs = [
      { anchor: p0, control: p1, handle: 'start-direction', locked: model.draft!.startDirectionLocked, color: 0x67e6ff },
      { anchor: p3, control: p2, handle: 'end-direction', locked: model.draft!.endDirectionLocked, color: 0xffd17c },
    ];
    for (const pair of pairs) {
      this.graphics.lineStyle(2 * scale, pair.color, 0.7);
      this.graphics.beginPath();
      this.graphics.moveTo(pair.anchor.x, pair.anchor.y);
      this.graphics.lineTo(pair.control.x, pair.control.y);
      this.graphics.strokePath();
      // Arrowheads communicate direction without requiring colour recognition.
      const incoming = pair.handle === 'end-direction';
      const angle = Math.atan2(pair.control.y - pair.anchor.y, pair.control.x - pair.anchor.x)
        + (incoming ? Math.PI : 0);
      const tip = {
        x: pair.anchor.x + Math.cos(angle) * (incoming ? -16 : 28) * scale,
        y: pair.anchor.y + Math.sin(angle) * (incoming ? -16 : 28) * scale,
      };
      this.graphics.beginPath();
      this.graphics.moveTo(tip.x - Math.cos(angle - 0.5) * 10 * scale, tip.y - Math.sin(angle - 0.5) * 10 * scale);
      this.graphics.lineTo(tip.x, tip.y);
      this.graphics.lineTo(tip.x - Math.cos(angle + 0.5) * 10 * scale, tip.y - Math.sin(angle + 0.5) * 10 * scale);
      this.graphics.strokePath();
      this.graphics.fillStyle(selected === pair.handle ? 0xffffff : pair.color, 1);
      this.graphics.fillCircle(pair.control.x, pair.control.y, 10 * scale);
      this.graphics.fillStyle(0x102c42, 1);
      this.graphics.fillCircle(pair.control.x, pair.control.y, (pair.locked ? 5 : 3) * scale);
    }
    this.graphics.fillStyle(selected === 'start' ? 0x67e6ff : 0xffffff, 1);
    this.graphics.fillCircle(p0.x, p0.y, 7 * scale);
    this.graphics.fillStyle(selected === 'end' ? 0xffd17c : 0xffffff, 1);
    this.graphics.fillCircle(p3.x, p3.y, 7 * scale);
  }

  clear(): void {
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
