import Phaser from 'phaser';
import type { IEditorTool } from './IEditorTool';
import TrackManager from '../../managers/TrackManager';
import { CommandStack } from '../CommandStack';
import { DeleteTracksCommand } from '../../commands/DeleteTracksCommand';
import { SelectionManager } from '../SelectionManager';
import { EventBus } from '../../services/EventBus';

/**
 * EraserTool – click to delete the nearest track within range.
 */
export class EraserTool implements IEditorTool {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private commandStack: CommandStack;
  private selectionManager: SelectionManager;

  constructor(
    scene: Phaser.Scene,
    trackManager: TrackManager,
    commandStack: CommandStack,
    selectionManager: SelectionManager,
  ) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.commandStack = commandStack;
    this.selectionManager = selectionManager;
  }

  activate(): void {}
  deactivate(): void {}

  onPointerDown(worldX: number, worldY: number, _pointer: Phaser.Input.Pointer): void {
    const track = this.trackManager.getClosestTrack({ x: worldX, y: worldY }, 80);
    if (!track) return;
    const uuid = track.getUUID();
    const cmd = new DeleteTracksCommand(this.trackManager, this.scene, [uuid]);
    this.commandStack.push(cmd);
    this.selectionManager.clearSelection();
    EventBus.emit('track:removed', { trackUUID: uuid });
    EventBus.emit('ui:toolbar-save-state', { state: 'unsaved' });
  }

  onPointerMove(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {}
  onPointerUp(_worldX: number, _worldY: number, _pointer: Phaser.Input.Pointer): void {}
  onKeyDown(_event: KeyboardEvent): void {}
  update(_delta: number): void {}
  destroy(): void {}
}
