import Phaser from 'phaser';

/**
 * IEditorTool – the standard interface for all editor tools.
 *
 * Each tool is a self-contained class that owns its state (ghost graphics,
 * anchors, etc.) and responds to input events routed by the scene.
 */
export interface IEditorTool {
  /** Called when this tool becomes the active tool. */
  activate(): void;
  /** Called when the user switches away from this tool. */
  deactivate(): void;
  /** Pointer pressed in world coordinates. */
  onPointerDown(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void;
  /** Pointer moved in world coordinates. */
  onPointerMove(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void;
  /** Pointer released in world coordinates. */
  onPointerUp(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void;
  /** Keyboard input. */
  onKeyDown(event: KeyboardEvent): void;
  /** Per-frame update (optional — used for animations/previews). */
  update(delta: number): void;
  /** Clean up resources when the tool system is destroyed. */
  destroy(): void;
}
