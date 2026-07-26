import { GameConfig } from '../config/GameConfig';
import type { WorldData, WorldValidationResult } from '../config/WorldData';
import { validateWorldData } from '../config/WorldData';

function validateStoredWorld(storageId: string, raw: unknown): WorldValidationResult {
  const result = validateWorldData(raw);
  if (!('world' in result)) {
    return { ...result, storageId };
  }
  if (result.world.id !== storageId) {
    return {
      compatible: false,
      id: result.world.id,
      storageId,
      name: result.world.name,
      updatedAt: result.world.metadata.updatedAt,
      message: 'This save is incompatible: storage key does not match embedded world id.',
      action: 'Start a new world.',
    };
  }
  return result;
}

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
  loadAllWorlds(): Record<string, unknown> {
    try {
      const raw = localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  },

  /** Persist a world (insert or update). */
  saveWorld(world: WorldData): boolean {
    try {
      if (!validateWorldData(world).compatible) return false;
      const updatedAtDescriptor = Object.getOwnPropertyDescriptor(
        world.metadata,
        'updatedAt',
      );
      if (!updatedAtDescriptor
        || !('value' in updatedAtDescriptor)
        || !updatedAtDescriptor.writable) return false;
      const all = this.loadAllWorlds();
      const savedAt = Date.now();
      const snapshot = JSON.parse(JSON.stringify(world)) as WorldData;
      snapshot.metadata.updatedAt = savedAt;
      if (!validateWorldData(snapshot).compatible) return false;
      all[world.id] = snapshot;
      localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, JSON.stringify(all));
      world.metadata.updatedAt = savedAt;
      return true;
    } catch {
      console.warn('SaveService: failed to save world to localStorage');
      return false;
    }
  },

  /** Validate a single saved world, preserving incompatibility details for UI. */
  loadWorldResult(id: string): WorldValidationResult | null {
    const raw = this.loadAllWorlds()[id];
    return raw === undefined ? null : validateStoredWorld(id, raw);
  },

  /** Retrieve a single world by id, or null if not found. */
  loadWorld(id: string): WorldData | null {
    const result = this.loadWorldResult(id);
    return result?.compatible ? result.world : null;
  },

  /** List all worlds, sorted newest first. */
  listWorlds(): WorldData[] {
    return this.listWorldResults()
      .filter((result): result is Extract<WorldValidationResult, { compatible: true }> => result.compatible)
      .map((result) => result.world);
  },

  /** List compatible and incompatible saves for the world picker. */
  listWorldResults(): WorldValidationResult[] {
    const all = this.loadAllWorlds();
    const results = Object.keys(all).map((key) => validateStoredWorld(key, all[key]));
    return results.sort(
      (a, b) => {
        const aUpdated = 'world' in a ? a.world.metadata.updatedAt : a.updatedAt;
        const bUpdated = 'world' in b ? b.world.metadata.updatedAt : b.updatedAt;
        return bUpdated - aUpdated;
      },
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
      const result = validateWorldData(JSON.parse(json));
      if (!result.compatible) return null;
      return this.saveWorld(result.world) ? result.world : null;
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
