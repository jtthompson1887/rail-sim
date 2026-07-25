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
  execute(): boolean;
  /** Reverse the operation. */
  undo(): boolean;
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
  push(command: Command): boolean {
    if (!command.execute()) return false;
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
    return true;
  }

  undo(): boolean {
    const cmd = this.undoStack[this.undoStack.length - 1];
    if (!cmd || !cmd.undo()) return false;
    this.undoStack.pop();
    this.redoStack.push(cmd);
    this.notify();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack[this.redoStack.length - 1];
    if (!cmd || !cmd.execute()) return false;
    this.redoStack.pop();
    this.undoStack.push(cmd);
    this.notify();
    return true;
  }

  /**
   * Record a command that has already been executed (e.g. by live drag) without
   * calling `execute()` again.  Clears the redo stack.
   */
  record(command: Command): boolean {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
    return true;
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
export { PlaceTrackCommand } from '../commands/PlaceTrackCommand';
export { ReshapeTrackCommand } from '../commands/ReshapeTrackCommand';
