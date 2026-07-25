import Phaser from 'phaser';
import { SaveService } from '../services/SaveService';
import { WorldManager } from '../managers/WorldManager';
import type { WorldData, BiomeType, IncompatibleWorldResult } from '../config/WorldData';

/** Icon and label shown per biome in the picker. */
const BIOME_OPTIONS: Array<{ biome: BiomeType; label: string; color: number }> = [
  { biome: 'temperate', label: '🌿 Temperate', color: 0x2a5a2a },
  { biome: 'alpine',    label: '❄️  Alpine',    color: 0x4a5a7a },
  { biome: 'arid',      label: '🏜️  Arid',      color: 0x9a7a3a },
  { biome: 'tropical',  label: '🌴 Tropical',  color: 0x2a7a3a },
];

/**
 * WorldSelectScene – shows all saved worlds, lets the player create/load/delete.
 * Replaces the old LevelSelectScene.
 */
export default class WorldSelectScene extends Phaser.Scene {
  private pickerObjects: Phaser.GameObjects.GameObject[] = [];
  private pickerName = '';
  private pickerSeed = '';
  private pickerBiome: BiomeType = 'temperate';
  private pickerError = '';

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
    newWorldBtn.on('pointerdown', () => this.showBiomePicker());

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
    const worlds = SaveService.listWorldResults();

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

