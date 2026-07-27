import Phaser from 'phaser';
import type RailTrack from '../../entities/RailTrack';
import type {
  FreightPurchaseBlocker,
  FreightPurchaseQuote,
  FreightPurchaseQuoteInput,
  FreightPurchaseResult,
  FreightPurchaseService,
} from '../../freight/FreightPurchaseService';
import { FLATBED_FREIGHT_SET_ID } from '../../freight/FreightSetCatalog';
import type TrackManager from '../../managers/TrackManager';
import type { TrainManager } from '../../managers/TrainManager';
import { WorldManager } from '../../managers/WorldManager';
import { EventBus } from '../../services/EventBus';
import type { CommandStack } from '../CommandStack';
import type { IEditorTool } from './IEditorTool';
import type { VehicleType } from '../../config/VehicleTypes';

const PURCHASE_REMEDIES: Partial<Record<FreightPurchaseBlocker, string>> = {
  'no-track': 'Click on player track to place the General Flatbed Set',
  'outside-forest-access': 'Place inside Managed Forest rail access',
  'disconnected-route': 'Connect Managed Forest and Sawmill first',
  'insufficient-cash': 'Insufficient cash for General Flatbed Set',
  'duplicate-gesture': 'Purchase already in progress',
};

const freezeQuote = (
  quote: FreightPurchaseQuote,
): FreightPurchaseQuote => Object.freeze(quote);

/**
 * Quotes one flatbed freight-set purchase gesture from a snapped player track.
 * Live creation is owned by FreightPurchaseService after typed confirmation.
 */
