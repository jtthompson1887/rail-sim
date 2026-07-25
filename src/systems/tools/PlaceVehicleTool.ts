import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import type TrackManager from '../../managers/TrackManager';
import type { TrainManager } from '../../managers/TrainManager';
import type RailTrack from '../../entities/RailTrack';
import { EventBus } from '../../services/EventBus';
import { VehicleType, getVehicleTypeInfo } from '../../config/VehicleTypes';
import { TrainSerializer } from '../../utils/TrainSerializer';
import { WorldManager } from '../../managers/WorldManager';

/**
 * PlaceVehicleTool – click on an existing track to place a locomotive or carriage.
 *
 * Hovering near a track shows a ghost preview snapped to the track curve.
 * Clicking commits the vehicle at the snapped position and angle.
 */
export class PlaceVehicleTool implements IEditorTool {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private trainManager: TrainManager;
  private ghostGraphics: Phaser.GameObjects.Graphics;
  private activeVehicleType: VehicleType = 'locomotive';

  /** How close the cursor must be to a track for snapping (world units). */
  private readonly SNAP_THRESHOLD = 80;

  constructor(
    scene: Phaser.Scene,
    trackManager: TrackManager,
    trainManager: TrainManager,
  ) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.trainManager = trainManager;
    this.ghostGraphics = scene.add.graphics().setDepth(598);
  }

  setVehicleType(type: VehicleType): void {
    this.activeVehicleType = type;
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

  onPointerDown(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void {
    if (!this.wantsPointerButton(pointer.button)) return;

    const track = this.findNearestTrack(worldX, worldY);
    if (!track) {
      EventBus.emit('ui:toast', { message: 'Click on a track to place a vehicle', type: 'error' });
      return;
    }

    const info = getVehicleTypeInfo(this.activeVehicleType);
    const t = this.getTrackTAtPoint(track, worldX, worldY);
    const point = track.getCurvePath().getPoint(t);
    const angle = track.getTrackAngle({ x: point.x, y: point.y });

    let vehicle;
    if (this.activeVehicleType === 'locomotive') {
      vehicle = this.trainManager.createInitialTrain();
    } else {
      vehicle = this.trainManager.createCarriage();
    }

    vehicle.getMatterBody().setPosition(point.x, point.y);
    vehicle.getMatterBody().setAngle(angle);
    vehicle.currentTrack = track;

    const def = TrainSerializer.toTrainDef(vehicle);
    if (def) {
      WorldManager.addTrainDef(def);
    }

    EventBus.emit('ui:toast', {
      message: `${info?.displayName ?? 'Vehicle'} placed`,
      type: 'success',
    });
    EventBus.emit('ui:toolbar-save-state', { state: 'unsaved' });
  }

  onPointerMove(worldX: number, worldY: number, _pointer: Phaser.Input.Pointer): void {
    const track = this.findNearestTrack(worldX, worldY);
    this.ghostGraphics.clear();

    if (!track) {
      // Draw a small X to indicate no valid placement
      this.ghostGraphics.lineStyle(2, 0xff4444, 0.8);
      this.ghostGraphics.beginPath();
      this.ghostGraphics.moveTo(worldX - 8, worldY - 8);
      this.ghostGraphics.lineTo(worldX + 8, worldY + 8);
      this.ghostGraphics.moveTo(worldX + 8, worldY - 8);
      this.ghostGraphics.lineTo(worldX - 8, worldY + 8);
      this.ghostGraphics.strokePath();
      return;
    }

    const t = this.getTrackTAtPoint(track, worldX, worldY);
    const point = track.getCurvePath().getPoint(t);
    const angle = track.getTrackAngle({ x: point.x, y: point.y });

    // Ghost rectangle
    const length = 60;
    const width = 30;
    const hw = length / 2;
    const hh = width / 2;
    const rad = Phaser.Math.DegToRad(angle);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const corners = [
      { x: point.x + (-hw * cos - hh * sin), y: point.y + (-hw * sin + hh * cos) },
      { x: point.x + (hw * cos - hh * sin), y: point.y + (hw * sin + hh * cos) },
      { x: point.x + (hw * cos + hh * sin), y: point.y + (hw * sin - hh * cos) },
      { x: point.x + (-hw * cos + hh * sin), y: point.y + (-hw * sin - hh * cos) },
    ];

    this.ghostGraphics.lineStyle(2, 0x00ff88, 0.6);
    this.ghostGraphics.beginPath();
    this.ghostGraphics.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      this.ghostGraphics.lineTo(corners[i].x, corners[i].y);
    }
    this.ghostGraphics.closePath();
    this.ghostGraphics.strokePath();

    // Facing arrow
    const arrowLen = 20;
    const ax = point.x + cos * arrowLen;
    const ay = point.y + sin * arrowLen;
    this.ghostGraphics.lineStyle(2, 0x4ad5ff, 0.8);
    this.ghostGraphics.beginPath();
    this.ghostGraphics.moveTo(point.x, point.y);
    this.ghostGraphics.lineTo(ax, ay);
    this.ghostGraphics.strokePath();
  }

  onPointerUp(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {
    // No-op
  }

  onKeyDown(_event: KeyboardEvent): void {
    // No-op
  }

  update(_delta: number): void {
    // No-op
  }

  destroy(): void {
    this.ghostGraphics.destroy();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private findNearestTrack(wx: number, wy: number): RailTrack | null {
    return this.trackManager.getClosestTrack({ x: wx, y: wy }, this.SNAP_THRESHOLD);
  }

  /** Compute the t-value on the track closest to the given world point. */
  private getTrackTAtPoint(track: RailTrack, wx: number, wy: number): number {
    return track.getTrackPosition({ x: wx, y: wy });
  }
}
