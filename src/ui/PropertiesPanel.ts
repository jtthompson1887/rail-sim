import Phaser from 'phaser';
import { EventBus } from '../services/EventBus';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import type { SelectionManager } from '../systems/SelectionManager';

/**
 * PropertiesPanel
 *
 * A right-side inspector panel that updates whenever the editor selection
 * changes.  Shows properties for:
 *   – No selection: world statistics
 *   – Single track: UUID, length, elevation, tunnel flag, delete button
 *   – Multiple tracks: count, total length, batch delete, batch tunnel
 *
 * The panel slides in/out with a tween when the selection changes.
 */
export class PropertiesPanel {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private selectionManager: SelectionManager;

  private panel!: Phaser.GameObjects.Rectangle;
  private border!: Phaser.GameObjects.Rectangle;
  private lines: Phaser.GameObjects.Text[] = [];
  private deleteBtn!: Phaser.GameObjects.Rectangle;
  private deleteBtnText!: Phaser.GameObjects.Text;
  private tunnelBtn!: Phaser.GameObjects.Rectangle;
  private tunnelBtnText!: Phaser.GameObjects.Text;

  readonly panelWidth = 200;
  private isVisible: boolean = false;

  private onDeleteCallback: ((uuids: string[]) => void) | null = null;

  private readonly selectionChangedHandler = (data: { uuids: string[] }) => {
    this.refresh(data.uuids);
  };

