import Phaser from 'phaser';
import { EventBus } from '../services/EventBus';
import TrackManager from '../managers/TrackManager';
import { scalePx, responsiveFontSize } from '../utils/responsive';
import type { SelectionManager } from '../systems/SelectionManager';
import { VehicleType, VEHICLE_TYPE_REGISTRY } from '../config/VehicleTypes';
import {
  GENERATOR_LOCK_REASON,
  RESHAPE_LOCK_REASON,
} from './EditorToolbar';

export interface DeleteTracksIntent {
  uuids: string[];
  expectedRefund: number;
  expectedRevision: number;
}

export interface DeletionReviewDTO {
  readonly uuids: ReadonlyArray<string>;
  readonly expectedRefund: number;
  readonly expectedRevision: number;
  readonly available: boolean;
  readonly blockingReason: string;
}

/**
 * PropertiesPanel
 *
 * A right-side inspector panel that updates whenever the editor selection
 * changes or the active tool changes.  Shows properties for:
 *   – No selection / no special tool: empty (panel hidden)
 *   – Generator tool active: concise unavailable explanation
 *   – place-vehicle tool active: vehicle type selector
 *   – Single track selected: UUID, length, analysed structures, delete button
 *   – Multiple tracks selected: count, total length, batch delete
 *
 * The panel slides in/out with a tween when the selection changes.
 */
export class PropertiesPanel {
  private scene: Phaser.Scene;
  private trackManager: TrackManager;
  private selectionManager: SelectionManager;

  private container!: Phaser.GameObjects.Container;
  private panel!: Phaser.GameObjects.Rectangle;
  private border!: Phaser.GameObjects.Rectangle;
  private lines: Phaser.GameObjects.Text[] = [];
  private deleteBtn!: Phaser.GameObjects.Rectangle;
  private deleteBtnText!: Phaser.GameObjects.Text;

  readonly panelWidth: number;
  private isVisible: boolean = false;
  private editorEnabled: boolean = true;
  private currentActiveTool: string = 'none';

  /** Currently selected vehicle type for the place-vehicle tool. */
  private activeVehicleType: VehicleType = 'locomotive';
  /** Buttons created for vehicle-type selection. */
  private vehicleTypeObjects: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = [];

  private onDeleteCallback: ((intent: DeleteTracksIntent) => void) | null = null;
  private deleteArmed = false;
  private armedDelete: DeleteTracksIntent | null = null;
  private deletionReview: DeletionReviewDTO | null = null;

  private readonly selectionChangedHandler = (data: { uuids: string[] }) => {
    this.disarmDelete();
    if (!this.editorEnabled) return;
    if (this.currentActiveTool !== 'generator' && this.currentActiveTool !== 'place-vehicle') {
      this.refresh(data.uuids);
    }
  };

  private readonly toolChangedHandler = (data: { tool: string }) => {
    this.disarmDelete();
    this.currentActiveTool = data.tool;
    if (!this.editorEnabled) return;
    if (data.tool === 'generator') {
      this.showGeneratorUnavailable();
    } else if (data.tool === 'place-vehicle') {
      this.showVehicleParams();
    } else if (data.tool === 'place-track') {
      this.slideOut();
    } else if (this.selectionManager.selectedUUIDs.length === 0) {
      this.slideOut();
    } else {
      this.refresh(this.selectionManager.selectedUUIDs);
    }
  };

  private readonly deletionReviewHandler = (review: DeletionReviewDTO) => {
    this.disarmDelete();
    this.deletionReview = Object.freeze({
      ...review,
      uuids: Object.freeze([...review.uuids]),
    });
    if (!this.editorEnabled
      || this.currentActiveTool === 'generator'
      || this.currentActiveTool === 'place-vehicle'
      || this.currentActiveTool === 'place-track') return;
    this.refresh(this.selectionManager.selectedUUIDs);
  };