    for (const result of worlds) {
      if ('world' in result) {
        this.renderWorldRow(result.world, width / 2, y, btnW, rowH);
      } else {
        this.renderIncompatibleWorldRow(result, width / 2, y, btnW, rowH);
      }
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
    const biomeLabel = `[${world.generationConfig.biome}]`;
    this.add.text(cx - w / 2 + 24, cy - 28, `${world.name} ${biomeLabel}`, {
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
    if (WorldManager.load(world.id)) {
      this.scene.start('WorldScene', { worldId: world.id, mode: 'create' });
    }
  }

  private renderIncompatibleWorldRow(
    result: IncompatibleWorldResult,
    cx: number,
    cy: number,
    w: number,
    h: number,
  ): void {
    this.add.rectangle(cx, cy, w, h, 0x402020, 0.95)
      .setStrokeStyle(2, 0xff7777, 0.7);
    this.add.text(cx - w / 2 + 24, cy - 28, result.name, {
      fontFamily: 'Verdana',
      fontSize: '30px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0, 0.5);
    this.add.text(cx - w / 2 + 24, cy + 16, `${result.message} ${result.action}`, {
      fontFamily: 'Verdana',
      fontSize: '18px',
      color: '#ffb0b0',
    }).setOrigin(0, 0.5);

    if (result.storageId !== null) {
      const del = this.add.text(cx + w / 2 - 24, cy, 'ðŸ—‘', {
        fontFamily: 'Verdana',
        fontSize: '32px',
      }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.deleteWorld(result.storageId!));
      del.setPadding(8);
    }
  }

  private deleteWorld(worldId: string): void {
    SaveService.deleteWorld(worldId);
    this.scene.restart();
  }

  // ── Biome picker overlay ──────────────────────────────────────────────────

  private showBiomePicker(): void {
    this.pickerName = `World ${SaveService.listWorlds().length + 1}`;
    this.pickerSeed = crypto.randomUUID();
    this.pickerBiome = 'temperate';
    this.pickerError = '';
    this.renderCreationPicker();
  }

  private trackPickerObject<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.pickerObjects.push(object);
    return object;
  }

  private clearCreationPicker(): void {
    this.pickerObjects.forEach((object) => object.destroy());
    this.pickerObjects = [];
  }

  private renderCreationPicker(): void {
    this.clearCreationPicker();
    const { width, height } = this.scale;

    // Dim overlay
    this.trackPickerObject(
      this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7)
        .setDepth(800)
        .setInteractive(),
    );

    const panelW = Math.min(640, width - 40);
    const panelH = Math.min(690, height - 40);
    const panelY = height / 2;

    this.trackPickerObject(
      this.add.rectangle(width / 2, panelY, panelW, panelH, 0x0d2840, 1)
        .setStrokeStyle(2, 0x4ad5ff, 0.8)
        .setDepth(801),
    );

    this.trackPickerObject(
      this.add.text(width / 2, panelY - panelH / 2 + 34, 'Create a Blank World', {
        fontFamily: 'Verdana', fontSize: '28px', fontStyle: 'bold', color: '#4ad5ff',
      }).setOrigin(0.5).setDepth(802),
    );

    const btnW = panelW - 48;
    const fieldY = panelY - panelH / 2 + 88;
    const nameField = this.trackPickerObject(
      this.add.text(width / 2, fieldY, `Name: ${this.pickerName}`, {
        fontFamily: 'Verdana', fontSize: '19px', color: '#ffffff',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(803),
    );
    nameField.on('pointerdown', () => {
      const value = window.prompt('World name', this.pickerName)?.trim();
      if (value) {
        this.pickerName = value;
        this.renderCreationPicker();
      }
    });
    const seedField = this.trackPickerObject(
      this.add.text(width / 2, fieldY + 38, `Seed: ${this.pickerSeed}`, {
        fontFamily: 'Verdana', fontSize: '17px', color: '#9fc0ff',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(803),
    );
    seedField.on('pointerdown', () => {
      const value = window.prompt('World seed', this.pickerSeed)?.trim();
      if (value) {
        this.pickerSeed = value;
        this.pickerError = '';
        this.renderCreationPicker();
      }
    });
    const randomise = this.trackPickerObject(
      this.add.text(width / 2, fieldY + 72, 'Randomise Seed', {
        fontFamily: 'Verdana', fontSize: '17px', color: '#7dff9b',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(803),
    );
    randomise.on('pointerdown', () => {
      this.pickerSeed = crypto.randomUUID();
      this.pickerError = '';
      this.renderCreationPicker();
    });
    this.trackPickerObject(
      this.add.text(width / 2, fieldY + 106, 'Difficulty: Standard', {
        fontFamily: 'Verdana', fontSize: '18px', color: '#ffdc7d',
      }).setOrigin(0.5).setDepth(803),
    );

    const btnH = 48;
    const startY = fieldY + 160;

    const biomeButtons: Phaser.GameObjects.Rectangle[] = [];

    BIOME_OPTIONS.forEach(({ biome, label, color }, i) => {
      const by = startY + i * (btnH + 10);
      const selected = this.pickerBiome === biome;
      const btn = this.trackPickerObject(
        this.add.rectangle(width / 2, by, btnW, btnH, color, 0.7)
          .setStrokeStyle(
            2,
            selected ? 0x4ad5ff : 0xffffff,
            selected ? 1 : 0.3,
          )
          .setInteractive({ useHandCursor: true })
          .setDepth(803),
      );

      this.trackPickerObject(
        this.add.text(width / 2, by, label, {
          fontFamily: 'Verdana', fontSize: '22px', color: '#ffffff',
        }).setOrigin(0.5).setDepth(804),
      );

      btn.on('pointerdown', () => {
        this.pickerBiome = biome;
        biomeButtons.forEach((button, index) => button.setStrokeStyle(
          2,
          index === i ? 0x4ad5ff : 0xffffff,
          index === i ? 1 : 0.3,
        ));
      });

      biomeButtons.push(btn);
    });

    if (this.pickerError) {
      this.trackPickerObject(
        this.add.text(width / 2, panelY + panelH / 2 - 102, this.pickerError, {
          fontFamily: 'Verdana',
          fontSize: '16px',
          color: '#ffb0b0',
          align: 'center',
          wordWrap: { width: btnW },
        }).setOrigin(0.5).setDepth(804),
      );
    }

    const confirmBtn = this.trackPickerObject(
      this.add.rectangle(
        width / 2,
        panelY + panelH / 2 - 44,
        btnW,
        50,
        0x1a7a3a,
        1,
      )
        .setStrokeStyle(2, 0x7dff9b, 0.8)
        .setInteractive({ useHandCursor: true })
        .setDepth(803),
    );
    this.trackPickerObject(
      this.add.text(
        width / 2,
        panelY + panelH / 2 - 44,
        this.pickerError ? 'Retry Same Seed' : 'Create World',
        {
          fontFamily: 'Verdana', fontSize: '22px', color: '#7dff9b',
        },
      ).setOrigin(0.5).setDepth(804),
    );
    confirmBtn.on('pointerdown', () => this.createWorld());
  }

  private createWorld(): void {
    const result = WorldManager.tryCreateNew(
      this.pickerName,
      this.pickerSeed,
      this.pickerBiome,
    );
    if (result.ok === false) {
      this.pickerError = result.error.code === 'opportunity-exhausted'
        ? `Generation failed for seed: ${this.pickerSeed}`
        : `Could not save world for seed: ${this.pickerSeed}`;
      this.renderCreationPicker();
      return;
    }
    this.clearCreationPicker();
    this.scene.start('WorldScene', {
      worldId: result.world.id,
      mode: 'create',
    });
  }
}
