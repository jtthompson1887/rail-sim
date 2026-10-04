import { GameConfig } from '../config/GameConfig';
import type { WorldData, WorldValidationResult } from '../config/WorldData';
import { validateWorldData } from '../config/WorldData';
import { createImportedWorldId, SaveRepository } from '../persistence/SaveRepository';
import { migrateWorldData } from '../persistence/WorldMigration';
import type { StoragePort } from '../persistence/StoragePort';

let repository: SaveRepository | null = null;
let hydratedWorlds: Record<string, unknown> | null = null;
let lastFailure: string | null = null;
const errorListeners = new Set<(message: string | null) => void>();
function notifyPersistenceListeners(message: string | null): void {
  errorListeners.forEach((listener) => {
    try { listener(message); }
    catch (error) { console.error('Save error listener failed', error); }
  });
}
function reportFailure(error: unknown): void {
  lastFailure = error instanceof Error ? error.message : String(error);
  console.error('SaveService: durable save failed', lastFailure);
  notifyPersistenceListeners(lastFailure);
}
function readLegacyWorlds(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.assign(Object.create(null), parsed) : Object.create(null);
  } catch { return Object.create(null); }
}

function validateStoredWorld(storageId: string, raw: unknown): WorldValidationResult {
  const result = migrateWorldData(raw);
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
  /** Only legacy browser acceptance fixtures may exercise the prototype's synchronous storage path. */
  useLegacyPersistenceForAcceptanceTests(): void {
    if (typeof __RAIL_SIM_TEST_CONTROLS__ === 'undefined' || !__RAIL_SIM_TEST_CONTROLS__) {
      throw new Error('Legacy acceptance persistence is disabled in production.');
    }
    repository = null;
    hydratedWorlds = null;
    lastFailure = null;
  },
  /** Hydrate before opening the world picker. Original prototype storage is retained. */
  async initialize(storage: StoragePort): Promise<void> {
    try {
      const nextRepository = new SaveRepository(storage, reportFailure);
      const durable = await nextRepository.loadAllRaw();
      const legacy = readLegacyWorlds();
      for (const [id, raw] of Object.entries(legacy)) {
        if (Object.prototype.hasOwnProperty.call(durable, id)) continue;
        if (await nextRepository.isDeleted(id)) continue;
        const validation = validateStoredWorld(id, raw);
        if (validation.compatible) {
          if ((raw as any).schemaVersion === 10) {
            await nextRepository.preserveOriginal(id, JSON.stringify(raw), 'schema10');
          }
          await nextRepository.save(validation.world);
          durable[id] = validation.world;
        } else {
          // Incompatible originals remain visible; no attempted repair overwrites them.
          durable[id] = raw;
        }
      }
      repository = nextRepository;
      hydratedWorlds = durable;
      lastFailure = null;
      notifyPersistenceListeners(null);
    } catch (error) { reportFailure(error); throw error; }
  },

  async flush(): Promise<void> {
    if (!repository) {
      if (lastFailure) throw new Error(lastFailure);
      return;
    }
    try {
      await repository.flush();
      lastFailure = null;
      notifyPersistenceListeners(null);
    } catch (error) { reportFailure(error); throw error; }
  },

  getPersistenceError(): string | null { return lastFailure; },
  reportPersistenceFailure(error: unknown): void { reportFailure(error); },
  getStorageKind(): StoragePort['kind'] | 'localStorage' { return repository?.storage.kind ?? 'localStorage'; },
  onPersistenceError(listener: (message: string | null) => void): () => void {
    errorListeners.add(listener);
    return () => errorListeners.delete(listener);
  },

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
    return hydratedWorlds
      ? Object.assign(Object.create(null), JSON.parse(JSON.stringify(hydratedWorlds))) : readLegacyWorlds();
  },

  /** Persist a world (insert or update). */
  saveWorld(world: WorldData, original?: { json: string; label: 'schema10' | 'import' }): boolean {
    // A failed platform bootstrap must never turn a localStorage write into a durable acknowledgement.
    if (!repository && lastFailure) return false;
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
      const prior = all[world.id] as any;
      if (prior?.schemaVersion > 11) return false;
      const savedAt = Date.now();
      const snapshot = JSON.parse(JSON.stringify(world)) as WorldData;
      snapshot.metadata.updatedAt = savedAt;
      if (!validateWorldData(snapshot).compatible) return false;
      all[world.id] = snapshot;
      if (repository) {
        hydratedWorlds = all;
        // true means accepted into the session; flush() is the durable acknowledgement.
        void repository.save(snapshot, original).catch(() => { /* Repository publishes the error. */ });
      } else {
        // Keep the synchronous facade for prototype callers and existing tests.
        if (prior?.schemaVersion === 10) {
          const key = `${GameConfig.WORLD.WORLDS_SAVE_KEY}:original-schema10:${world.id}`;
          if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(prior));
        }
        if (original) {
          const key = `${GameConfig.WORLD.WORLDS_SAVE_KEY}:original-${original.label}:${world.id}`;
          if (!localStorage.getItem(key)) localStorage.setItem(key, original.json);
        }
        localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, JSON.stringify(all));
      }
      world.metadata.updatedAt = savedAt;
      return true;
    } catch {
      console.warn('SaveService: failed to accept world save');
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
      if (repository) {
        hydratedWorlds = all;
        void repository.remove(id).catch(() => { /* Error published by repository. */ });
      } else localStorage.setItem(GameConfig.WORLD.WORLDS_SAVE_KEY, JSON.stringify(all));
    } catch {
      console.warn('SaveService: failed to delete world from localStorage');
    }
  },

  /** Export a world as a JSON string (for file download). */
  exportWorld(world: WorldData): string {
    return JSON.stringify(world, null, 2);
  },

  /** Import a world from JSON, assigning a fresh id when that id already exists. */
  importWorld(json: string): WorldData | null {
    try {
      const result = migrateWorldData(JSON.parse(json));
      if (!result.compatible) return null;
      const existing = this.loadAllWorlds();
      if (existing[result.world.id] !== undefined) {
        const originalWorldId = result.world.id;
        const freshId = createImportedWorldId();
        result.world.id = freshId;
        let suffix = 1;
        while (existing[result.world.id] !== undefined) result.world.id = `${freshId}-${suffix++}`;
        for (const draft of result.world.blueprints ?? []) {
          if (draft.sourceWorldId === originalWorldId) draft.sourceWorldId = result.world.id;
        }
      }
      return this.saveWorld(result.world, { json, label: 'import' }) ? result.world : null;
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
