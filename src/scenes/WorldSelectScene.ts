import Phaser from 'phaser';
import { SaveService } from '../services/SaveService';
import { WorldManager } from '../managers/WorldManager';
import type { WorldData, BiomeType, IncompatibleWorldResult } from '../config/WorldData';
import { GAME_DIFFICULTIES, LANDSCAPE_PRESETS, type GameDifficulty } from '../region/GamePresets';
import type { LandscapePresetId } from '../config/WorldGeneration';

/** Icon and label shown per biome in the picker. */
const LANDSCAPE_COLOURS = { lowlands: 0x2a5a2a, coastal: 0x245f79, mountains: 0x4a5a7a };

declare global {
  interface Window {
    __railSimCreateLegacyWorld?: (seed: string, biome?: BiomeType) => Promise<string>;
  }
}

/**
 * WorldSelectScene – shows all saved worlds, lets the player create/load/delete.
 * Replaces the old LevelSelectScene.
 */
export default class WorldSelectScene extends Phaser.Scene {
  private pickerObjects: Phaser.GameObjects.GameObject[] = [];
  private pickerName = '';
  private pickerSeed = '';
  private pickerBiome: BiomeType = 'temperate';
  private pickerLandscape: LandscapePresetId = 'lowlands';
  private pickerDifficulty: GameDifficulty = 'standard';
  private pickerError = '';
  private textEditor: HTMLDivElement | null = null;

  constructor() {
    super({ key: 'WorldSelectScene' });
  }

  create(): void {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.closeTextEditor());
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

