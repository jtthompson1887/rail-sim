/**
 * @jest-environment jsdom
 */
import { SaveService, SaveData } from '../../src/services/SaveService';
import { GameConfig } from '../../src/config/GameConfig';
import type { WorldData } from '../../src/config/WorldData';

function makeWorld(id: string, name: string, seed: string, timestamp: number): WorldData {
  return {
    schemaVersion: 3,
    id,
    name,
    generationConfig: {
      generationConfigVersion: 1,
      seed,
      biome: 'temperate',
      constructionDifficultyId: 'standard',
    },
    company: { cash: 876_543 },
    tracks: [],
    junctions: [],
    stations: [],
    trains: [],
    scenarios: [],
    scenery: [],
    metadata: { createdAt: timestamp, updatedAt: timestamp },
  };
}

describe('SaveService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves schema-3 company cash and paid track value exactly', () => {
    const world = makeWorld('economy-world', 'Economy', 'cash-seed', 123);
    world.tracks.push({
      geometryVersion: 1,
      uuid: 'paid-track',
      p0: { x: 0, y: 0 },
      p1: { x: 1, y: 0 },
      p2: { x: 2, y: 0 },
      p3: { x: 3, y: 0 },
      verticalProfile: {
        profileVersion: 1,
        knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
      },
      structures: [{
        type: 'surface',
        startT: 0,
        endT: 1,
        startElevation: 0,
        endElevation: 0,
      }],
      paidBuildCost: 12_345,
    });

    expect(SaveService.saveWorld(world)).toBe(true);
    const loaded = SaveService.loadWorld(world.id)!;
    expect(loaded.company.cash).toBe(876_543);
    expect(loaded.tracks[0].paidBuildCost).toBe(12_345);
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

  // ── World persistence ──────────────────────────────────────────────────────

  describe('saveWorld() / loadWorld()', () => {
    it('saves and loads a world by id', () => {
      const world = makeWorld('w1', 'Test', '123', 1000);
      SaveService.saveWorld(world);
      const loaded = SaveService.loadWorld('w1');
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('Test');
    });

    it('returns null for unknown world id', () => {
      expect(SaveService.loadWorld('no-such-world')).toBeNull();
    });

    it('updates updatedAt on save', () => {
      const world = makeWorld('w-ts', 'TS', '0', 1);
      SaveService.saveWorld(world);
      const loaded = SaveService.loadWorld('w-ts')!;
      expect(loaded.metadata.updatedAt).toBeGreaterThanOrEqual(1);
    });
  });

  describe('listWorlds()', () => {
    it('returns empty array when no worlds saved', () => {
      expect(SaveService.listWorlds()).toHaveLength(0);
    });

    it('returns all saved worlds', () => {
      const w1 = makeWorld('wl1', 'A', '1', 1000);
      const w2 = makeWorld('wl2', 'B', '2', 2000);
      SaveService.saveWorld(w1);
      SaveService.saveWorld(w2);
      expect(SaveService.listWorlds()).toHaveLength(2);
    });

    it('sorts worlds newest first (by updatedAt)', () => {
      const older = makeWorld('older-w', 'Old', '0', 100);
      const newer = makeWorld('newer-w', 'New', '0', 999);
      // Manually set updatedAt after saving so the sort ordering is predictable
      SaveService.saveWorld(older);
      const raw1 = JSON.parse(localStorage.getItem('rail-sim-worlds') || '{}');
      raw1['older-w'].metadata.updatedAt = 100;
      localStorage.setItem('rail-sim-worlds', JSON.stringify(raw1));
      SaveService.saveWorld(newer);
      const raw2 = JSON.parse(localStorage.getItem('rail-sim-worlds') || '{}');
      raw2['newer-w'].metadata.updatedAt = 999;
      localStorage.setItem('rail-sim-worlds', JSON.stringify(raw2));
      const list = SaveService.listWorlds();
      expect(list[0].id).toBe('newer-w');
    });
  });

  describe('deleteWorld()', () => {
    it('removes a world by id', () => {
      const w = makeWorld('del-w', 'Del', '0', 1);
      SaveService.saveWorld(w);
      SaveService.deleteWorld('del-w');
      expect(SaveService.loadWorld('del-w')).toBeNull();
    });

    it('does not throw for unknown id', () => {
      expect(() => SaveService.deleteWorld('ghost-id')).not.toThrow();
    });
  });

  describe('exportWorld() / importWorld()', () => {
    it('round-trips a world through JSON', () => {
      const w = makeWorld('exp', 'Export Me', '0', 1);
      const json = SaveService.exportWorld(w);
      const imported = SaveService.importWorld(json);
      expect(imported).not.toBeNull();
      expect(imported!.name).toBe('Export Me');
    });

    it('importWorld returns null for invalid JSON', () => {
      expect(SaveService.importWorld('not-json!')).toBeNull();
    });

    it('importWorld persists the world', () => {
      const w = makeWorld('imp', 'Imported', '1', 1);
      const json = SaveService.exportWorld(w);
      SaveService.importWorld(json);
      expect(SaveService.loadWorld('imp')).not.toBeNull();
    });
  });

  describe('getLastPlayedWorldId() / setLastPlayedWorldId()', () => {
    it('returns null when not set', () => {
      expect(SaveService.getLastPlayedWorldId()).toBeNull();
    });

    it('returns the stored world id', () => {
      SaveService.setLastPlayedWorldId('world-xyz');
      expect(SaveService.getLastPlayedWorldId()).toBe('world-xyz');
    });
  });
});
