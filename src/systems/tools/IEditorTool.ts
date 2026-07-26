import Phaser from 'phaser';

export type InputLockOwner = 'camera' | 'editor-tool' | 'ui' | 'object-drag';

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
  /** Called when the user presses ESC or cancels the current operation. */
  cancel(): void;
  /** Return true if this tool wants to handle the given pointer button (0=left, 1=middle, 2=right). */
  wantsPointerButton(button: number): boolean;
  /** Pointer pressed in world coordinates. */
  onPointerDown(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void;
  /** Pointer moved in world coordinates. */
  onPointerMove(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void;
  /** Pointer released in world coordinates. */
  onPointerUp(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void;
  /** Browser/Phaser cancellation for one specific pointer gesture. */
  onPointerCancel?(pointer: Phaser.Input.Pointer): void;
  /** Keyboard input. */
  onKeyDown(event: KeyboardEvent): void;
  /** Per-frame update (optional — used for animations/previews). */
  update(delta: number): void;
  /** Clean up resources when the tool system is destroyed. */
  destroy(): void;
}

/** Base class with default implementations for IEditorTool methods. */
export abstract class BaseEditorTool implements IEditorTool {
  activate(): void { }
  deactivate(): void { }
  cancel(): void { }
  wantsPointerButton(button: number): boolean {
    return button === 0;
  }
  abstract onPointerDown(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void;
  abstract onPointerMove(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void;
  abstract onPointerUp(worldX: number, worldY: number, pointer: Phaser.Input.Pointer): void;
  onPointerCancel(_pointer: Phaser.Input.Pointer): void { this.cancel(); }
  onKeyDown(_event: KeyboardEvent): void { }
  update(_delta: number): void { }
  destroy(): void { }
}
