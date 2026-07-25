import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import type TrackManager from '../../managers/TrackManager';
import type { SnapSystem } from '../SnapSystem';
import type { TerrainValidator } from '../TerrainValidator';
import { EventBus } from '../../services/EventBus';
import { CONSTRUCTION_ECONOMY_LOCK_REASON } from '../../ui/EditorToolbar';

/**
 * Compatibility shell retained until the authoritative economy-aware
 * construction command replaces the old two-click placement path.
 */
export class PlaceTrackTool implements IEditorTool {
  private readonly ghostGraphics: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    _trackManager: TrackManager,
    _snapSystem: SnapSystem,
    _terrainValidator: TerrainValidator,
  ) {
    this.ghostGraphics = scene.add.graphics().setDepth(598);
  }

  activate(): void {
    this.reportLocked();
  }
  deactivate(): void {
    this.ghostGraphics.clear();
  }
  cancel(): void {
    this.ghostGraphics.clear();
  }
  wantsPointerButton(button: number): boolean {
    return button === 0;
  }
  onPointerDown(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {
    this.reportLocked();
  }
  onPointerMove(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {}
  onPointerUp(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {}
  onKeyDown(_event: KeyboardEvent): void {}
  update(_delta: number): void {}
  destroy(): void {
    this.ghostGraphics.destroy();
  }

  private reportLocked(): void {
    EventBus.emit('ui:toast', {
      message: CONSTRUCTION_ECONOMY_LOCK_REASON,
      type: 'info',
    });
  }
}
