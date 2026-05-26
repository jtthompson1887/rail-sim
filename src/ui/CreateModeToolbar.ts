import Phaser from 'phaser';
import { ToolbarButton } from './ToolbarButton';
import { EventBus } from '../services/EventBus';
import { isMobileWidth } from '../utils/responsive';

export type CreateTool = 'generator' | 'junction' | 'completer' | 'select' | 'none';

/** Short labels used on narrow (mobile) screens to fit within the toolbar. */
const MOBILE_LABELS: Record<string, string> = {
  generator: '⚙',
  junction: '⑃',
  completer: '⟷',
  select: '↖',
};

/**
 * CreateModeToolbar
 *
 * The always-visible panel shown in create mode. Contains tool buttons for:
 *   – Track Generator (auto-generate tracks with parameters)
 *   – Junction Creator (draw a selection box to split and branch tracks)
 *   – Track Completer (connect two dangling endpoints)
 *   – Select / Move (click tracks to select, drag endpoints to reshape)
 *
 * The toolbar adapts to the current screen width: on narrow (mobile) screens
 * buttons use icon-only labels and the panel shrinks to fill the viewport.
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
    const mobile = isMobileWidth(width);

    // Panel dimensions – fills full width on mobile, capped at 720 on desktop
    const panelH = mobile ? 56 : 80;
    const panelW = mobile ? width - 8 : Math.min(width - 16, 720);
    const panelX = width / 2;
    const panelY = mobile ? 32 : 50;

    this.panel = this.scene.add.rectangle(panelX, panelY, panelW, panelH, 0x06131f, 0.9)
      .setStrokeStyle(2, 0xffffff, 0.2)
      .setDepth(599)
      .setScrollFactor(0);

    const gap = mobile ? 4 : 10;
    const btnCount = 4;
    const btnW = Math.floor((panelW - gap * (btnCount + 1)) / btnCount);
    const btnH = panelH - (mobile ? 8 : 16);
    const labelFontSize = mobile ? '14px' : '22px';
    const startX = panelX - (panelW / 2) + gap + btnW / 2;

    const toolDefs: Array<{ tool: CreateTool; label: string; tooltip: string }> = [
      { tool: 'generator', label: mobile ? MOBILE_LABELS.generator : '⚙ Generator', tooltip: 'Auto-generate tracks' },
      { tool: 'junction',  label: mobile ? MOBILE_LABELS.junction  : '⑃ Junction',  tooltip: 'Right-drag to create junction' },
      { tool: 'completer', label: mobile ? MOBILE_LABELS.completer : '⟷ Completer', tooltip: 'Connect two endpoints' },
      { tool: 'select',    label: mobile ? MOBILE_LABELS.select    : '↖ Select',    tooltip: 'Select & move tracks' },
    ];

    toolDefs.forEach((def, i) => {
      const x = startX + i * (btnW + gap);
      const btn = new ToolbarButton(this.scene, x, panelY, {
        label: def.label,
        tooltip: def.tooltip,
        width: btnW,
        height: btnH,
        labelFontSize,
        onPress: () => this.selectTool(def.tool),
      });
      this.buttons.push(btn);
    });

    // Toast / notification text
    const toastFontSize = mobile ? '14px' : '20px';
    this.toastText = this.scene.add.text(panelX, panelY + panelH, '', {
      fontFamily: 'Verdana',
      fontSize: toastFontSize,
      color: '#ffffff',
      backgroundColor: '#00000099',
      padding: { x: mobile ? 8 : 12, y: mobile ? 4 : 6 },
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
