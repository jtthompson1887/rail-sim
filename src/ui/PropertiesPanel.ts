import Phaser from 'phaser';
import { EventBus } from '../services/EventBus';
import TrackManager from '../managers/TrackManager';
import { WorldManager } from '../managers/WorldManager';
import { scalePx, responsiveFontSize } from '../utils/responsive';
import { GameConfig } from '../config/GameConfig';
import type { SelectionManager } from '../systems/SelectionManager';
import { VehicleType, VEHICLE_TYPE_REGISTRY } from '../config/VehicleTypes';

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
 *   – place-vehicle tool active: vehicle type selector
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

  /** Currently selected vehicle type for the place-vehicle tool. */
  private activeVehicleType: VehicleType = 'locomotive';
  /** Buttons created for vehicle-type selection. */
  private vehicleTypeObjects: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = [];

  private onDeleteCallback: ((uuids: string[]) => void) | null = null;

  private readonly selectionChangedHandler = (data: { uuids: string[] }) => {
    if (this.currentActiveTool !== 'generator' && this.currentActiveTool !== 'place-vehicle') {
      this.refresh(data.uuids);
    }
  };

  private readonly toolChangedHandler = (data: { tool: string }) => {
    this.currentActiveTool = data.tool;
    if (data.tool === 'generator') {
      this.showGeneratorParams();
    } else if (data.tool === 'place-vehicle') {
      this.showVehicleParams();
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

  /** Return the currently selected vehicle type. */
  getVehicleType(): VehicleType {
    return this.activeVehicleType;
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
    this.clearVehicleObjects();
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
      const labelTxt = this.scene.add.text(px - pw / 2 + 8, rowY, def.label, {
        fontFamily: 'Verdana', fontSize: fsSm, color: '#8ab4d0',
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(600);
      this.lines.push(labelTxt);

      const valueTxt = this.scene.add.text(px + pw / 2 - 8, rowY, this.formatParam(def.key, def.format), {
        fontFamily: 'Verdana', fontSize: fsSm, color: '#d0e8ff',
      }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(600);
      this.lines.push(valueTxt);

      // Minus button
      const minusBtn = this.scene.add.rectangle(px - 20, rowY + 18, 28, 22, 0x1a3a5c, 0.9)
        .setStrokeStyle(1, 0x2a8cff, 0.3)
        .setScrollFactor(0).setDepth(599)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.adjustParam(def.key, -def.step, def.min, def.max);
          valueTxt.setText(this.formatParam(def.key, def.format));
        });
      this.paramObjects.push(minusBtn);
      const minusText = this.scene.add.text(px - 20, rowY + 18, '-', {
        fontFamily: 'Verdana', fontSize: fs, color: '#8ab4d0',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(600);
      this.paramObjects.push(minusText);

      // Plus button
      const plusBtn = this.scene.add.rectangle(px + 20, rowY + 18, 28, 22, 0x1a3a5c, 0.9)
        .setStrokeStyle(1, 0x2a8cff, 0.3)
        .setScrollFactor(0).setDepth(599)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.adjustParam(def.key, def.step, def.min, def.max);
          valueTxt.setText(this.formatParam(def.key, def.format));
        });
      this.paramObjects.push(plusBtn);
      const plusText = this.scene.add.text(px + 20, rowY + 18, '+', {
        fontFamily: 'Verdana', fontSize: fs, color: '#8ab4d0',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(600);
      this.paramObjects.push(plusText);

      rowY += 44;
    }

    // Run button
    const runBtn = this.scene.add.rectangle(px, rowY + 10, pw - 16, btnH, 0x1a6e3c, 0.9)
      .setStrokeStyle(1, 0x4ade80, 0.6)
      .setScrollFactor(0).setDepth(599)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => runBtn.setFillStyle(0x22a05a, 0.95))
      .on('pointerout', () => runBtn.setFillStyle(0x1a6e3c, 0.9))
      .on('pointerdown', () => EventBus.emit('generator:run', {}));
    this.paramObjects.push(runBtn);
    const runText = this.scene.add.text(px, rowY + 10, '▶ Generate', {
      fontFamily: 'Verdana', fontSize: fs, color: '#4ade80',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(600);
    this.paramObjects.push(runText);
  }

  private formatParam(key: keyof GeneratorParams, format?: (v: number) => string): string {
    const val = this.generatorParams[key];
    return format ? format(val as number) : String(val);
  }

  private adjustParam(key: keyof GeneratorParams, delta: number, min: number, max: number): void {
    const current = this.generatorParams[key];
    let next = (typeof current === 'number' ? current : 0) + delta;
    // Round to avoid float drift
    const decimals = Math.max(0, -Math.floor(Math.log10(Math.abs(delta))));
    next = Number(next.toFixed(decimals));
    next = Math.max(min, Math.min(max, next));
    (this.generatorParams as any)[key] = next;
  }

  // ── Vehicle params UI ──────────────────────────────────────────────────────

  private showVehicleParams(): void {
    this.clearLines();
    this.clearParamObjects();
    this.clearVehicleObjects();
    this.slideIn();
    this.deleteBtn.setVisible(false);
    this.deleteBtnText.setVisible(false);
    this.tunnelBtn.setVisible(false);
    this.tunnelBtnText.setVisible(false);

    const px = this.getOnscreenX();
    const { width, height } = this.scene.scale;
    const pw = this.panelWidth;
    const fs = responsiveFontSize(11, width, height, 9, 11);
    const btnH = scalePx(28, width, height, 24);
    const btnW = pw - 16;

    // Title
    const title = this.scene.add.text(px, 14, '🚂 VEHICLE', {
      fontFamily: 'Verdana', fontSize: fs, color: '#4ad5ff',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
    this.lines.push(title);

    const hint = this.scene.add.text(px, 34, 'Click on a track to place', {
      fontFamily: 'Verdana', fontSize: fs, color: '#6a8aa0', align: 'center',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
    this.lines.push(hint);

    let rowY = 66;
    for (const info of VEHICLE_TYPE_REGISTRY) {
      const isActive = this.activeVehicleType === info.id;
      const bg = this.scene.add.rectangle(px, rowY, btnW, btnH, isActive ? 0x1e4a7c : 0x1a3a5c, 0.9)
        .setStrokeStyle(1, isActive ? 0x4ad5ff : 0x2a8cff, isActive ? 0.8 : 0.3)
        .setScrollFactor(0).setDepth(599)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => {
          if (this.activeVehicleType !== info.id) bg.setFillStyle(0x1e4a6e, 0.95);
        })
        .on('pointerout', () => {
          if (this.activeVehicleType !== info.id) bg.setFillStyle(0x1a3a5c, 0.9);
        })
        .on('pointerdown', () => {
          this.activeVehicleType = info.id;
          EventBus.emit('vehicle:type-changed', { type: info.id });
          // Refresh UI to show active state
          this.showVehicleParams();
        });
      this.vehicleTypeObjects.push(bg);

      const text = this.scene.add.text(px, rowY, info.displayName, {
        fontFamily: 'Verdana', fontSize: fs, color: isActive ? '#4ad5ff' : '#8ab4d0',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(600);
      this.vehicleTypeObjects.push(text);

      rowY += btnH + 8;
    }
  }

  // ── Selection properties UI ────────────────────────────────────────────────

  private refresh(uuids: string[]): void {
    this.clearLines();
    this.clearParamObjects();
    this.clearVehicleObjects();
    this.deleteBtn.setVisible(true);
    this.deleteBtnText.setVisible(true);

    const count = uuids.length;
    if (count === 0) {
      this.slideOut();
      return;
    }

    this.slideIn();
    const px = this.getOnscreenX();
    const { width, height } = this.scene.scale;
    const fs = responsiveFontSize(11, width, height, 9, 11);
    const fsSm = responsiveFontSize(10, width, height, 8, 10);

    if (count === 1) {
      const track = this.trackManager.getTrack(uuids[0]);
      if (!track) {
        this.slideOut();
        return;
      }
      const { p0, p3 } = track.getControlPoints();
      const length = track.getCurvePath().getLength();
      const lines = [
        `UUID: ${track.getUUID().slice(0, 8)}…`,
        `Length: ${Math.round(length)}`,
        `Elevation: ${track.elevation?.toFixed(1) ?? '—'}`,
        `Tunnel: ${track.isTunnel ? 'Yes' : 'No'}`,
        `p0: (${Math.round(p0.x)}, ${Math.round(p0.y)})`,
        `p3: (${Math.round(p3.x)}, ${Math.round(p3.y)})`,
      ];
      let y = 14;
      for (const text of lines) {
        const txt = this.scene.add.text(px, y, text, {
          fontFamily: 'Verdana', fontSize: fsSm, color: '#8ab4d0',
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
        this.lines.push(txt);
        y += 18;
      }
      this.tunnelBtn.setVisible(true);
      this.tunnelBtnText.setVisible(true);
    } else {
      let totalLength = 0;
      for (const uuid of uuids) {
        const track = this.trackManager.getTrack(uuid);
        if (track) totalLength += track.getCurvePath().getLength();
      }
      const txt = this.scene.add.text(px, 14, `${count} tracks selected`, {
        fontFamily: 'Verdana', fontSize: fs, color: '#8ab4d0',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
      this.lines.push(txt);
      const lenTxt = this.scene.add.text(px, 36, `Total length: ${Math.round(totalLength)}`, {
        fontFamily: 'Verdana', fontSize: fsSm, color: '#8ab4d0',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
      this.lines.push(lenTxt);
      this.tunnelBtn.setVisible(true);
      this.tunnelBtnText.setVisible(true);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getOnscreenX(): number {
    const { width } = this.scene.scale;
    return width - this.panelWidth / 2;
  }

  private setPanelOffscreen(): void {
    const { width, height } = this.scene.scale;
    this.panel.setPosition(width + this.panelWidth / 2, height / 2);
    this.border.setPosition(width, height / 2);
  }

  private slideIn(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    const { width, height } = this.scene.scale;
    const targetX = width - this.panelWidth / 2;
    this.scene.tweens.add({
      targets: [this.panel, this.border],
      x: targetX,
      duration: 200,
      ease: 'Power2',
    });
  }

  private slideOut(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    const { width, height } = this.scene.scale;
    this.scene.tweens.add({
      targets: [this.panel, this.border],
      x: width + this.panelWidth / 2,
      duration: 200,
      ease: 'Power2',
    });
  }

  private clearLines(): void {
    for (const txt of this.lines) txt.destroy();
    this.lines = [];
  }

  private clearParamObjects(): void {
    for (const obj of this.paramObjects) obj.destroy();
    this.paramObjects = [];
  }

  private clearVehicleObjects(): void {
    for (const obj of this.vehicleTypeObjects) obj.destroy();
    this.vehicleTypeObjects = [];
  }

  private onDelete(): void {
    if (this.onDeleteCallback) {
      this.onDeleteCallback(this.selectionManager.selectedUUIDs);
    }
  }

  private onToggleTunnel(): void {
    for (const uuid of this.selectionManager.selectedUUIDs) {
      const track = this.trackManager.getTrack(uuid);
      if (track) {
        track.isTunnel = !track.isTunnel;
        const cps = track.getControlPoints();
        track.updateTrackVectors(cps.p0, cps.p1, cps.p2, cps.p3);
        WorldManager.updateTrackDef({
          uuid: track.getUUID(),
          p0: { x: cps.p0.x, y: cps.p0.y },
          p1: { x: cps.p1.x, y: cps.p1.y },
          p2: { x: cps.p2.x, y: cps.p2.y },
          p3: { x: cps.p3.x, y: cps.p3.y },
          isTunnel: track.isTunnel,
          elevation: track.elevation,
        });
      }
    }
    EventBus.emit('ui:toolbar-save-state', { state: 'unsaved' });
    this.refresh(this.selectionManager.selectedUUIDs);
  }

  destroy(): void {
    EventBus.off('selection:changed', this.selectionChangedHandler);
    EventBus.off('tool:changed', this.toolChangedHandler);
    this.clearLines();
    this.clearParamObjects();
    this.clearVehicleObjects();
    this.panel.destroy();
    this.border.destroy();
    this.deleteBtn.destroy();
    this.deleteBtnText.destroy();
    this.tunnelBtn.destroy();
    this.tunnelBtnText.destroy();
  }
}
