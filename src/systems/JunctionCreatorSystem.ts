import Phaser from 'phaser';
import type TrackManager from '../managers/TrackManager';
import type { TerrainValidator } from './TerrainValidator';
import { EventBus } from '../services/EventBus';
import { JUNCTION_LOCK_REASON } from '../ui/EditorToolbar';

/**
 * Disabled compatibility shell for interior splitting and branch creation.
 *
 * Junction creation changes several tracks plus topology. It remains inert
 * until that complete mutation has one canonical quote and atomic command.
 */
export class JunctionCreatorSystem {
  constructor(
    _scene: Phaser.Scene,
    _trackManager: TrackManager,
    _terrainValidator: TerrainValidator | null = null,
  ) {}

  onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.rightButtonDown()) this.reportLocked();
  }
  onPointerMove(_pointer: Phaser.Input.Pointer): void {}
  onPointerUp(_pointer: Phaser.Input.Pointer): void {}
  cancel(): void {}
  destroy(): void {}

  private reportLocked(): void {
    EventBus.emit('ui:toast', {
      message: JUNCTION_LOCK_REASON,
      type: 'info',
    });
  }
}
