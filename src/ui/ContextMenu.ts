import Phaser from 'phaser';
import { EventBus } from '../services/EventBus';
import TrackManager from '../managers/TrackManager';
import {
  CONSTRUCTION_ANALYSIS_LOCK_REASON,
  CONSTRUCTION_ECONOMY_LOCK_REASON,
} from './EditorToolbar';

export interface MenuItem {
  label: string;
  action: () => void;
  color?: string;
}

/**
 * ContextMenu
 *
 * A lightweight right-click context menu that floats at cursor position.
 * Items are defined at show-time so the menu content can be contextual.
 *
 * Closes automatically on:
 *   – any left-click outside the menu
 *   – Escape key
 */
export class ContextMenu {
  private scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private bg!: Phaser.GameObjects.Rectangle;
  private itemTexts: Phaser.GameObjects.Text[] = [];
  private itemBgs: Phaser.GameObjects.Rectangle[] = [];
  private isOpen: boolean = false;

  private readonly ITEM_HEIGHT = 28;
  private readonly MENU_WIDTH  = 180;
  private readonly PADDING     = 6;

  private readonly closeHandler = (pointer: Phaser.Input.Pointer) => {
    if (!this.isOpen) return;
    const bounds = this.getScreenBounds();
    if (pointer.x < bounds.x || pointer.x > bounds.x + bounds.w ||
        pointer.y < bounds.y || pointer.y > bounds.y + bounds.h) {
      this.close();
    }
  };

  private readonly escHandler = (event: KeyboardEvent) => {
    if (event.code === 'Escape') this.close();
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.buildContainer();
    scene.input.on('pointerdown', this.closeHandler);
    scene.input.keyboard.on('keydown', this.escHandler);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  private buildContainer(): void {
    this.container = this.scene.add.container(0, 0)
      .setDepth(700)
      .setScrollFactor(0)
      .setVisible(false);

    this.bg = this.scene.add.rectangle(0, 0, this.MENU_WIDTH, 10, 0x0d1e2e, 0.97)
      .setStrokeStyle(1, 0x2a8cff, 0.5)
      .setOrigin(0, 0);
    this.container.add(this.bg);
  }

  /**
   * Show the context menu at the given screen-space position with the
   * provided items.
   */
  show(screenX: number, screenY: number, items: MenuItem[]): void {
    this.close(); // clear previous items

    const totalH = this.PADDING * 2 + items.length * this.ITEM_HEIGHT;
    const { width, height } = this.scene.scale;

    // Flip if near edge
    const x = screenX + this.MENU_WIDTH > width  ? screenX - this.MENU_WIDTH : screenX;
    const y = screenY + totalH           > height ? screenY - totalH          : screenY;

    this.bg.setSize(this.MENU_WIDTH, totalH);
    this.container.setPosition(x, y);

    items.forEach((item, idx) => {
      const iy = this.PADDING + idx * this.ITEM_HEIGHT;

      const rowBg = this.scene.add.rectangle(
        1, iy, this.MENU_WIDTH - 2, this.ITEM_HEIGHT - 1, 0x1a3a5c, 0,
      ).setOrigin(0, 0).setInteractive({ useHandCursor: true })
        .on('pointerover', () => rowBg.setFillStyle(0x1e4a7c, 0.8))
        .on('pointerout',  () => rowBg.setFillStyle(0x1a3a5c, 0))
        .on('pointerdown', () => {
          item.action();
          this.close();
        });

      const text = this.scene.add.text(
        this.PADDING, iy + this.ITEM_HEIGHT / 2,
        item.label,
        { fontFamily: 'Verdana', fontSize: '12px', color: item.color ?? '#d0e8ff' },
      ).setOrigin(0, 0.5);

      this.container.add([rowBg, text]);
      this.itemBgs.push(rowBg);
      this.itemTexts.push(text);
    });

    this.container.setVisible(true);
    this.isOpen = true;
  }

  close(): void {
    if (!this.isOpen) return;
    // Destroy previous item game objects
    for (const t of this.itemTexts) t.destroy();
    for (const b of this.itemBgs)   b.destroy();
    this.itemTexts = [];
    this.itemBgs   = [];
    this.container.setVisible(false);
    this.isOpen = false;
  }

  private getScreenBounds(): { x: number; y: number; w: number; h: number } {
    return {
      x: this.container.x,
      y: this.container.y,
      w: this.MENU_WIDTH,
      h: this.PADDING * 2 + this.itemTexts.length * this.ITEM_HEIGHT,
    };
  }

  destroy(): void {
    this.close();
    this.scene.input.off('pointerdown', this.closeHandler);
    this.scene.input.keyboard.off('keydown', this.escHandler);
    this.container.destroy();
  }
}

// ── Factory helpers ────────────────────────────────────────────────────────

/**
 * Build the context menu item list for a track selection.
 */
export function buildTrackContextItems(
  trackManager: TrackManager,
  selectedUUIDs: string[],
  onDelete: (uuids: string[]) => void,
): MenuItem[] {
  const items: MenuItem[] = [];

  if (selectedUUIDs.length === 0) return items;

  if (selectedUUIDs.length === 1) {
    const track = trackManager.getTrack(selectedUUIDs[0]);
    if (track) {
      items.push({
        label: 'Structures locked to engineering analysis',
        action: () => {
          EventBus.emit('ui:toast', {
            message: CONSTRUCTION_ANALYSIS_LOCK_REASON,
            type: 'info',
          });
        },
      });
    }
  }

  items.push({
    label: 'Deletion requires an economy-aware command',
    action: () => {
      void onDelete;
      EventBus.emit('ui:toast', {
        message: CONSTRUCTION_ECONOMY_LOCK_REASON,
        type: 'info',
      });
    },
  });

  return items;
}

/** Build context menu items for an empty-space right-click. */
export function buildEmptyContextItems(
  _screenX: number,
  _screenY: number,
  _onGenerateHere: (sx: number, sy: number) => void,
): MenuItem[] {
  return [];
}
