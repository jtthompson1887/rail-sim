/**
 * @jest-environment jsdom
 */
import { SaveService, SaveData } from '../../src/services/SaveService';
import { GameConfig } from '../../src/config/GameConfig';

describe('SaveService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('load()', () => {
    it('returns default save data when localStorage is empty', () => {
      const data = SaveService.load();
      expect(data.unlockedLevels).toEqual(['level_01']);
      expect(data.highScores).toEqual({});
      expect(data.settings.bgmVolume).toBe(GameConfig.AUDIO.BGM_VOLUME);
      expect(data.settings.sfxVolume).toBe(GameConfig.AUDIO.SFX_VOLUME);
    });

    it('parses saved JSON from localStorage', () => {
      const saved: SaveData = {
        unlockedLevels: ['level_01', 'level_02'],
        highScores: { level_01: 250 },
        settings: { bgmVolume: 0.3, sfxVolume: 0.6 },
      };
      localStorage.setItem(GameConfig.SAVE_KEY, JSON.stringify(saved));
      const data = SaveService.load();
      expect(data.unlockedLevels).toEqual(['level_01', 'level_02']);
      expect(data.highScores).toEqual({ level_01: 250 });
      expect(data.settings.bgmVolume).toBe(0.3);
    });

    it('returns default data when localStorage contains invalid JSON', () => {
      localStorage.setItem(GameConfig.SAVE_KEY, 'not-json');
      const data = SaveService.load();
      expect(data.unlockedLevels).toEqual(['level_01']);
    });
  });

  describe('save()', () => {
    it('writes data to localStorage', () => {
      const data: SaveData = {
        unlockedLevels: ['level_01'],
        highScores: {},
        settings: { bgmVolume: 0.5, sfxVolume: 0.8 },
      };
      SaveService.save(data);
      const raw = localStorage.getItem(GameConfig.SAVE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual(data);
    });
  });

  describe('unlockLevel()', () => {
    it('adds a new level to unlockedLevels', () => {
      SaveService.unlockLevel('level_02');
      const data = SaveService.load();
      expect(data.unlockedLevels).toContain('level_02');
    });

    it('does not duplicate an already unlocked level', () => {
      SaveService.unlockLevel('level_01');
      SaveService.unlockLevel('level_01');
      const data = SaveService.load();
      const count = data.unlockedLevels.filter((l) => l === 'level_01').length;
      expect(count).toBe(1);
    });
  });

  describe('isLevelUnlocked()', () => {
    it('returns true for the default unlocked level', () => {
      expect(SaveService.isLevelUnlocked('level_01')).toBe(true);
    });

    it('returns false for a locked level', () => {
      expect(SaveService.isLevelUnlocked('level_99')).toBe(false);
    });

    it('returns true after unlocking', () => {
      SaveService.unlockLevel('level_02');
      expect(SaveService.isLevelUnlocked('level_02')).toBe(true);
    });
  });

  describe('getHighScore()', () => {
    it('returns 0 when no score exists', () => {
      expect(SaveService.getHighScore('level_01')).toBe(0);
    });

    it('returns stored high score', () => {
      const data = SaveService.load();
      data.highScores['level_01'] = 750;
      SaveService.save(data);
      expect(SaveService.getHighScore('level_01')).toBe(750);
    });
  });

  describe('setHighScore()', () => {
    it('sets a high score when higher than existing', () => {
      SaveService.setHighScore('level_01', 500);
      expect(SaveService.getHighScore('level_01')).toBe(500);
    });

    it('does not overwrite with a lower score', () => {
      SaveService.setHighScore('level_01', 500);
      SaveService.setHighScore('level_01', 200);
      expect(SaveService.getHighScore('level_01')).toBe(500);
    });

    it('updates when a higher score is achieved', () => {
      SaveService.setHighScore('level_01', 500);
      SaveService.setHighScore('level_01', 800);
      expect(SaveService.getHighScore('level_01')).toBe(800);
    });
  });

  describe('getSettings()', () => {
    it('returns default settings', () => {
      const settings = SaveService.getSettings();
      expect(settings.bgmVolume).toBe(GameConfig.AUDIO.BGM_VOLUME);
      expect(settings.sfxVolume).toBe(GameConfig.AUDIO.SFX_VOLUME);
    });
  });

  describe('updateSettings()', () => {
    it('updates bgmVolume', () => {
      SaveService.updateSettings({ bgmVolume: 0.2 });
      expect(SaveService.getSettings().bgmVolume).toBe(0.2);
    });

    it('partially updates settings, preserving other fields', () => {
      SaveService.updateSettings({ bgmVolume: 0.1 });
      expect(SaveService.getSettings().sfxVolume).toBe(GameConfig.AUDIO.SFX_VOLUME);
    });

    it('updates sfxVolume independently', () => {
      SaveService.updateSettings({ sfxVolume: 0.4 });
      expect(SaveService.getSettings().sfxVolume).toBe(0.4);
      expect(SaveService.getSettings().bgmVolume).toBe(GameConfig.AUDIO.BGM_VOLUME);
    });
  });
});
