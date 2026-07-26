import Phaser from 'phaser';
import type TrackManager from '../managers/TrackManager';
import type { TerrainValidator } from './TerrainValidator';
import { EventBus } from '../services/EventBus';
import { COMPLETER_LOCK_REASON } from '../ui/EditorToolbar';

/**
 * Disabled compatibility shell for the legacy multi-segment route completer.
 *
 * A complete route must be priced, checked for affordability, and committed as
 * one atomic command. The former system committed analysed segments directly,
 * so no search, preview, or mutation is retained at this boundary.
 */
export class TrackCompleterSystem {
  constructor(
    _scene: Phaser.Scene,
    _trackManager: TrackManager,
    _terrainValidator: TerrainValidator | null = null,
  ) {}

  setActive(active: boolean): void {
    if (active) this.reportLocked();
  }
  update(_delta: number): void {}
  onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.leftButtonDown()) this.reportLocked();
  }
  onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Enter' || event.code === 'Space') this.reportLocked();
  }
  cancel(): void {}
  confirm(): void {
    this.reportLocked();
  }
  destroy(): void {}

  private reportLocked(): void {
    EventBus.emit('ui:toast', {
      message: COMPLETER_LOCK_REASON,
      type: 'info',
    });
  }
}
