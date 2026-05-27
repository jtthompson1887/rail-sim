import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import { SelectionManager } from '../SelectionManager';

/**
 * SelectTool – delegates to SelectionManager for rubber-band and click selection.
 */
export class SelectTool implements IEditorTool {
  private selectionManager: SelectionManager;

  constructor(selectionManager: SelectionManager) {
    this.selectionManager = selectionManager;
  }

  activate(): void {}
  deactivate(): void {}

  onPointerDown(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void {
    const shift = pointer.event ? (pointer.event as MouseEvent).shiftKey : false;
    this.selectionManager.onPointerDown(worldX, worldY, shift);
  }

  onPointerMove(worldX: number, worldY: number, _pointer: Phaser.Input.Pointer): void {
    this.selectionManager.onPointerMove(worldX, worldY);
  }

  onPointerUp(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void {
    const shift = pointer.event ? (pointer.event as MouseEvent).shiftKey : false;
    this.selectionManager.onPointerUp(worldX, worldY, shift);
  }

  onKeyDown(_event: KeyboardEvent): void {}

  update(delta: number): void {
    this.selectionManager.update(delta);
  }

  destroy(): void {}
}
