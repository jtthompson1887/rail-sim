import Phaser from 'phaser';
import { ToolbarButton } from './ToolbarButton';
import { EventBus } from '../services/EventBus';

export type CreateTool = 'generator' | 'junction' | 'completer' | 'select' | 'none';

/**
 * CreateModeToolbar
 *
 * The always-visible panel shown in create mode. Contains tool buttons for:
 *   – Track Generator (auto-generate tracks with parameters)
 *   – Junction Creator (draw a selection box to split and branch tracks)
 *   – Track Completer (connect two dangling endpoints)
 *   – Select / Move (click tracks to select, drag endpoints to reshape)
 *
 * Emits 'tool:changed' events via EventBus when the active tool changes.
 */
export class CreateModeToolbar {
  private scene: Phaser.Scene;
  private panel!: Phaser.GameObjects.Rectangle;
  private buttons: ToolbarButton[] = [];
  private activeTool: CreateTool = 'none';
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly toastHandler = (data: { message: string; type: 'info' | 'error' | 'success' }) => {
    this.showToast(data.message, data.type);
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.build();
    EventBus.on('ui:toast', this.toastHandler);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('ui:toast', this.toastHandler);
    });
  }

  get currentTool(): CreateTool { return this.activeTool; }

  // ── Build ──────────────────────────────────────────────────────────────────

  private build(): void {
    const { width } = this.scene.scale;
    const panelW = 720;
    const panelH = 80;
    const panelX = width / 2;
    const panelY = 50;

    this.panel = this.scene.add.rectangle(panelX, panelY, panelW, panelH, 0x06131f, 0.9)
      .setStrokeStyle(2, 0xffffff, 0.2)
      .setDepth(599)
      .setScrollFactor(0);

    const btnW = 160;
    const gap = 10;
    const startX = panelX - (btnW * 2 + gap * 1.5);

    const toolDefs: Array<{ tool: CreateTool; label: string; tooltip: string }> = [
      { tool: 'generator', label: '⚙ Generator',  tooltip: 'Auto-generate tracks' },
      { tool: 'junction',  label: '⑃ Junction',   tooltip: 'Right-drag to create junction' },
      { tool: 'completer', label: '⟷ Completer',  tooltip: 'Connect two endpoints' },
      { tool: 'select',    label: '↖ Select',      tooltip: 'Select & move tracks' },
    ];

    toolDefs.forEach((def, i) => {
      const x = startX + i * (btnW + gap);
      const btn = new ToolbarButton(this.scene, x, panelY, {
        label: def.label,
        tooltip: def.tooltip,
        width: btnW,
        height: panelH - 16,
        onPress: () => this.selectTool(def.tool),
      });
      this.buttons.push(btn);
    });

    // Toast / notification text
    this.toastText = this.scene.add.text(panelX, panelY + panelH, '', {
      fontFamily: 'Verdana',
      fontSize: '20px',
      color: '#ffffff',
      backgroundColor: '#00000099',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5, 0).setDepth(600).setScrollFactor(0).setAlpha(0);
  }

  // ── Tool selection ─────────────────────────────────────────────────────────

  selectTool(tool: CreateTool): void {
    if (this.activeTool === tool) {
      // Clicking the active tool deactivates it
      tool = 'none';
    }
    this.activeTool = tool;
    this.buttons.forEach((btn, i) => {
      const tools: CreateTool[] = ['generator', 'junction', 'completer', 'select'];
      btn.setActive(tools[i] === this.activeTool);
    });
    EventBus.emit('tool:changed', { tool: this.activeTool });
  }

  // ── Toast messages ─────────────────────────────────────────────────────────

  showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    const colors: Record<string, string> = {
      info: '#d2e6ff',
      error: '#ff6666',
      success: '#7dff9b',
    };
    this.toastText.setText(message).setColor(colors[type] ?? '#ffffff').setAlpha(1);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.scene.tweens.add({ targets: this.toastText, alpha: 0, duration: 600 });
    }, 2500);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  setVisible(visible: boolean): void {
    this.panel.setVisible(visible);
    this.buttons.forEach((b) => b.setVisible(visible));
    if (!visible) this.toastText.setAlpha(0);
  }

  destroy(): void {
    this.buttons.forEach((b) => b.destroy());
    this.panel.destroy();
    this.toastText.destroy();
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    EventBus.off('ui:toast', this.toastHandler);
  }
}
