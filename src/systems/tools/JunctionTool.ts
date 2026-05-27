import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import { JunctionCreatorSystem } from '../JunctionCreatorSystem';

/**
 * JunctionTool – wraps JunctionCreatorSystem to conform to IEditorTool.
 */
export class JunctionTool implements IEditorTool {
  private system: JunctionCreatorSystem;

  constructor(system: JunctionCreatorSystem) {
    this.system = system;
  }

  activate(): void {}
  deactivate(): void {}

  onPointerDown(_worldX: number, _worldY: number, pointer: Phaser.Input.Pointer): void {
    this.system.onPointerDown(pointer);
  }

  onPointerMove(_worldX: number, _worldY: number, pointer: Phaser.Input.Pointer): void {
    this.system.onPointerMove(pointer);
  }

  onPointerUp(_worldX: number, _worldY: number, pointer: Phaser.Input.Pointer): void {
    this.system.onPointerUp(pointer);
  }

  onKeyDown(_event: KeyboardEvent): void {}
  update(_delta: number): void {}

  destroy(): void {
    this.system.destroy();
  }
}
