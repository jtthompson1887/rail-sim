import Phaser from 'phaser';
import { EventBus } from '../services/EventBus';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import { scalePx, responsiveFontSize } from '../utils/responsive';
import { GameConfig } from '../config/GameConfig';
import type { SelectionManager } from '../systems/SelectionManager';

/** Generator configuration exposed to the caller via getGeneratorParams(). */
export interface GeneratorParams {
  sections: number;
  minLength: number;
  maxLength: number;
  curveProbability: number; // 0–1
  minCurveAngle: number;
  maxCurveAngle: number;
}

/**
 * PropertiesPanel
 *
 * A right-side inspector panel that updates whenever the editor selection
 * changes or the active tool changes.  Shows properties for:
 *   – No selection / no special tool: empty (panel hidden)
 *   – Generator tool active: editable generation parameters
 *   – Single track selected: UUID, length, elevation, tunnel flag, delete button
 *   – Multiple tracks selected: count, total length, batch delete, batch tunnel
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
  /** Interactive game objects created for the generator-params UI (buttons+labels). */
  private paramObjects: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = [];
  private deleteBtn!: Phaser.GameObjects.Rectangle;
  private deleteBtnText!: Phaser.GameObjects.Text;
  private tunnelBtn!: Phaser.GameObjects.Rectangle;
  private tunnelBtnText!: Phaser.GameObjects.Text;

  readonly panelWidth: number;
  private isVisible: boolean = false;
  private currentActiveTool: string = 'none';

  /** Mutable generator parameters; edited via the panel UI. */
  private generatorParams: GeneratorParams = {
    sections:         GameConfig.GENERATION.MAIN.SECTIONS,
    minLength:        GameConfig.GENERATION.MAIN.MIN_LENGTH,
    maxLength:        GameConfig.GENERATION.MAIN.MAX_LENGTH,
    curveProbability: GameConfig.GENERATION.MAIN.CURVE_PROB,
    minCurveAngle:    GameConfig.GENERATION.MAIN.MIN_ANGLE,
    maxCurveAngle:    GameConfig.GENERATION.MAIN.MAX_ANGLE,
  };

  private onDeleteCallback: ((uuids: string[]) => void) | null = null;

  private readonly selectionChangedHandler = (data: { uuids: string[] }) => {
    if (this.currentActiveTool !== 'generator') {
      this.refresh(data.uuids);
    }
  };

  private readonly toolChangedHandler = (data: { tool: string }) => {
    this.currentActiveTool = data.tool;
    if (data.tool === 'generator') {
      this.showGeneratorParams();
    } else if (this.selectionManager.selectedUUIDs.length === 0) {
      this.slideOut();
    } else {
      this.refresh(this.selectionManager.selectedUUIDs);
    }
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
    const { width, height } = scene.scale;
    this.panelWidth = scalePx(200, width, height, 160);
    this.build();
    EventBus.on('selection:changed', this.selectionChangedHandler);
    EventBus.on('tool:changed', this.toolChangedHandler);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('selection:changed', this.selectionChangedHandler);
      EventBus.off('tool:changed', this.toolChangedHandler);
    });
  }

  /** Return a copy of the current generator parameters set via the panel UI. */
  getGeneratorParams(): GeneratorParams {
    return { ...this.generatorParams };
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  private build(): void {
    const { width, height } = this.scene.scale;
    const px = width; // starts off-screen (right edge)
    const pw = this.panelWidth;
    const btnH = scalePx(28, width, height, 24);
    const btnW = pw - 16;
    const fs = responsiveFontSize(11, width, height, 9, 11);
    const fsSm = responsiveFontSize(10, width, height, 8, 10);

    this.panel = this.scene.add.rectangle(
      px - pw / 2, height / 2,
      pw, height,
      0x06131f, 0.95,
    ).setScrollFactor(0).setDepth(598);

    this.border = this.scene.add.rectangle(
      px - pw, height / 2,
      2, height,
      0xffffff, 0.12,
    ).setScrollFactor(0).setDepth(598);

    // Delete button
    this.deleteBtn = this.scene.add.rectangle(
      px - pw / 2, height - (btnH + 12),
      btnW, btnH,
      0x7a1a1a, 0.9,
    ).setScrollFactor(0).setDepth(599)
      .setStrokeStyle(1, 0xff4444, 0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.deleteBtn.setFillStyle(0xaa2222, 1))
      .on('pointerout',  () => this.deleteBtn.setFillStyle(0x7a1a1a, 0.9))
      .on('pointerdown', () => this.onDelete());

    this.deleteBtnText = this.scene.add.text(px - pw / 2, height - (btnH + 12), '🗑 Delete', {
      fontFamily: 'Verdana', fontSize: fs, color: '#ff8080',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(600);

    // Tunnel toggle button
    this.tunnelBtn = this.scene.add.rectangle(
      px - pw / 2, height - (btnH * 2 + 20),
      btnW, btnH,
      0x1a3a5c, 0.9,
    ).setScrollFactor(0).setDepth(599)
      .setStrokeStyle(1, 0x2a8cff, 0.4)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.tunnelBtn.setFillStyle(0x1e4a7c, 1))
      .on('pointerout',  () => this.tunnelBtn.setFillStyle(0x1a3a5c, 0.9))
      .on('pointerdown', () => this.onToggleTunnel());

    this.tunnelBtnText = this.scene.add.text(px - pw / 2, height - (btnH * 2 + 20), '🚇 Toggle Tunnel', {
      fontFamily: 'Verdana', fontSize: fsSm, color: '#8ab4d0',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(600);

    this.setPanelOffscreen();
    this.refresh([]);
  }

  // ── Generator params UI ────────────────────────────────────────────────────

  private showGeneratorParams(): void {
    this.clearLines();
    this.clearParamObjects();
    this.slideIn();
    this.deleteBtn.setVisible(false);
    this.deleteBtnText.setVisible(false);
    this.tunnelBtn.setVisible(false);
    this.tunnelBtnText.setVisible(false);

    const px = this.getOnscreenX();
    const { width, height } = this.scene.scale;
    const pw = this.panelWidth;
    const fs = responsiveFontSize(11, width, height, 9, 11);
    const fsSm = responsiveFontSize(10, width, height, 8, 10);
    const btnH = scalePx(22, width, height, 20);

    // Title
    const title = this.scene.add.text(px, 14, '⚙ GENERATOR', {
      fontFamily: 'Verdana', fontSize: fs, color: '#4ad5ff',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
    this.lines.push(title);

    const hint = this.scene.add.text(px, 30, 'Click near endpoint\nor anywhere to place', {
      fontFamily: 'Verdana', fontSize: fsSm, color: '#6a8aa0', align: 'center',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
    this.lines.push(hint);

    let rowY = 62;
    const paramDefs: Array<{
      label: string;
      key: keyof GeneratorParams;
      step: number;
      min: number;
      max: number;
      format?: (v: number) => string;
    }> = [
      { label: 'Sections',    key: 'sections',         step: 1,    min: 1,  max: 20  },
      { label: 'Min length',  key: 'minLength',        step: 50,   min: 50, max: 2000 },
      { label: 'Max length',  key: 'maxLength',        step: 100,  min: 100, max: 4000 },
      { label: 'Curve %',     key: 'curveProbability', step: 0.1,  min: 0,  max: 1, format: (v) => `${Math.round(v * 100)}%` },
      { label: 'Min angle°',  key: 'minCurveAngle',    step: 5,    min: 5,  max: 60 },
      { label: 'Max angle°',  key: 'maxCurveAngle',    step: 5,    min: 10, max: 90 },
    ];

    for (const def of paramDefs) {
      const labelTxt = this.scene.add.text(px - pw / 2 + 6, rowY, def.label, {
        fontFamily: 'Verdana', fontSize: fsSm, color: '#8ab4d0',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(600);
      this.lines.push(labelTxt);

      const valStr = def.format
        ? def.format(this.generatorParams[def.key] as number)
        : String(this.generatorParams[def.key]);
      const valTxt = this.scene.add.text(px, rowY, valStr, {
        fontFamily: 'Verdana', fontSize: fs, color: '#d0e8ff',
      }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(600);
      this.lines.push(valTxt);

      // '−' button
      const minusBg = this.scene.add.rectangle(px + pw / 2 - 28, rowY, btnH + 2, btnH, 0x1a3a5c, 0.85)
        .setStrokeStyle(1, 0x2a8cff, 0.4)
        .setScrollFactor(0).setDepth(600)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          const cur = this.generatorParams[def.key] as number;
          const next = Math.max(def.min, parseFloat((cur - def.step).toFixed(4)));
          this.setGeneratorParam(def.key, next);
          const newStr = def.format ? def.format(next) : String(next);
          valTxt.setText(newStr);
        });
      this.paramObjects.push(minusBg);

      const minusLbl = this.scene.add.text(px + pw / 2 - 28, rowY, '−', {
        fontFamily: 'Verdana', fontSize: fs, color: '#8ab4d0',
      }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(601);
      this.paramObjects.push(minusLbl);

      // '+' button
      const plusBg = this.scene.add.rectangle(px + pw / 2 - 8, rowY, btnH + 2, btnH, 0x1a3a5c, 0.85)
        .setStrokeStyle(1, 0x2a8cff, 0.4)
        .setScrollFactor(0).setDepth(600)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          const cur = this.generatorParams[def.key] as number;
          const next = Math.min(def.max, parseFloat((cur + def.step).toFixed(4)));
          this.setGeneratorParam(def.key, next);
          const newStr = def.format ? def.format(next) : String(next);
          valTxt.setText(newStr);
        });
      this.paramObjects.push(plusBg);

      const plusLbl = this.scene.add.text(px + pw / 2 - 8, rowY, '+', {
        fontFamily: 'Verdana', fontSize: fs, color: '#8ab4d0',
      }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(601);
      this.paramObjects.push(plusLbl);

      rowY += btnH + 6;
    }

    // 'Generate' action button
    const genBtnY = rowY + 8;
    const genBg = this.scene.add.rectangle(px, genBtnY, pw - 16, btnH + 4, 0x1a5a3c, 0.9)
      .setStrokeStyle(1, 0x4ade80, 0.6)
      .setScrollFactor(0).setDepth(600)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => genBg.setFillStyle(0x22804a, 0.95))
      .on('pointerout',  () => genBg.setFillStyle(0x1a5a3c, 0.9))
      .on('pointerdown', () => EventBus.emit('generator:run', {}));
    this.paramObjects.push(genBg);

    const genLbl = this.scene.add.text(px, genBtnY, '⚙ Generate', {
      fontFamily: 'Verdana', fontSize: fs, color: '#4ade80',
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(601);
    this.paramObjects.push(genLbl);
  }

  /** Type-safe setter for individual generator params. */
  private setGeneratorParam<K extends keyof GeneratorParams>(key: K, value: GeneratorParams[K]): void {
    this.generatorParams[key] = value;
  }

  private clearParamObjects(): void {
    for (const go of this.paramObjects) {
      go.destroy();
    }
    this.paramObjects = [];
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  private refresh(uuids: string[]): void {
    this.clearLines();
    this.clearParamObjects();
    const px = this.getOnscreenX();
    const { width, height } = this.scene.scale;
    const fs = responsiveFontSize(11, width, height, 9, 11);
    const fsSm = responsiveFontSize(10, width, height, 8, 10);

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
          { text: 'TRACK', color: '#4ad5ff', size: fsSm },
          { text: `ID: …${shortId}`, color: '#8ab4d0', size: fsSm },
          { text: `Length: ${len} u`, color: '#d0e8ff', size: fs },
          { text: `Elev: ${Math.round(track.elevation)} m`, color: '#d0e8ff', size: fs },
          { text: track.isTunnel ? '🚇 Tunnel' : '☀ Surface', color: '#aaddff', size: fs },
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
        { text: 'SELECTION', color: '#4ad5ff', size: fsSm },
        { text: `${uuids.length} tracks`, color: '#d0e8ff', size: fs },
        { text: `Total: ${Math.round(totalLen)} u`, color: '#d0e8ff', size: fs },
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
    const { width, height } = this.scene.scale;
    const defaultFs = responsiveFontSize(11, width, height, 9, 11);
    const lineH = scalePx(20, width, height, 16);
    const startY = 16;
    items.forEach((item, i) => {
      const t = this.scene.add.text(panelCentreX, startY + i * lineH, item.text, {
        fontFamily: 'Verdana',
        fontSize: item.size ?? defaultFs,
        color: item.color ?? '#d0e8ff',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
      this.lines.push(t);
    });
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
    const pw = this.panelWidth;
    this.panel.setX(offX);
    this.border.setX(offX - pw / 2);
    this.deleteBtn.setX(offX);
    this.deleteBtnText.setX(offX);
    this.tunnelBtn.setX(offX);
    this.tunnelBtnText.setX(offX);
  }

  private slideIn(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    const px = this.getOnscreenX();
    const { width } = this.scene.scale;
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
    EventBus.off('tool:changed', this.toolChangedHandler);
    this.clearLines();
    this.clearParamObjects();
    this.panel.destroy();
    this.border.destroy();
    this.deleteBtn.destroy();
    this.deleteBtnText.destroy();
    this.tunnelBtn.destroy();
    this.tunnelBtnText.destroy();
  }
}
