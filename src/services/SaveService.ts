import { GameConfig } from '../config/GameConfig';

export interface SaveData {
  unlockedLevels: string[];
  highScores: Record<string, number>;
  lastPlayedLevelId?: string;
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

  getSettings(): SaveData['settings'] {
    return this.load().settings;
  },

  updateSettings(settings: Partial<SaveData['settings']>): void {
    const data = this.load();
    data.settings = { ...data.settings, ...settings };
    this.save(data);
  },
};