    if (
      typeof __RAIL_SIM_TEST_CONTROLS__ !== 'undefined'
      && __RAIL_SIM_TEST_CONTROLS__
    ) {
      window.__railSimScene = 'WorldSelectScene';
      window.__railSimCreateLegacyWorld = async (seed, biome = 'temperate') => {
        await SaveService.flush();
        SaveService.useLegacyPersistenceForAcceptanceTests();
        const url = new URL(window.location.href);
        url.searchParams.set('legacyAcceptanceFixture', '1');
        window.history.replaceState(null, '', url);
        const result = WorldManager.tryCreateNew('Legacy acceptance railway', seed, biome);
        if (result.ok === false) throw new Error(`Legacy fixture generation failed: ${result.error.code}`);
        this.clearCreationPicker();
        this.scene.start('WorldScene', { worldId: result.world.id, mode: 'create' });
        return result.world.id;
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { delete window.__railSimCreateLegacyWorld; });
    }
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
    this.pickerLandscape = 'lowlands';
    this.pickerDifficulty = 'standard';
    this.pickerError = '';
    this.renderCreationPicker();
  }

  private trackPickerObject<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.pickerObjects.push(object);
    return object;
  }

  private clearCreationPicker(): void {
    this.closeTextEditor();
    this.pickerObjects.forEach((object) => object.destroy());
    this.pickerObjects = [];
  }

  private closeTextEditor(): void {
    this.textEditor?.remove();
    this.textEditor = null;
  }

  /** HTML inputs work with native mobile keyboards and Electron, where window.prompt is unavailable. */
  private editPickerField(field: 'name' | 'seed'): void {
    this.closeTextEditor();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#000b;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
    const form = document.createElement('form');
    form.style.cssText = 'background:#102b40;color:white;padding:24px;border:1px solid #4ad5ff;border-radius:12px;max-width:440px;width:100%;font:18px system-ui';
    const label = document.createElement('label');
    label.textContent = field === 'name' ? 'Region name' : 'World seed';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = field === 'name' ? 80 : 120;
    input.value = field === 'name' ? this.pickerName : this.pickerSeed;
    input.style.cssText = 'display:block;width:100%;box-sizing:border-box;min-height:48px;margin:16px 0;font:18px system-ui;padding:10px';
    input.setAttribute('aria-label', label.textContent);
    label.appendChild(input);
    form.appendChild(label);
    const apply = document.createElement('button');
    apply.type = 'submit';
    apply.textContent = 'Apply';
    apply.style.cssText = 'min-height:48px;min-width:100px;font:18px system-ui;margin-right:12px';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'min-height:48px;min-width:100px;font:18px system-ui';
    cancel.onclick = () => this.closeTextEditor();
    form.append(apply, cancel);
    form.onsubmit = event => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      if (field === 'name') this.pickerName = value;
      else { this.pickerSeed = value; this.pickerError = ''; }
      this.renderCreationPicker();
    };
    input.onkeydown = event => { if (event.key === 'Escape') this.closeTextEditor(); };
    overlay.appendChild(form);
    document.body.appendChild(overlay);
    this.textEditor = overlay;
    input.focus();
    input.select();
  }

  private renderCreationPicker(): void {
    this.clearCreationPicker();
    const { width, height } = this.scale;
    if (height < 720) { this.renderCompactPicker(); return; }

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
      this.add.text(width / 2, panelY - panelH / 2 + 34, 'Create Your Railway Region', {
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
      this.editPickerField('name');
    });
    const seedField = this.trackPickerObject(
      this.add.text(width / 2, fieldY + 38, `Seed: ${this.pickerSeed}`, {
        fontFamily: 'Verdana', fontSize: '17px', color: '#9fc0ff',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(803),
    );
    seedField.on('pointerdown', () => {
      this.editPickerField('seed');
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
    const difficulty = GAME_DIFFICULTIES.find(d => d.id === this.pickerDifficulty)!;
    const difficultyButton = this.trackPickerObject(
      this.add.text(width / 2, fieldY + 116, `Mode: ${difficulty.name}  ›`, {
        fontFamily: 'Verdana', fontSize: '18px', color: '#ffdc7d',
      }).setOrigin(0.5).setPadding(12).setInteractive({ useHandCursor: true }).setDepth(803),
    );
    difficultyButton.on('pointerdown', () => {
      const index = GAME_DIFFICULTIES.findIndex(d => d.id === this.pickerDifficulty);
      this.pickerDifficulty = GAME_DIFFICULTIES[(index + 1) % GAME_DIFFICULTIES.length].id;
      this.renderCreationPicker();
    });

    const btnH = 48;
    const startY = fieldY + 180;

    const biomeButtons: Phaser.GameObjects.Rectangle[] = [];

    LANDSCAPE_PRESETS.forEach(({ id, biome, name }, i) => {
      const by = startY + i * (btnH + 10);
      const selected = this.pickerLandscape === id;
      const btn = this.trackPickerObject(
        this.add.rectangle(width / 2, by, btnW, btnH, LANDSCAPE_COLOURS[id], 0.7)
          .setStrokeStyle(
            2,
            selected ? 0x4ad5ff : 0xffffff,
            selected ? 1 : 0.3,
          )
          .setInteractive({ useHandCursor: true })
          .setDepth(803),
      );

      this.trackPickerObject(
        this.add.text(width / 2, by, name, {
          fontFamily: 'Verdana', fontSize: '22px', color: '#ffffff',
        }).setOrigin(0.5).setDepth(804),
      );

      btn.on('pointerdown', () => {
        this.pickerBiome = biome;
        this.pickerLandscape = id;
        biomeButtons.forEach((button, index) => button.setStrokeStyle(
          2,
          index === i ? 0x4ad5ff : 0xffffff,
          index === i ? 1 : 0.3,
        ));
      });

      biomeButtons.push(btn);
    });
    this.trackPickerObject(this.add.text(width / 2, startY + 3 * (btnH + 10) + 8, difficulty.description, {
      fontFamily: 'Verdana', fontSize: '16px', color: '#9fc0ff', align: 'center', wordWrap: { width: btnW },
    }).setOrigin(0.5).setDepth(804));

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

  /** A scrollable sheet keeps all creation choices reachable on a landscape phone. */
  private renderCompactPicker(): void {
    const overlay=document.createElement('div');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Create railway region');
    overlay.style.cssText='position:fixed;inset:0;z-index:90;background:#081b15e8;display:flex;align-items:center;justify-content:center;padding:10px';
    const form=document.createElement('form');form.style.cssText='color:#e7ede2;background:#173b31;border:1px solid #7a9b84;border-radius:14px;padding:18px;width:560px;max-width:100%;max-height:100%;overflow:auto;font:15px system-ui;box-sizing:border-box';
    const title=document.createElement('h2');title.textContent='Create your railway region';title.style.margin='0 0 12px';form.append(title);
    const field=(text:string,input:HTMLElement)=>{const label=document.createElement('label');label.textContent=text;label.style.cssText='display:block;margin:10px 0';input.style.cssText='display:block;width:100%;min-height:44px;margin-top:4px;padding:8px;font:inherit;box-sizing:border-box;border-radius:6px';input.setAttribute('aria-label',text);label.append(input);form.append(label);};
    const name=document.createElement('input');name.value=this.pickerName;name.maxLength=80;field('Region name',name);
    const seed=document.createElement('input');seed.value=this.pickerSeed;seed.maxLength=120;field('World seed',seed);
    const landscapes=document.createElement('select');for(const p of LANDSCAPE_PRESETS){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;landscapes.append(o);}landscapes.value=this.pickerLandscape;field('Landscape',landscapes);
    const modes=document.createElement('select');for(const d of GAME_DIFFICULTIES){const o=document.createElement('option');o.value=d.id;o.textContent=d.name; modes.append(o);}modes.value=this.pickerDifficulty;field('Game mode',modes);
    const description=document.createElement('p');description.textContent=GAME_DIFFICULTIES.find(d=>d.id===this.pickerDifficulty)!.description;form.append(description);
    modes.onchange=()=>{description.textContent=GAME_DIFFICULTIES.find(d=>d.id===modes.value)!.description;};
    if(this.pickerError){const error=document.createElement('p');error.textContent=this.pickerError;error.style.color='#ffcd99';error.setAttribute('role','alert');form.append(error);}
    const buttons=document.createElement('div');buttons.style.cssText='display:flex;gap:10px';
    const create=document.createElement('button');create.type='submit';create.textContent=this.pickerError?'Retry same seed':'Create region';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>this.clearCreationPicker();
    for(const b of [create,cancel]){b.style.cssText='min-height:44px;flex:1;font:inherit;padding:8px;border-radius:6px;background:#e2c47b;color:#173126;border:0';buttons.append(b);}form.append(buttons);
    form.onsubmit=event=>{event.preventDefault();if(!name.value.trim()||!seed.value.trim())return;this.pickerName=name.value.trim();this.pickerSeed=seed.value.trim();this.pickerLandscape=landscapes.value as LandscapePresetId;this.pickerBiome=LANDSCAPE_PRESETS.find(p=>p.id===this.pickerLandscape)!.biome;this.pickerDifficulty=modes.value as GameDifficulty;this.createWorld();};
    for(const event of ['pointerdown','pointerup','keydown','keyup','wheel'])overlay.addEventListener(event,e=>e.stopPropagation());
    overlay.append(form);document.body.append(overlay);this.textEditor=overlay;
  }

  private createWorld(): void {
    const result = WorldManager.tryCreateNew(
      this.pickerName,
      this.pickerSeed,
      this.pickerBiome,
      undefined,
      undefined,
      { landscapePreset: this.pickerLandscape, gameDifficulty: this.pickerDifficulty, regional: true },
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
