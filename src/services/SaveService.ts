import { GameConfig } from '../config/GameConfig';
import type { WorldData } from '../config/WorldData';
import { migrateWorld } from '../config/WorldData';

export interface SaveData {
  unlockedLevels: string[];
  highScores: Record<string, number>;
  lastPlayedLevelId?: string;
  lastPlayedWorldId?: string;
  settings: {
    bgmVolume: number;
    sfxVolume: number;
  };
}

const DEFAULT_SAVE: SaveData = {
  unlockedLevels: ['level_01'],
  highScores: {},
  settings: {
    bgmVolume: GameConfig.AUDIO.BGM_VOLUME,
    sfxVolume: GameConfig.AUDIO.SFX_VOLUME,
  },
};

export const SaveService = {
  load(): SaveData {
    try {
      const raw = localStorage.getItem(GameConfig.SAVE_KEY);
      if (!raw) return { ...DEFAULT_SAVE, highScores: { ...DEFAULT_SAVE.highScores }, settings: { ...DEFAULT_SAVE.settings }, unlockedLevels: [...DEFAULT_SAVE.unlockedLevels] };
      return JSON.parse(raw) as SaveData;
    } catch {
      return { ...DEFAULT_SAVE, highScores: { ...DEFAULT_SAVE.highScores }, settings: { ...DEFAULT_SAVE.settings }, unlockedLevels: [...DEFAULT_SAVE.unlockedLevels] };
    }
  },

  save(data: SaveData): void {
    try {
      localStorage.setItem(GameConfig.SAVE_KEY, JSON.stringify(data));
    } catch {
      console.warn('SaveService: failed to write to localStorage');
    }
  },

  unlockLevel(levelId: string): void {
    const data = this.load();
    if (!data.unlockedLevels.includes(levelId)) {
      data.unlockedLevels.push(levelId);
      this.save(data);
    }
  },

  isLevelUnlocked(levelId: string): boolean {
    return this.load().unlockedLevels.includes(levelId);
  },

  getHighScore(levelId: string): number {
    return this.load().highScores[levelId] ?? 0;
  },

  setHighScore(levelId: string, score: number): void {
    const data = this.load();
    if (score > (data.highScores[levelId] ?? 0)) {
      data.highScores[levelId] = score;
      this.save(data);
    }
  },

  hasSave(): boolean {
    return !!this.load().lastPlayedLevelId;
  },

  getLastPlayedLevelId(): string | null {
    return this.load().lastPlayedLevelId ?? null;
  },

  setLastPlayedLevelId(levelId: string): void {
    const data = this.load();
    data.lastPlayedLevelId = levelId;
    this.save(data);
  },

  getLastPlayedWorldId(): string | null {
    return this.load().lastPlayedWorldId ?? null;
  },

  setLastPlayedWorldId(worldId: string): void {
    const data = this.load();
    data.lastPlayedWorldId = worldId;
    this.save(data);
  },

  // ── World persistence ──────────────────────────────────────────────────────

  /** Load all worlds as an id→WorldData map. */
  loadAllWorlds(): Record<string, WorldData> {
    try {
      const raw = localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, WorldData>;
    } catch {
      return {};
    }
  },

  /** Persist a world (insert or update). */
  saveWorld(world: WorldData): void {
    try {
      const all = this.loadAllWorlds();
      world.metadata.updatedAt = Date.now();
      all[world.id] = world;
      localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, JSON.stringify(all));
    } catch {
      console.warn('SaveService: failed to save world to localStorage');
    }
  },

  /** Retrieve a single world by id, or null if not found. */
  loadWorld(id: string): WorldData | null {
    const raw = this.loadAllWorlds()[id];
    if (!raw) return null;
    return migrateWorld(raw as Partial<WorldData>);
  },

  /** List all worlds, sorted newest first. */
  listWorlds(): WorldData[] {
    const all = this.loadAllWorlds();
    const worlds = Object.keys(all).map((k) => migrateWorld(all[k] as Partial<WorldData>));
    return worlds.sort(
      (a, b) => b.metadata.updatedAt - a.metadata.updatedAt,
    );
  },

  /** Remove a world by id. */
  deleteWorld(id: string): void {
    try {
      const all = this.loadAllWorlds();
      delete all[id];
      localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, JSON.stringify(all));
    } catch {
      console.warn('SaveService: failed to delete world from localStorage');
    }
  },

  /** Export a world as a JSON string (for file download). */
  exportWorld(world: WorldData): string {
    return JSON.stringify(world, null, 2);
  },

  /** Import a world from a JSON string (from file upload). Overwrites if id matches. */
  importWorld(json: string): WorldData | null {
    try {
      const world = JSON.parse(json) as WorldData;
      if (!world.id || !world.name) return null;
      this.saveWorld(world);
      return world;
    } catch {
      return null;
    }
  },

  getSettings(): SaveData['settings'] {
    return this.load().settings;
  },

  updateSettings(settings: Partial<SaveData['settings']>): void {
    const data = this.load();
    data.settings = { ...data.settings, ...settings };
    this.save(data);
  },
};
