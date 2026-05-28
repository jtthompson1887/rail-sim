/**
 * CommandStack – incremental undo/redo without scene restarts.
 *
 * Every editor operation (place track, delete track, reshape endpoint, etc.)
 * is wrapped in a Command object and pushed onto the stack.  Undo walks back
 * through the stack; redo replays forward.
 */

export interface Command {
  /** Human-readable label (shown in UI / used for debugging). */
  readonly description: string;
  /** Apply the operation (called once when the command is first committed). */
  execute(): void;
  /** Reverse the operation. */
  undo(): void;
}

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  readonly maxDepth: number;

  /** Called whenever the stack changes so callers can update UI. */
  onChange?: (canUndo: boolean, canRedo: boolean) => void;

  constructor(maxDepth = 50) {
    this.maxDepth = maxDepth;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /**
   * Execute a command and push it onto the undo stack.
   * Clears the redo stack (standard linear undo model).
   */
  push(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
    this.notify();
  }

  /**
   * Record a command that has already been executed (e.g. by live drag) without
   * calling `execute()` again.  Clears the redo stack.
   */
  record(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  /** Clear both stacks (e.g. when loading a new world). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  private notify(): void {
    this.onChange?.(this.canUndo, this.canRedo);
  }
}

// Re-export concrete commands for backward compatibility
export { DeleteTracksCommand } from '../commands/DeleteTracksCommand';
export { ReshapeTrackCommand } from '../commands/ReshapeTrackCommand';
