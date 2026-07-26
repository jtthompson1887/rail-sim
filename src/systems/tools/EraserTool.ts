import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import type TrackManager from '../../managers/TrackManager';
import type { CommandStack } from '../CommandStack';
import type { SelectionManager } from '../SelectionManager';
import { EventBus } from '../../services/EventBus';
import { ERASER_LOCK_REASON } from '../../ui/EditorToolbar';

/**
 * Compatibility shell retained because deletion requires the inspector's
 * selection-bound refund review before its economy-aware command.
 */
export class EraserTool implements IEditorTool {
  constructor(
    _scene: Phaser.Scene,
    _trackManager: TrackManager,
    _commandStack: CommandStack,
    _selectionManager: SelectionManager,
  ) {}

  activate(): void {
    this.reportLocked();
  }
  deactivate(): void {}
  cancel(): void {}
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
  destroy(): void {}

  private reportLocked(): void {
    EventBus.emit('ui:toast', {
      message: ERASER_LOCK_REASON,
      type: 'info',
    });
  }
}
