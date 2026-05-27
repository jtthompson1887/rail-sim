import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import RailTrack from '../../entities/RailTrack';
import TrackManager from '../../managers/TrackManager';
import { WorldManager } from '../../managers/WorldManager';
import { SnapSystem } from '../SnapSystem';
import { TerrainValidator } from '../TerrainValidator';
import { TrackSerializer } from '../../utils/TrackSerializer';
import { EventBus } from '../../services/EventBus';

function validationHintState(validation: { valid: boolean; requiresTunnel: boolean }): 'ok' | 'warning' | 'error' {
  if (!validation.valid) return 'error';
  return validation.requiresTunnel ? 'warning' : 'ok';
}

/**
 * PlaceTrackTool – two-click placement of straight cubic Bézier tracks.
 *
 * First click sets anchor (snapped to nearby endpoint via SnapSystem).
 * Second click commits the track and chains the anchor to the new endpoint.
 */
export class PlaceTrackTool implements IEditorTool {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private snapSystem: SnapSystem;
  private terrainValidator: TerrainValidator;
  private ghostGraphics: Phaser.GameObjects.Graphics;
  private placeAnchor: Phaser.Math.Vector2 | null = null;

  constructor(
    scene: Phaser.Scene,
    trackManager: TrackManager,
    snapSystem: SnapSystem,
    terrainValidator: TerrainValidator,
  ) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.snapSystem = snapSystem;
    this.terrainValidator = terrainValidator;
    this.ghostGraphics = scene.add.graphics().setDepth(598);
  }

  activate(): void {
    // No-op — state reset happens in deactivate
  }

  deactivate(): void {
    this.placeAnchor = null;
    this.ghostGraphics.clear();
    EventBus.emit('ui:validation-hint', { state: 'ok', message: '' });
  }

  onPointerDown(worldX: number, worldY: number, _pointer: Phaser.Input.Pointer): void {
    if (!this.placeAnchor) {
      // First click — snap to a nearby endpoint
      const snapped = this.snapSystem.snapPoint(worldX, worldY);
      this.placeAnchor = new Phaser.Math.Vector2(snapped.x, snapped.y);
      this.ghostGraphics.clear();
      this.ghostGraphics.fillStyle(0x4ad5ff, 0.9);
      this.ghostGraphics.fillCircle(snapped.x, snapped.y, 6);
    } else {
      // Second click — commit the track
      const p0 = this.placeAnchor;
      const p3 = new Phaser.Math.Vector2(worldX, worldY);
      const p1 = new Phaser.Math.Vector2(
        p0.x + (p3.x - p0.x) / 3,
        p0.y + (p3.y - p0.y) / 3,
      );
      const p2 = new Phaser.Math.Vector2(
        p0.x + (p3.x - p0.x) * 2 / 3,
        p0.y + (p3.y - p0.y) * 2 / 3,
      );

      const validation = this.terrainValidator.canPlaceTrack(p0, p1, p2, p3, 20, this.trackManager);
      if (!validation.valid) {
        EventBus.emit('ui:toast', { message: `Cannot place track: ${validation.reason}`, type: 'error' });
        EventBus.emit('ui:validation-hint', { state: 'error', message: validation.reason });
      } else {
        const snap = this.terrainValidator.snapToFlushConnection(p0, p1, p2, p3, this.trackManager);

        if (snap.neighbourAdjustment) {
          const { track: nTrack, p0: nP0, p1: nP1, p2: nP2, p3: nP3 } = snap.neighbourAdjustment;
          // Validate the adjusted neighbour still satisfies all constraints.
          const nCheck = this.terrainValidator.canPlaceTrack(nP0, nP1, nP2, nP3, 20, null);
          if (nCheck.valid) {
            nTrack.updateTrackVectors(nP0, nP1, nP2, nP3);
            WorldManager.updateTrackDef(TrackSerializer.toTrackDef(nTrack));
          }
        }

        const track = new RailTrack(this.scene, snap.p0, snap.p1, snap.p2, snap.p3);
        track.isTunnel = validation.requiresTunnel;
        track.elevation = validation.averageElevation;
        this.trackManager.addTrack(track);
        WorldManager.addTrackDef(TrackSerializer.toTrackDef(track));
        EventBus.emit('ui:toolbar-save-state', { state: 'unsaved' });
        EventBus.emit('ui:validation-hint', { state: validationHintState(validation), message: validation.reason });
        EventBus.emit('ui:toast', { message: 'Track placed', type: 'success' });
      }

      // Chain — anchor moves to the new endpoint
      this.placeAnchor = new Phaser.Math.Vector2(worldX, worldY);
      this.ghostGraphics.clear();
      this.ghostGraphics.fillStyle(0x4ad5ff, 0.9);
      this.ghostGraphics.fillCircle(worldX, worldY, 6);
    }
  }

  onPointerMove(worldX: number, worldY: number, _pointer: Phaser.Input.Pointer): void {
    if (!this.placeAnchor) return;

    const p0 = this.placeAnchor;
    const p3 = new Phaser.Math.Vector2(worldX, worldY);
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const p1 = new Phaser.Math.Vector2(p0.x + dx / 3, p0.y + dy / 3);
    const p2 = new Phaser.Math.Vector2(p0.x + dx * 2 / 3, p0.y + dy * 2 / 3);

    const validation = this.terrainValidator.canPlaceTrack(p0, p1, p2, p3, 20, this.trackManager);
    const colour = validation.valid
      ? (validation.requiresTunnel ? 0xffcc00 : 0x00ff88)
      : 0xff4444;

    this.ghostGraphics.clear();
    // Anchor dot
    this.ghostGraphics.fillStyle(colour, 0.9);
    this.ghostGraphics.fillCircle(this.placeAnchor.x, this.placeAnchor.y, 6);
    // Ghost line
    this.ghostGraphics.lineStyle(2, colour, 0.6);
    this.ghostGraphics.beginPath();
    this.ghostGraphics.moveTo(this.placeAnchor.x, this.placeAnchor.y);
    this.ghostGraphics.lineTo(worldX, worldY);
    this.ghostGraphics.strokePath();
    // Cursor dot
    this.ghostGraphics.fillStyle(colour, 0.7);
    this.ghostGraphics.fillCircle(worldX, worldY, 4);

    EventBus.emit('ui:validation-hint', { state: validationHintState(validation), message: validation.reason });
  }

  onPointerUp(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {
    // No-op for place-track
  }

  onKeyDown(_event: KeyboardEvent): void {
    // No-op for place-track
  }

  update(_delta: number): void {
    // No-op
  }

  destroy(): void {
    this.ghostGraphics.destroy();
  }
}
