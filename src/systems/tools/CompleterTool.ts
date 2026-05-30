import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import { TrackCompleterSystem } from '../TrackCompleterSystem';

/**
 * CompleterTool – wraps TrackCompleterSystem to conform to IEditorTool.
 */
export class CompleterTool implements IEditorTool {
  private system: TrackCompleterSystem;

  constructor(system: TrackCompleterSystem) {
    this.system = system;
  }

  activate(): void {
    this.system.setActive(true);
  }
  deactivate(): void {
    this.system.setActive(false);
  }
  cancel(): void {
    this.system.cancel();
  }
  wantsPointerButton(button: number): boolean {
    return button === 0; // Only left button
  }

  onPointerDown(_worldX: number, _worldY: number, pointer: Phaser.Input.Pointer): void {
    this.system.onPointerDown(pointer);
  }

  onPointerMove(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {
    // TrackCompleterSystem doesn't use onPointerMove
  }

  onPointerUp(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {
    // TrackCompleterSystem doesn't use onPointerUp
  }

  onKeyDown(event: KeyboardEvent): void {
    this.system.onKeyDown(event);
  }

  update(delta: number): void {
    this.system.update(delta);
  }

  destroy(): void {
    this.system.destroy();
  }
}
