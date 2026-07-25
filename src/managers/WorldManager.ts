import { SaveService } from '../services/SaveService';
import { EventBus } from '../services/EventBus';
import { createEmptyWorld } from '../config/WorldData';
import type {
  WorldData,
  TrackDef,
  JunctionDef,
  WorldStationDef,
  TrainDef,
  SceneryObjectDef,
  BiomeType,
  WorldGenerationConfigDef,
} from '../config/WorldData';
import { GameConfig } from '../config/GameConfig';
import { TerrainGenerator } from '../systems/TerrainGenerator';
import {
  WorldOpportunityGenerator,
  type OpportunityGenerationResult,
} from '../systems/WorldOpportunityGenerator';

export interface OpportunityGeneratorPort {
  generate(config: WorldGenerationConfigDef): OpportunityGenerationResult;
}

export type GeneratedWorldCreationResult =
  | { ok: true; world: WorldData }
  | {
    ok: false;
    error: Extract<OpportunityGenerationResult, { ok: false }>['error']
      | { code: 'world-save-failed'; seed: string };
  };

/**
 * WorldManager – singleton that holds the live in-memory world state and
 * synchronises it with persistent storage via SaveService.
 *
 * Initial world generation is persisted atomically before installation.
 * Later create-mode edits are recorded here first and written when `save()`
 * is explicitly called (or by the WorldScene auto-save timer).
 */
class WorldManagerClass {
  private _world: WorldData | null = null;

  // ── Accessors ──────────────────────────────────────────────────────────────

  get world(): WorldData | null {
    return this._world;
  }

  get currentWorldId(): string | null {
    return this._world?.id ?? null;
  }

  /** Whether a world is currently loaded. */
  get loaded(): boolean {
    return this._world !== null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Generate and persist a brand-new blank world before installing it as the
   * active world. A failed generation or write leaves no half-created world.
   */
  tryCreateNew(
    name: string,
    seed: string = crypto.randomUUID(),
    biome: BiomeType = 'temperate',
    opportunityGenerator?: OpportunityGeneratorPort,
  ): GeneratedWorldCreationResult {
    this._world = null;
    const generationConfig: WorldGenerationConfigDef = {
      generationConfigVersion: 1,
      seed,
      biome,
      constructionDifficultyId: 'standard',
    };
    const generator = opportunityGenerator
      ?? new WorldOpportunityGenerator(new TerrainGenerator(seed));
    const generated = generator.generate(generationConfig);
    if (generated.ok === false) {
      return { ok: false, error: generated.error };
    }

    const detachedWorld = createEmptyWorld(
      name,
      seed,
      biome,
      generated.opportunity,
    );
    if (!SaveService.saveWorld(detachedWorld)) {
      return {
        ok: false,
        error: { code: 'world-save-failed', seed },
      };
    }
    this._world = detachedWorld;
    return { ok: true, world: detachedWorld };
  }

  /** Create a brand-new empty world and set it as the active world. */
  createNew(name: string, seed?: string, biome: BiomeType = 'temperate'): WorldData {
    const result = this.tryCreateNew(name, seed, biome);
    if (result.ok === false) {
      throw new Error(`World creation failed: ${result.error.code}`);
    }
    return result.world;
  }

  /** Load an existing world from storage by id. Returns null if not found. */
  load(id: string): WorldData | null {
    const world = SaveService.loadWorld(id);
    if (world) {
      this._world = world;
      SaveService.setLastPlayedWorldId(id);
    } else {
      this._world = null;
    }
    return world;
  }

  /** Persist the current in-memory world to localStorage. */
  save(): boolean {
    if (!this._world) return false;
    const saved = SaveService.saveWorld(this._world);
    if (!saved) return false;
    EventBus.emit('world:saved', { worldId: this._world.id });
    return true;
  }

  /** Reset – unload the current world without saving. */
  reset(): void {
    this._world = null;
  }

  // ── Track mutations ────────────────────────────────────────────────────────

  addTrackDef(def: TrackDef): void {
    if (!this._world) return;
    this._world.tracks.push(def);
  }

  removeTrackDef(uuid: string): void {
    if (!this._world) return;
    this._world.tracks = this._world.tracks.filter((t) => t.uuid !== uuid);
  }

  updateTrackDef(updated: TrackDef): void {
    if (!this._world) return;
    const idx = this._world.tracks.findIndex((t) => t.uuid === updated.uuid);
    if (idx !== -1) this._world.tracks[idx] = updated;
  }

  // ── Junction mutations ─────────────────────────────────────────────────────

  addJunctionDef(def: JunctionDef): void {
    if (!this._world) return;
    this._world.junctions.push(def);
  }

  removeJunctionDef(uuid: string): void {
    if (!this._world) return;
    this._world.junctions = this._world.junctions.filter((j) => j.uuid !== uuid);
  }

  // ── Station mutations ──────────────────────────────────────────────────────

  addStationDef(def: WorldStationDef): void {
    if (!this._world) return;
    this._world.stations.push(def);
  }

  removeStationDef(id: string): void {
    if (!this._world) return;
    this._world.stations = this._world.stations.filter((s) => s.id !== id);
  }

  // ── Train mutations ────────────────────────────────────────────────────────

  addTrainDef(def: TrainDef): void {
    if (!this._world) return;
    this._world.trains.push(def);
  }

  removeTrainDef(id: string): void {
    if (!this._world) return;
    this._world.trains = this._world.trains.filter((t) => t.id !== id);
  }

  updateTrainDef(updated: Partial<TrainDef> & { id: string }): void {
    if (!this._world) return;
    const idx = this._world.trains.findIndex((t) => t.id === updated.id);
    if (idx !== -1) this._world.trains[idx] = { ...this._world.trains[idx], ...updated };
  }

  /** Replace the entire trains array (used to sync live train state before saving). */
  setTrainDefs(defs: TrainDef[]): void {
    if (!this._world) return;
    this._world.trains = defs;
  }

  // ── Scenery mutations ──────────────────────────────────────────────────────

  addSceneryDef(def: SceneryObjectDef): void {
    if (!this._world) return;
    this._world.scenery.push(def);
  }

  removeSceneryDef(id: string): void {
    if (!this._world) return;
    this._world.scenery = this._world.scenery.filter((s) => s.id !== id);
  }

  /** Return all scenery objects whose position falls within the given chunk. */
  getSceneryForChunk(chunkX: number, chunkY: number): SceneryObjectDef[] {
    if (!this._world) return [];
    const size = GameConfig.WORLD.CHUNK_SIZE;
    return this._world.scenery.filter(
      (s) => s.x >= chunkX && s.x < chunkX + size &&
              s.y >= chunkY && s.y < chunkY + size,
    );
  }

  // ── Serialisation helpers ──────────────────────────────────────────────────

  /** Snapshot current world state (e.g. before applying an undo-able operation). */
  snapshot(): WorldData | null {
    return this._world ? JSON.parse(JSON.stringify(this._world)) as WorldData : null;
  }

  /** Restore from a previously taken snapshot. */
  restore(snapshot: WorldData): void {
    this._world = snapshot;
  }
}

export const WorldManager = new WorldManagerClass();