  constructor(
    scene: Phaser.Scene,
    trackManager: TrackManager,
    selectionManager: SelectionManager,
    onDelete: (uuids: string[]) => void,
  ) {
    this.scene = scene;
    this.trackManager = trackManager;
    this.selectionManager = selectionManager;
    this.onDeleteCallback = onDelete;
    this.build();
    EventBus.on('selection:changed', this.selectionChangedHandler);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('selection:changed', this.selectionChangedHandler);
    });
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  private build(): void {
    const { width, height } = this.scene.scale;
    const px = width; // starts off-screen (right edge)

    this.panel = this.scene.add.rectangle(
      px - this.panelWidth / 2, height / 2,
      this.panelWidth, height,
      0x06131f, 0.95,
    ).setScrollFactor(0).setDepth(598);

    this.border = this.scene.add.rectangle(
      px - this.panelWidth, height / 2,
      2, height,
      0xffffff, 0.12,
    ).setScrollFactor(0).setDepth(598);

    // Delete button
    this.deleteBtn = this.scene.add.rectangle(
      px - this.panelWidth / 2, height - 56,
      this.panelWidth - 16, 28,
      0x7a1a1a, 0.9,
    ).setScrollFactor(0).setDepth(599)
      .setStrokeStyle(1, 0xff4444, 0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.deleteBtn.setFillStyle(0xaa2222, 1))
      .on('pointerout',  () => this.deleteBtn.setFillStyle(0x7a1a1a, 0.9))
      .on('pointerdown', () => this.onDelete());

    this.deleteBtnText = this.scene.add.text(px - this.panelWidth / 2, height - 56, '🗑 Delete', {
      fontFamily: 'Verdana', fontSize: '11px', color: '#ff8080',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(600);

    // Tunnel toggle button
    this.tunnelBtn = this.scene.add.rectangle(
      px - this.panelWidth / 2, height - 92,
      this.panelWidth - 16, 28,
      0x1a3a5c, 0.9,
    ).setScrollFactor(0).setDepth(599)
      .setStrokeStyle(1, 0x2a8cff, 0.4)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.tunnelBtn.setFillStyle(0x1e4a7c, 1))
      .on('pointerout',  () => this.tunnelBtn.setFillStyle(0x1a3a5c, 0.9))
      .on('pointerdown', () => this.onToggleTunnel());

    this.tunnelBtnText = this.scene.add.text(px - this.panelWidth / 2, height - 92, '🚇 Toggle Tunnel', {
      fontFamily: 'Verdana', fontSize: '10px', color: '#8ab4d0',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(600);

    this.setPanelOffscreen();
    this.refresh([]);
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  private refresh(uuids: string[]): void {
    this.clearLines();
    const px = this.getOnscreenX();

    if (uuids.length === 0) {
      this.slideOut();
      return;
    }

    this.slideIn();

    if (uuids.length === 1) {
      const track = this.trackManager.getTrack(uuids[0]);
      if (track) {
        const curve = track.getCurvePath();
        const len = Math.round(curve.getLength());
        const shortId = track.getUUID().substring(0, 8);
        this.addLines(px, [
          { text: 'TRACK', color: '#4ad5ff', size: '10px' },
          { text: `ID: …${shortId}`, color: '#8ab4d0' },
          { text: `Length: ${len} u`, color: '#d0e8ff' },
          { text: `Elev: ${Math.round(track.elevation)} m`, color: '#d0e8ff' },
          { text: track.isTunnel ? '🚇 Tunnel' : '☀ Surface', color: '#aaddff' },
        ]);
        this.tunnelBtnText.setText(track.isTunnel ? '☀ Set Surface' : '🚇 Set Tunnel');
        this.deleteBtn.setVisible(true);
        this.deleteBtnText.setVisible(true);
        this.tunnelBtn.setVisible(true);
        this.tunnelBtnText.setVisible(true);
      }
    } else {
      // Multi-select
      let totalLen = 0;
      for (const uuid of uuids) {
        const track = this.trackManager.getTrack(uuid);
        if (track) totalLen += track.getCurvePath().getLength();
      }
      this.addLines(px, [
        { text: 'SELECTION', color: '#4ad5ff', size: '10px' },
        { text: `${uuids.length} tracks`, color: '#d0e8ff' },
        { text: `Total: ${Math.round(totalLen)} u`, color: '#d0e8ff' },
      ]);
      this.tunnelBtnText.setText('🚇 Toggle Tunnel');
      this.deleteBtn.setVisible(true);
      this.deleteBtnText.setText(`🗑 Delete (${uuids.length})`);
      this.deleteBtnText.setVisible(true);
      this.tunnelBtn.setVisible(true);
      this.tunnelBtnText.setVisible(true);
    }
  }

  private addLines(panelCentreX: number, items: Array<{ text: string; color?: string; size?: string }>): void {
    const { height } = this.scene.scale;
    const startY = 20;
    items.forEach((item, i) => {
      const t = this.scene.add.text(panelCentreX, startY + i * 20, item.text, {
        fontFamily: 'Verdana',
        fontSize: item.size ?? '11px',
        color: item.color ?? '#d0e8ff',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
      this.lines.push(t);
    });
    void height; // unused here; kept for future bottom-anchored layout
  }

  private clearLines(): void {
    for (const t of this.lines) t.destroy();
    this.lines = [];
  }

  // ── Slide animation ────────────────────────────────────────────────────────

  private getOnscreenX(): number {
    return this.scene.scale.width - this.panelWidth / 2;
  }

  private setPanelOffscreen(): void {
    const offX = this.scene.scale.width + this.panelWidth;
    this.panel.setX(offX);
    this.border.setX(offX - this.panelWidth / 2);
    this.deleteBtn.setX(offX);
    this.deleteBtnText.setX(offX);
    this.tunnelBtn.setX(offX);
    this.tunnelBtnText.setX(offX);
  }

  private slideIn(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    const px = this.getOnscreenX();
    const { width, height } = this.scene.scale;
    this.scene.tweens.add({
      targets: [this.panel, this.deleteBtn, this.deleteBtnText, this.tunnelBtn, this.tunnelBtnText],
      x: px,
      duration: 180,
      ease: 'Cubic.Out',
    });
    this.scene.tweens.add({
      targets: this.border,
      x: width - this.panelWidth,
      duration: 180,
      ease: 'Cubic.Out',
    });
    void height;
  }

  private slideOut(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    const offX = this.scene.scale.width + this.panelWidth;
    this.scene.tweens.add({
      targets: [this.panel, this.deleteBtn, this.deleteBtnText, this.tunnelBtn, this.tunnelBtnText],
      x: offX,
      duration: 160,
      ease: 'Cubic.In',
    });
    this.scene.tweens.add({
      targets: this.border,
      x: offX - this.panelWidth / 2,
      duration: 160,
      ease: 'Cubic.In',
    });
    this.deleteBtn.setVisible(false);
    this.deleteBtnText.setVisible(false);
    this.tunnelBtn.setVisible(false);
    this.tunnelBtnText.setVisible(false);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private onDelete(): void {
    const uuids = this.selectionManager.selectedUUIDs;
    if (this.onDeleteCallback) this.onDeleteCallback(uuids);
  }

  private onToggleTunnel(): void {
    const uuids = this.selectionManager.selectedUUIDs;
    for (const uuid of uuids) {
      const track = this.trackManager.getTrack(uuid);
      if (!track) continue;
      track.isTunnel = !track.isTunnel;
      const def = WorldManager.world?.tracks.find((t) => t.uuid === uuid);
      if (def) def.isTunnel = track.isTunnel;
      // Redraw the track to reflect tunnel state change
      const cp = track.getControlPoints();
      track.updateTrackVectors(cp.p0, cp.p1, cp.p2, cp.p3);
    }
    // Trigger refresh with current selection
    this.refresh(uuids);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  destroy(): void {
    EventBus.off('selection:changed', this.selectionChangedHandler);
    this.clearLines();
    this.panel.destroy();
    this.border.destroy();
    this.deleteBtn.destroy();
    this.deleteBtnText.destroy();
    this.tunnelBtn.destroy();
    this.tunnelBtnText.destroy();
  }
}