export class PlaceVehicleTool implements IEditorTool {
  private readonly ghostGraphics: Phaser.GameObjects.Graphics;
  private readonly SNAP_THRESHOLD = 80;
  private freightSetId: typeof FLATBED_FREIGHT_SET_ID =
    FLATBED_FREIGHT_SET_ID;
  private purchaseInFlight = false;
  private lastPlacement: Omit<FreightPurchaseQuoteInput, 'topology'> | null =
    null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly trackManager: TrackManager,
    _trainManager: TrainManager,
    _commandStack?: CommandStack,
    private readonly quoteService?: Pick<FreightPurchaseService, 'quote'>,
  ) {
    this.ghostGraphics = scene.add.graphics().setDepth(598);
    EventBus.on('freight:purchase-result', this.purchaseResultHandler);
  }

  setVehicleType(type: VehicleType): void {
    void type;
  }

  setFreightSetId(freightSetId: typeof FLATBED_FREIGHT_SET_ID): void {
    this.freightSetId = freightSetId;
  }

  activate(): void {
    this.ghostGraphics.clear();
  }

  deactivate(): void {
    this.cancel();
  }

  cancel(): void {
    this.ghostGraphics.clear();
  }

  wantsPointerButton(button: number): boolean {
    return button === 0;
  }

  onPointerDown(
    worldX: number,
    worldY: number,
    pointer: Phaser.Input.Pointer,
  ): void {
    if (!this.wantsPointerButton(pointer.button)) return;

    if (this.purchaseInFlight) {
      this.publishState(null, PURCHASE_REMEDIES['duplicate-gesture']!);
      return;
    }
    const track = this.findNearestTrack(worldX, worldY);
    if (!track) {
      this.lastPlacement = null;
      this.publishState(null, PURCHASE_REMEDIES['no-track']!);
      return;
    }

    const input = this.buildQuoteInput(track, worldX, worldY);
    this.lastPlacement = {
      freightSetId: input.freightSetId,
      trackUUID: input.trackUUID,
      trackT: input.trackT,
      x: input.x,
      y: input.y,
    };
    const quote = this.quoteService?.quote(input);
    if (!quote) {
      this.publishState(null, PURCHASE_REMEDIES['no-track']!);
      return;
    }
    const detached = freezeQuote(quote);
    const message = detached.blocker
      ? this.remedyFor(detached.blocker)
      : '';
    if (detached.valid) this.purchaseInFlight = true;
    this.publishState(detached, message);
  }

  onPointerMove(
    worldX: number,
    worldY: number,
    _pointer: Phaser.Input.Pointer,
  ): void {
    const track = this.findNearestTrack(worldX, worldY);
    this.ghostGraphics.clear();
    if (!track) {
      this.drawInvalid(worldX, worldY);
      return;
    }

    const input = this.buildQuoteInput(track, worldX, worldY);
    const quote = this.quoteService?.quote(input);
    const point = { x: input.x, y: input.y };
    if (!quote?.valid) {
      this.drawInvalid(point.x, point.y);
      return;
    }
    const angle = track.getTrackAngle(point);
    const length = 60;
    const width = 30;
    const halfWidth = length / 2;
    const halfHeight = width / 2;
    const radians = Phaser.Math.DegToRad(
      angle + (quote.facing === -1 ? 180 : 0),
    );
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const corners = [
      {
        x: point.x + (-halfWidth * cosine - halfHeight * sine),
        y: point.y + (-halfWidth * sine + halfHeight * cosine),
      },
      {
        x: point.x + (halfWidth * cosine - halfHeight * sine),
        y: point.y + (halfWidth * sine + halfHeight * cosine),
      },
      {
        x: point.x + (halfWidth * cosine + halfHeight * sine),
        y: point.y + (halfWidth * sine - halfHeight * cosine),
      },
      {
        x: point.x + (-halfWidth * cosine + halfHeight * sine),
        y: point.y + (-halfWidth * sine - halfHeight * cosine),
      },
    ];

    this.ghostGraphics.lineStyle(2, 0x00ff88, 0.6);
    this.ghostGraphics.beginPath();
    this.ghostGraphics.moveTo(corners[0].x, corners[0].y);
    for (let index = 1; index < corners.length; index += 1) {
      this.ghostGraphics.lineTo(corners[index].x, corners[index].y);
    }
    this.ghostGraphics.closePath();
    this.ghostGraphics.strokePath();

    const arrowLength = 20;
    this.ghostGraphics.lineStyle(2, 0x4ad5ff, 0.8);
    this.ghostGraphics.beginPath();
    this.ghostGraphics.moveTo(point.x, point.y);
    this.ghostGraphics.lineTo(
      point.x + cosine * arrowLength,
      point.y + sine * arrowLength,
    );
    this.ghostGraphics.strokePath();
  }

  onPointerUp(
    _worldX: number,
    _worldY: number,
    _pointer: Phaser.Input.Pointer,
  ): void {}

  onKeyDown(_event: KeyboardEvent): void {}

  update(_delta: number): void {}

  destroy(): void {
    EventBus.off('freight:purchase-result', this.purchaseResultHandler);
    this.ghostGraphics.destroy();
  }

  private findNearestTrack(wx: number, wy: number): RailTrack | null {
    return this.trackManager.getClosestTrack(
      { x: wx, y: wy },
      this.SNAP_THRESHOLD,
    );
  }

  private buildQuoteInput(
    track: RailTrack,
    wx: number,
    wy: number,
  ): FreightPurchaseQuoteInput {
    const trackT = track.getTrackPosition({ x: wx, y: wy });
    const point = track.getCurvePath().getPoint(trackT);
    return {
      freightSetId: this.freightSetId,
      trackUUID: track.getUUID(),
      trackT,
      x: point.x,
      y: point.y,
      topology: this.trackManager.captureTopology(),
    };
  }

  private publishState(
    quote: FreightPurchaseQuote | null,
    message: string,
  ): void {
    EventBus.emit('ui:freight-purchase-state', Object.freeze({
      quote,
      cash: WorldManager.world?.company.cash ?? 0,
      message,
    }));
  }

  private remedyFor(blocker: FreightPurchaseBlocker): string {
    return PURCHASE_REMEDIES[blocker]
      ?? 'General Flatbed Set purchase could not be completed';
  }

  private drawInvalid(x: number, y: number): void {
    this.ghostGraphics.lineStyle(2, 0xff4444, 0.8);
    this.ghostGraphics.beginPath();
    this.ghostGraphics.moveTo(x - 8, y - 8);
    this.ghostGraphics.lineTo(x + 8, y + 8);
    this.ghostGraphics.moveTo(x + 8, y - 8);
    this.ghostGraphics.lineTo(x - 8, y + 8);
    this.ghostGraphics.strokePath();
  }

  private readonly purchaseResultHandler = (
    result: FreightPurchaseResult,
  ): void => {
    this.purchaseInFlight = false;
    if (result.ok === false && result.blocker === 'stale-revision') {
      if (!this.lastPlacement || !this.quoteService) {
        this.publishState(
          null,
          'Freight state changed · review and retry purchase',
        );
        return;
      }
      const freshQuote = freezeQuote(this.quoteService.quote({
        ...this.lastPlacement,
        topology: this.trackManager.captureTopology(),
      }));
      this.publishState(
        freshQuote,
        'Freight state changed · review and retry purchase',
      );
    }
  };
}