  constructor(
    scene: Phaser.Scene,
    trackManager: TrackManager,
    selectionManager: SelectionManager,
    onDelete: (intent: DeleteTracksIntent) => void,
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
    EventBus.on('ui:deletion-review', this.deletionReviewHandler);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      EventBus.off('selection:changed', this.selectionChangedHandler);
      EventBus.off('tool:changed', this.toolChangedHandler);
      EventBus.off('ui:deletion-review', this.deletionReviewHandler);
    });
  }

  /** Return the currently selected vehicle type. */
  getVehicleType(): VehicleType {
    return this.activeVehicleType;
  }

  containsScreenPoint(x: number, y: number): boolean {
    if (!this.editorEnabled || !this.isVisible) return false;
    return x >= this.scene.scale.width - this.panelWidth
      && x <= this.scene.scale.width
      && y >= 0
      && y <= this.scene.scale.height;
  }

  setVisible(visible: boolean): void {
    this.disarmDelete();
    this.editorEnabled = visible;
    this.container.setVisible(visible).setActive(visible);
    if (!visible) {
      this.setInteractionsEnabled(false);
      return;
    }

    if (this.currentActiveTool === 'generator') {
      this.showGeneratorUnavailable();
    } else if (this.currentActiveTool === 'place-vehicle') {
      this.showVehicleParams();
    } else if (this.currentActiveTool === 'place-track') {
      this.slideOut();
    } else {
      this.refresh(this.selectionManager.selectedUUIDs);
    }
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  private build(): void {
    const { width, height } = this.scene.scale;
    const px = width; // starts off-screen (right edge)
    const pw = this.panelWidth;
    const btnH = scalePx(28, width, height, 24);
    const btnW = pw - 16;
    const fs = responsiveFontSize(11, width, height, 9, 11);

    this.container = this.scene.add.container(0, 0).setDepth(598).setScrollFactor(0);

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

    this.container.add([
      this.panel,
      this.border,
      this.deleteBtn,
      this.deleteBtnText,
    ]);
    this.setPanelOffscreen();
    this.refresh([]);
  }

  // ── Disabled generator explanation ─────────────────────────────────────────

  private showGeneratorUnavailable(): void {
    this.clearLines();
    this.clearVehicleObjects();
    this.slideIn();
    this.deleteBtn.setVisible(false);
    this.deleteBtnText.setVisible(false);

    const px = this.getOnscreenX();
    const { width, height } = this.scene.scale;
    const fs = responsiveFontSize(11, width, height, 9, 11);
    const fsSm = responsiveFontSize(10, width, height, 8, 10);

    const title = this.scene.add.text(px, 14, 'GENERATOR DISABLED', {
      fontFamily: 'Verdana', fontSize: fs, color: '#8ab4d0',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
    this.lines.push(title);
    const hint = this.scene.add.text(
      px,
      38,
      GENERATOR_LOCK_REASON,
      {
        fontFamily: 'Verdana',
        fontSize: fsSm,
        color: '#6a8aa0',
        align: 'center',
        wordWrap: { width: this.panelWidth - 20 },
      },
    ).setOrigin(0.5, 0).setScrollFactor(0).setDepth(600);
    this.lines.push(hint);
    this.container.add(this.lines);
  }

  // ── Vehicle params UI ──────────────────────────────────────────────────────

  private showVehicleParams(): void {
    this.clearLines();
    this.clearVehicleObjects();
    this.slideIn();
    this.deleteBtn.setVisible(false);
    this.deleteBtnText.setVisible(false);

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
    this.container.add([...this.lines, ...this.vehicleTypeObjects]);
  }

  // ── Selection properties UI ────────────────────────────────────────────────

  private refresh(uuids: string[]): void {
    this.disarmDelete();
    this.clearLines();
    this.clearVehicleObjects();
    this.deleteBtn.setVisible(false);
    this.deleteBtnText.setVisible(false);

    const count = uuids.length;
    if (count === 0) {
      this.slideOut();
      return;
    }

    this.slideIn();
    const review = this.reviewFor(uuids);
    this.deleteBtn.setVisible(true);
    this.deleteBtnText.setVisible(true);
    if (!review) {
      this.deleteBtn.disableInteractive();
      this.deleteBtnText.setText('Delete · Review unavailable');
    } else if (!review.available) {
      this.deleteBtn.disableInteractive();
      this.deleteBtnText.setText(review.blockingReason);
    } else {
      this.deleteBtn.setInteractive({ useHandCursor: true });
      this.deleteBtnText.setText(
        `Delete · Refund £${review.expectedRefund.toLocaleString('en-GB')} (50%)`,
      );
    }
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
      const structureSummary = Array.from(
        new Set((track.structures ?? []).map((interval) => interval.type)),
      ).join(', ') || 'unavailable';
      const lines = [
        `UUID: ${track.getUUID().slice(0, 8)}…`,
        `Length: ${Math.round(length)}`,
        `Structures: ${structureSummary}`,
        `Paid build: ${track.paidBuildCost ?? 'unavailable'}`,
        RESHAPE_LOCK_REASON,
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
    }
    this.container.add(this.lines);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getOnscreenX(): number {
    const { width } = this.scene.scale;
    return width - this.panelWidth / 2;
  }

  private setPanelOffscreen(): void {
    this.container.setPosition(this.panelWidth, 0);
  }

  private slideIn(): void {
    if (!this.editorEnabled) return;
    if (this.isVisible) return;
    this.isVisible = true;
    this.scene.tweens.add({
      targets: this.container,
      x: 0,
      duration: 200,
      ease: 'Power2',
    });
  }

  private slideOut(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.scene.tweens.add({
      targets: this.container,
      x: this.panelWidth,
      duration: 200,
      ease: 'Power2',
    });
  }

  private clearLines(): void {
    for (const txt of this.lines) txt.destroy();
    this.lines = [];
  }

  private clearVehicleObjects(): void {
    for (const obj of this.vehicleTypeObjects) obj.destroy();
    this.vehicleTypeObjects = [];
  }

  private setInteractionsEnabled(enabled: boolean): void {
    const objects = [
      this.deleteBtn,
      ...this.vehicleTypeObjects,
    ];
    for (const object of objects) {
      if (!enabled
        || (object === this.deleteBtn
          && this.reviewFor(this.selectionManager.selectedUUIDs)?.available !== true)) {
        object.disableInteractive();
      }
      else object.setInteractive();
    }
  }

  private onDelete(): void {
    const uuids = [...this.selectionManager.selectedUUIDs];
    if (!this.editorEnabled || uuids.length === 0) return;
    const review = this.reviewFor(uuids);
    if (!review?.available) return;
    const intent: DeleteTracksIntent = {
      uuids,
      expectedRefund: review.expectedRefund,
      expectedRevision: review.expectedRevision,
    };
    if (!this.deleteArmed) {
      this.deleteArmed = true;
      this.armedDelete = intent;
      this.deleteBtnText.setText(
        `Confirm delete · Refund £${intent.expectedRefund.toLocaleString('en-GB')}`,
      );
      return;
    }
    const armed = this.armedDelete;
    this.disarmDelete();
    if (!armed
      || armed.expectedRevision !== intent.expectedRevision
      || armed.expectedRefund !== intent.expectedRefund
      || armed.uuids.length !== intent.uuids.length
      || armed.uuids.some((uuid, index) => uuid !== intent.uuids[index])) {
      this.refresh(uuids);
      return;
    }
    this.onDeleteCallback?.(intent);
    this.refresh(uuids);
  }

  private reviewFor(uuids: ReadonlyArray<string>): DeletionReviewDTO | null {
    const review = this.deletionReview;
    if (!review
      || review.uuids.length !== uuids.length
      || review.uuids.some((uuid, index) => uuid !== uuids[index])) return null;
    return review;
  }

  private disarmDelete(): void {
    this.deleteArmed = false;
    this.armedDelete = null;
  }

  destroy(): void {
    EventBus.off('selection:changed', this.selectionChangedHandler);
    EventBus.off('tool:changed', this.toolChangedHandler);
    EventBus.off('ui:deletion-review', this.deletionReviewHandler);
    this.clearLines();
    this.clearVehicleObjects();
    this.panel.destroy();
    this.border.destroy();
    this.deleteBtn.destroy();
    this.deleteBtnText.destroy();
    this.container.destroy();
  }
}
