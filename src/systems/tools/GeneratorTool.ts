import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import type TrackManager from '../../managers/TrackManager';
import type { SnapSystem } from '../SnapSystem';
import type { TerrainValidator } from '../TerrainValidator';
import { EventBus } from '../../services/EventBus';
import { GENERATOR_LOCK_REASON } from '../../ui/EditorToolbar';

/**
 * Disabled compatibility shell.
 *
 * Procedural generation creates multiple live RailTrack instances before it
 * has one canonical quote. Until it can review and commit the complete batch
 * through ConstructionService and CommandStack, every entry point is inert.
 */
export class GeneratorTool implements IEditorTool {
  private readonly ghostGraphics: Phaser.GameObjects.Graphics;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    _trackManager: TrackManager,
    _snapSystem: SnapSystem,
    _terrainValidator: TerrainValidator,
    _editorUISceneKey: string = 'EditorUIScene',
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

  runFromAnchor(): void {
    this.reportLocked();
  }

  runGeneratorAt(_worldX: number, _worldY: number): void {
    this.reportLocked();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ghostGraphics.destroy();
  }

  private reportLocked(): void {
    EventBus.emit('ui:toast', {
      message: GENERATOR_LOCK_REASON,
      type: 'info',
    });
  }
}
