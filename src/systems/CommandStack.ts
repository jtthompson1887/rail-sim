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

/** Opaque authoritative state cursor shared only by revision-aware commands. */
export interface CommandRevisionContext {
  readonly authority: object;
  readonly revision: number;
}

export interface RevisionAwareCommand extends Command {
  getRevisionContext(): CommandRevisionContext | null;
  rebaseRevisionContext(context: CommandRevisionContext): boolean;
}

function isRevisionAware(command: Command | undefined): command is RevisionAwareCommand {
  return !!command
    && typeof (command as Partial<RevisionAwareCommand>).getRevisionContext === 'function'
    && typeof (command as Partial<RevisionAwareCommand>).rebaseRevisionContext === 'function';
}

function sameRevisionContext(
  left: CommandRevisionContext,
  right: CommandRevisionContext,
): boolean {
  return left.authority === right.authority && left.revision === right.revision;
}

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private lastRevisionContext: CommandRevisionContext | null = null;
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
    if (!this.matchesLastRevisionContext(command)) return false;
    if (!command.execute()) return false;
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = [];
    this.captureResultingRevisionContext(command);
    this.notify();
    return true;
  }

  undo(): boolean {
    const cmd = this.undoStack[this.undoStack.length - 1];
    if (!cmd || !this.matchesLastRevisionContext(cmd) || !cmd.undo()) return false;
    this.undoStack.pop();
    this.redoStack.push(cmd);
    this.captureResultingRevisionContext(cmd);
    this.rebaseExposedCommand(this.undoStack[this.undoStack.length - 1]);
    this.notify();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack[this.redoStack.length - 1];
    if (!cmd || !this.matchesLastRevisionContext(cmd) || !cmd.execute()) return false;
    this.redoStack.pop();
    this.undoStack.push(cmd);
    this.captureResultingRevisionContext(cmd);
    this.rebaseExposedCommand(this.redoStack[this.redoStack.length - 1]);
    this.notify();
    return true;
  }

  /**
   * Record a command that has already been executed (e.g. by live drag) without
   * calling `execute()` again.  Clears the redo stack.
   */
  record(command: Command): boolean {
    if (!this.canRecordRevisionContext(command)) return false;
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = [];
    this.captureResultingRevisionContext(command);
    this.notify();
    return true;
  }

  /** Clear both stacks (e.g. when loading a new world). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastRevisionContext = null;
    this.notify();
  }

  private matchesLastRevisionContext(command: Command): boolean {
    if (!isRevisionAware(command)) return true;
    const context = command.getRevisionContext();
    if (!context) return false;
    return !this.lastRevisionContext
      || sameRevisionContext(context, this.lastRevisionContext);
  }

  private captureResultingRevisionContext(command: Command): void {
    if (!isRevisionAware(command)) return;
    const context = command.getRevisionContext();
    if (context) this.lastRevisionContext = context;
  }

  private canRecordRevisionContext(command: Command): boolean {
    if (!isRevisionAware(command)) return true;
    const context = command.getRevisionContext();
    if (!context) return false;
    return !this.lastRevisionContext
      || (context.authority === this.lastRevisionContext.authority
        && context.revision === this.lastRevisionContext.revision + 1);
  }

  private rebaseExposedCommand(command: Command | undefined): void {
    if (!command || !this.lastRevisionContext || !isRevisionAware(command)) return;
    command.rebaseRevisionContext(this.lastRevisionContext);
  }

  private notify(): void {
    this.onChange?.(this.canUndo, this.canRedo);
  }
}

// Re-export concrete commands for backward compatibility
export { DeleteTracksCommand } from '../commands/DeleteTracksCommand';
export { PlaceTrackCommand } from '../commands/PlaceTrackCommand';
export { ReshapeTrackCommand } from '../commands/ReshapeTrackCommand';
