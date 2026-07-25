import Phaser from 'phaser';
import { EventBus } from '../services/EventBus';
import { isMobileWidth, scalePx, responsiveFontSize } from '../utils/responsive';

/** All editor tools, including pan and eraser from the new framework. */
export type CreateTool =
  | 'select'
  | 'pan'
  | 'place-track'
  | 'completer'
  | 'junction'
  | 'generator'
  | 'eraser'
  | 'terrain-view'
  | 'place-vehicle'
  | 'none';

/** Keyboard shortcut badge labels for each tool. */
const SHORTCUTS: Partial<Record<CreateTool, string>> = {
  select: 'V',
  pan: 'H',
  'place-track': 'P',
  completer: 'D',
  junction: 'J',
  generator: 'G',
  eraser: 'E',
  'terrain-view': 'T',
  'place-vehicle': 'N',
};

interface ToolEntry {
  tool: CreateTool;
  icon: string;
  label: string;
  shortcut?: string;
}

const TOOL_GROUPS: ToolEntry[][] = [
  [
    { tool: 'select',      icon: '↖', label: 'Select',   shortcut: 'V' },
    { tool: 'pan',         icon: '✋', label: 'Pan',      shortcut: 'H' },
  ],
  [
    { tool: 'place-track', icon: '＋', label: 'Place',    shortcut: 'P' },
    { tool: 'completer',   icon: '⟷', label: 'Connect',  shortcut: 'D' },
    { tool: 'junction',    icon: '⑃', label: 'Junction', shortcut: 'J' },
  ],
  [
    { tool: 'generator', icon: '⚙', label: 'Generate', shortcut: 'G' },
    { tool: 'eraser',    icon: '⌫', label: 'Erase',    shortcut: 'E' },
  ],
  [
    { tool: 'place-vehicle', icon: '🚂', label: 'Vehicle', shortcut: 'N' },
    { tool: 'terrain-view',  icon: '⛰', label: 'Terrain', shortcut: 'T' },
  ],
];

interface ButtonRef {
  tool: CreateTool;
  bg: Phaser.GameObjects.Rectangle;
  iconText: Phaser.GameObjects.Text;
  labelText: Phaser.GameObjects.Text;
  shortcutText: Phaser.GameObjects.Text;
  activebar: Phaser.GameObjects.Rectangle;
}

/**
 * EditorToolbar
 *
 * A vertical side-docked toolbar (left edge, full height) with three regions:
 *   – Top: mode toggle (Edit ↔ Play)
 *   – Middle: tool buttons grouped by category
 *   – Bottom: Undo / Redo buttons and a Save status indicator
 *
 * Emits via EventBus:
 *   'tool:changed'      – when a tool button is pressed
 *   'editor:undo'       – when the Undo button is pressed
 *   'editor:redo'       – when the Redo button is pressed
 *   'editor:save'       – when the Save button is pressed
 *   'editor:mode-toggle' – when the Play/Edit mode button is pressed
 */
export class EditorToolbar {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private background: Phaser.GameObjects.Rectangle;
  private border: Phaser.GameObjects.Rectangle;

  /** Width of the toolbar panel in screen px. */
  readonly panelWidth: number;

  private activeTool: CreateTool = 'none';
  private toolButtons: ButtonRef[] = [];

  /**
   * Every game-object created by the toolbar (buttons, labels, dividers, etc.)
   * is pushed here so setVisible() can hide/show them all in one pass.
   */
  private allObjects: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[] = [];

  // Bottom-row control buttons
  private undoBg!: Phaser.GameObjects.Rectangle;
  private redoBg!: Phaser.GameObjects.Rectangle;
  private undoEnabled: boolean = false;
  private redoEnabled: boolean = false;

  // Save indicator
  private saveText!: Phaser.GameObjects.Text;

