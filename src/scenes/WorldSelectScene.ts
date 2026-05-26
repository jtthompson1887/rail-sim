import Phaser from 'phaser';
import { SaveService } from '../services/SaveService';
import { WorldManager } from '../managers/WorldManager';
import type { WorldData } from '../config/WorldData';

/**
 * WorldSelectScene – shows all saved worlds, lets the player create/load/delete.
 * Replaces the old LevelSelectScene.
 */
export default class WorldSelectScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WorldSelectScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x06131f, 1);

    this.add.text(width / 2, 70, 'Your Worlds', {
      fontFamily: 'Verdana',
      fontSize: '52px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.renderWorldList();

    // ── New World button ────────────────────────────────────────────────────
    const newWorldBtn = this.add.text(width / 2, height - 90, '+ New World', {
      fontFamily: 'Verdana',
      fontSize: '36px',
      color: '#7dff9b',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    newWorldBtn.setPadding(14);
    newWorldBtn.on('pointerover', () => newWorldBtn.setColor('#ffffff'));
    newWorldBtn.on('pointerout', () => newWorldBtn.setColor('#7dff9b'));
    newWorldBtn.on('pointerdown', () => this.promptNewWorld());

    // ── Back button ──────────────────────────────────────────────────────────
    const back = this.add.text(50, height - 70, '← Back', {
      fontFamily: 'Verdana',
      fontSize: '28px',
      color: '#ffffff',
    }).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('MenuScene'));
    back.setPadding(10);
  }

  private renderWorldList(): void {
    const { width } = this.scale;
    const worlds = SaveService.listWorlds();

    if (worlds.length === 0) {
      this.add.text(width / 2, 300, 'No worlds yet — create your first!', {
        fontFamily: 'Verdana',
        fontSize: '30px',
        color: '#9fc0ff',
      }).setOrigin(0.5);
      return;
    }

    const rowH = 120;
    const btnW = width * 0.72;
    let y = 200;

    for (const world of worlds) {
      this.renderWorldRow(world, width / 2, y, btnW, rowH);
      y += rowH + 16;
    }
  }

  private renderWorldRow(world: WorldData, cx: number, cy: number, w: number, h: number): void {
    const panel = this.add.rectangle(cx, cy, w, h, 0x0d2840, 0.95)
      .setStrokeStyle(2, 0xffffff, 0.35)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => panel.setFillStyle(0x1a4a7c, 0.95))
      .on('pointerout', () => panel.setFillStyle(0x0d2840, 0.95))
      .on('pointerdown', () => this.loadWorld(world));

    const updatedDate = new Date(world.metadata.updatedAt).toLocaleDateString();
    this.add.text(cx - w / 2 + 24, cy - 28, world.name, {
      fontFamily: 'Verdana',
      fontSize: '30px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0, 0.5);

    this.add.text(cx - w / 2 + 24, cy + 12, `Tracks: ${world.tracks.length}  |  Stations: ${world.stations.length}  |  Last edited: ${updatedDate}`, {
      fontFamily: 'Verdana',
      fontSize: '20px',
      color: '#9fc0ff',
    }).setOrigin(0, 0.5);

    // Delete button
    const del = this.add.text(cx + w / 2 - 24, cy, '🗑', {
      fontFamily: 'Verdana',
      fontSize: '32px',
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', (ptr: Phaser.Input.Pointer) => {
        ptr.event.stopPropagation();
        this.deleteWorld(world.id);
      });
    del.setPadding(8);
  }

  private loadWorld(world: WorldData): void {
    WorldManager.load(world.id);
    this.scene.start('WorldScene', { worldId: world.id, mode: 'create' });
  }

  private deleteWorld(worldId: string): void {
    SaveService.deleteWorld(worldId);
    this.scene.restart();
  }

  private promptNewWorld(): void {
    const name = `World ${SaveService.listWorlds().length + 1}`;
    const world = WorldManager.createNew(name);
    WorldManager.save();
    this.scene.start('WorldScene', { worldId: world.id, mode: 'create' });
  }
}