  // Toast
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly toastHandler = (data: { message: string; type: 'info' | 'error' | 'success' }) => {
    this.showToast(data.message, data.type);
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const { width, height } = scene.scale;
    // Scale panel width with the viewport, clamped to a touch-safe minimum
    this.panelWidth = scalePx(72, width, height, isMobileWidth(width) ? 44 : 56);
    this.container = scene.add.container(0, 0).setDepth(599).setScrollFactor(0);

    this.background = scene.add.rectangle(
      this.panelWidth / 2, height / 2,
      this.panelWidth, height,
      0x06131f, 0.95,
    ).setScrollFactor(0).setDepth(599);

    this.border = scene.add.rectangle(
      this.panelWidth, height / 2,
      2, height,
      0xffffff, 0.15,
    ).setScrollFactor(0).setDepth(599);

    this.build();

    EventBus.on('ui:toast', this.toastHandler);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('ui:toast', this.toastHandler);
    });
  }

  get currentTool(): CreateTool {
    return this.activeTool;
  }

  /** Bounding box of the toolbar in screen coordinates (for hit-testing). */
  get screenBounds(): { left: number; right: number; top: number; bottom: number } {
    return {
      left: 0,
      right: this.panelWidth + 2,
      top: 0,
      bottom: this.scene.scale.height,
    };
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  private build(): void {
    const { width, height } = this.scene.scale;
    const w = this.panelWidth;
    const mobile = isMobileWidth(width);
    // Scale button sizes and font sizes with the viewport
    const btnSize = scalePx(56, width, height, 44);
    const iconSize = responsiveFontSize(20, width, height, 14, 20);
    const labelSize = responsiveFontSize(10, width, height, 8, 10);
    const shortcutSize = responsiveFontSize(8, width, height, 7, 8);
    let y = 12;

    // ── Mode toggle button (top) ───────────────────────────────────────────
    const modeBg = this.scene.add.rectangle(w / 2, y + btnSize / 2, w - 4, btnSize - 4, 0x1a6e3c, 0.9)
      .setStrokeStyle(1, 0x4ade80, 0.6)
      .setScrollFactor(0).setDepth(600)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => modeBg.setFillStyle(0x22a05a, 0.95))
      .on('pointerout', () => modeBg.setFillStyle(0x1a6e3c, 0.9))
      .on('pointerdown', () => EventBus.emit('editor:mode-toggle', {}));
    this.allObjects.push(modeBg);

    const modeText = this.scene.add.text(w / 2, y + btnSize / 2, '▶ Play', {
      fontFamily: 'Verdana', fontSize: iconSize, color: '#4ade80',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(601);
    this.allObjects.push(modeText);

    y += btnSize + 8;

    // ── Thin separator ────────────────────────────────────────────────────
    this.addDivider(y);
    y += 6;

    // ── Tool groups ────────────────────────────────────────────────────────
    for (let g = 0; g < TOOL_GROUPS.length; g++) {
      for (const entry of TOOL_GROUPS[g]) {
        const bx = w / 2;
        const by = y + btnSize / 2;

        const activebar = this.scene.add.rectangle(2, by, 4, btnSize - 8, 0x2a8cff, 1)
          .setScrollFactor(0).setDepth(600).setAlpha(0);
        this.allObjects.push(activebar);

        const bg = this.scene.add.rectangle(bx, by, w - 4, btnSize - 4, 0x1a3a5c, 0.85)
          .setStrokeStyle(1, 0xffffff, 0.1)
          .setScrollFactor(0).setDepth(600)
          .setInteractive({ useHandCursor: true })
          .on('pointerover', () => {
            if (this.activeTool !== entry.tool) bg.setFillStyle(0x1e4a6e, 0.95);
          })
          .on('pointerout', () => {
            if (this.activeTool !== entry.tool) bg.setFillStyle(0x1a3a5c, 0.85);
          })
          .on('pointerdown', () => this.selectTool(entry.tool));
        this.allObjects.push(bg);

        const iconText = this.scene.add.text(bx, by - (mobile ? 4 : 6), entry.icon, {
          fontFamily: 'Verdana', fontSize: iconSize, color: '#d0e8ff',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(601);
        this.allObjects.push(iconText);

        const labelText = this.scene.add.text(bx, by + (mobile ? 6 : 8), mobile ? '' : entry.label, {
          fontFamily: 'Verdana', fontSize: labelSize, color: '#8ab4d0',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(601);
        this.allObjects.push(labelText);

        const shortcutText = this.scene.add.text(bx + w / 2 - 10, by - btnSize / 2 + 4, entry.shortcut ?? '', {
          fontFamily: 'Verdana', fontSize: shortcutSize, color: '#4a6a8a',
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(601);
        this.allObjects.push(shortcutText);

        this.toolButtons.push({
          tool: entry.tool,
          bg,
          iconText,
          labelText,
          shortcutText,
          activebar,
        });

        y += btnSize;
      }
      y += 8;
      this.addDivider(y - 4);
      y += 6;
    }

    // ── Bottom controls ───────────────────────────────────────────────────
    y += 4;

    // Undo button
    const undoY = y + btnSize / 2;
    this.undoBg = this.scene.add.rectangle(w / 2, undoY, w - 8, btnSize - 8, 0x1a3a5c, 0.5)
      .setStrokeStyle(1, 0xffffff, 0.1)
      .setScrollFactor(0).setDepth(600)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => { if (this.undoEnabled) this.undoBg.setFillStyle(0x1e4a6e, 0.8); })
      .on('pointerout', () => this.undoBg.setFillStyle(0x1a3a5c, 0.5))
      .on('pointerdown', () => { if (this.undoEnabled) EventBus.emit('editor:undo', {}); });
    this.allObjects.push(this.undoBg);

    const undoText = this.scene.add.text(w / 2, undoY, '↩ Undo', {
      fontFamily: 'Verdana', fontSize: labelSize, color: '#8ab4d0',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(601);
    this.allObjects.push(undoText);

    y += btnSize + 4;

    // Redo button
    const redoY = y + btnSize / 2;
    this.redoBg = this.scene.add.rectangle(w / 2, redoY, w - 8, btnSize - 8, 0x1a3a5c, 0.5)
      .setStrokeStyle(1, 0xffffff, 0.1)
      .setScrollFactor(0).setDepth(600)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => { if (this.redoEnabled) this.redoBg.setFillStyle(0x1e4a6e, 0.8); })
      .on('pointerout', () => this.redoBg.setFillStyle(0x1a3a5c, 0.5))
      .on('pointerdown', () => { if (this.redoEnabled) EventBus.emit('editor:redo', {}); });
    this.allObjects.push(this.redoBg);

    const redoText = this.scene.add.text(w / 2, redoY, '↪ Redo', {
      fontFamily: 'Verdana', fontSize: labelSize, color: '#8ab4d0',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(601);
    this.allObjects.push(redoText);

    y += btnSize + 12;

    // Save indicator
    this.saveText = this.scene.add.text(w / 2, y, 'Saved', {
      fontFamily: 'Verdana', fontSize: labelSize, color: '#4ade80',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(601);
    this.allObjects.push(this.saveText);

    // Toast text (initially invisible)
    this.toastText = this.scene.add.text(w / 2, height - 40, '', {
      fontFamily: 'Verdana', fontSize: labelSize, color: '#ffffff',
      backgroundColor: '#1a3a5c',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(602).setVisible(false);
    this.allObjects.push(this.toastText);
  }

  private addDivider(y: number): void {
    const divider = this.scene.add.rectangle(
      this.panelWidth / 2, y, this.panelWidth - 8, 1,
      0xffffff, 0.08,
    ).setScrollFactor(0).setDepth(600);
    this.allObjects.push(divider);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  selectTool(tool: CreateTool): void {
    if (this.activeTool === tool) return;
    this.activeTool = tool;
    for (const ref of this.toolButtons) {
      const isActive = ref.tool === tool;
      ref.activebar.setAlpha(isActive ? 1 : 0);
      ref.bg.setFillStyle(isActive ? 0x1e4a7c : 0x1a3a5c, isActive ? 0.95 : 0.85);
    }
    EventBus.emit('tool:changed', { tool });
  }

  setUndoEnabled(enabled: boolean): void {
    this.undoEnabled = enabled;
    this.undoBg.setAlpha(enabled ? 1 : 0.4);
  }

  setRedoEnabled(enabled: boolean): void {
    this.redoEnabled = enabled;
    this.redoBg.setAlpha(enabled ? 1 : 0.4);
  }

  setSaveIndicator(state: 'saved' | 'unsaved' | 'saving'): void {
    const colors: Record<typeof state, string> = {
      saved: '#4ade80',
      unsaved: '#ffaa44',
      saving: '#4ad5ff',
    };
    const labels: Record<typeof state, string> = {
      saved: 'Saved',
      unsaved: 'Unsaved',
      saving: 'Saving…',
    };
    this.saveText.setColor(colors[state]);
    this.saveText.setText(labels[state]);
  }

  setVisible(visible: boolean): void {
    for (const obj of this.allObjects) {
      obj.setVisible(visible);
    }
  }

  destroy(): void {
    EventBus.off('ui:toast', this.toastHandler);
    for (const obj of this.allObjects) {
      obj.destroy();
    }
    this.allObjects = [];
  }

  // ── Toast ────────────────────────────────────────────────────────────────

  private showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    const color = type === 'error' ? '#ff8080' : type === 'success' ? '#4ade80' : '#ffffff';
    this.toastText.setColor(color);
    this.toastText.setText(message);
    this.toastText.setVisible(true);
    this.toastText.setAlpha(1);

    this.toastTimer = setTimeout(() => {
      this.scene.tweens.add({
        targets: this.toastText,
        alpha: 0,
        duration: 400,
        onComplete: () => this.toastText.setVisible(false),
      });
    }, 2500);
  }
}
