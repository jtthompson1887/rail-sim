import { SaveService } from '../services/SaveService';
import { EventBus } from '../services/EventBus';
import {
  createEmptyWorld,
  validateWorldData,
} from '../config/WorldData';
import type {
  EconomyStateDef,
  WorldData,
  TrackDef,
  JunctionDef,
  WorldStationDef,
  TrainDef,
  SceneryObjectDef,
  BiomeType,
  WorldGenerationConfigDef,
} from '../config/WorldData';
import type { CompanyStateDef } from '../economy/EconomyData';
import { GameConfig } from '../config/GameConfig';
import { TerrainGenerator } from '../systems/TerrainGenerator';
import {
  WorldOpportunityGenerator,
  type OpportunityGenerationResult,
} from '../systems/WorldOpportunityGenerator';
import { clonePlainData, equalPlainData } from '../utils/PlainData';

export interface WorldConstructionDraft {
  company: CompanyStateDef;
  readonly economyTick: number;
  getTrack(uuid: string): TrackDef | undefined;
  getJunction(uuid: string): JunctionDef | undefined;
  addTrack(def: TrackDef, index?: number): boolean;
  removeTrack(uuid: string): boolean;
  updateTrack(def: TrackDef): boolean;
  addJunction(def: JunctionDef, index?: number): boolean;
  removeJunction(uuid: string): boolean;
}

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
  private batchInProgress = false;

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

  canAdvanceRevision(): boolean {
    return !this.batchInProgress
      && this._world !== null
      && Number.isSafeInteger(this._world.revision)
      && this._world.revision >= 0
      && this._world.revision < Number.MAX_SAFE_INTEGER;
  }

  private restoreBatchSnapshot(
    world: WorldData,
    snapshot: WorldData,
  ): false {
    if (this._world === world && equalPlainData(world, snapshot)) {
      return false;
    }
    const target = world as unknown as Record<string, unknown>;
    const source = snapshot as unknown as Record<string, unknown>;
    try {
      Object.keys(target).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
          delete target[key];
        }
      });
      Object.keys(source).forEach((key) => {
        target[key] = clonePlainData(source[key]);
      });
      this._world = world;
    } catch {
      this._world = clonePlainData(snapshot);
    }
    return false;
  }

  private incrementRevision(): boolean {
    if (!this.canAdvanceRevision()) return false;
    this._world!.revision += 1;
    return true;
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
    if (this.batchInProgress) {
      return {
        ok: false,
        error: { code: 'world-save-failed', seed },
      };
    }
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
    if (this.batchInProgress) return null;
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
    if (this.batchInProgress || !this._world) return false;
    const saved = SaveService.saveWorld(this._world);
    if (!saved) return false;
    EventBus.emit('world:saved', { worldId: this._world.id });
    return true;
  }

  /** Reset – unload the current world without saving. */
  reset(): void {
    if (this.batchInProgress) return;
    this._world = null;
  }

  // ── Track mutations ────────────────────────────────────────────────────────

  applyConstructionBatch(
    expectedConstructionRevision: number,
    mutate: (draft: WorldConstructionDraft) => boolean,
  ): boolean {
    const world = this._world;
    if (this.batchInProgress
      || !world
      || world.constructionRevision !== expectedConstructionRevision
      || !this.canAdvanceRevision()
      || !Number.isSafeInteger(world.constructionRevision)
      || world.constructionRevision < 0
      || world.constructionRevision >= Number.MAX_SAFE_INTEGER) return false;
    if (!validateWorldData(world).compatible) return false;
    const snapshot = clonePlainData(world);
    const rootRevision = world.revision;
    const tracks = clonePlainData(world.tracks);
    const junctions = clonePlainData(world.junctions);
    let company = clonePlainData(world.company);
    const draft: WorldConstructionDraft = {
      get company() {
        return company;
      },
      set company(nextCompany: CompanyStateDef) {
        company = clonePlainData(nextCompany);
      },
      economyTick: world.economy.tick,
      getTrack: (uuid) => tracks.find((track) => track.uuid === uuid),
      getJunction: (uuid) => junctions.find((junction) => junction.uuid === uuid),
      addTrack: (def, index = tracks.length) => {
        if (tracks.some((track) => track.uuid === def.uuid)) return false;
        if (!Number.isInteger(index) || index < 0 || index > tracks.length) return false;
        tracks.splice(index, 0, clonePlainData(def));
        return true;
      },
      removeTrack: (uuid) => {
        const index = tracks.findIndex((track) => track.uuid === uuid);
        if (index === -1) return false;
        tracks.splice(index, 1);
        return true;
      },
      updateTrack: (def) => {
        const index = tracks.findIndex((track) => track.uuid === def.uuid);
        if (index === -1 || equalPlainData(tracks[index], def)) return false;
        tracks[index] = clonePlainData(def);
        return true;
      },
      addJunction: (def, index = junctions.length) => {
        if (junctions.some((junction) => junction.uuid === def.uuid)) return false;
        if (!Number.isInteger(index) || index < 0 || index > junctions.length) return false;
        junctions.splice(index, 0, clonePlainData(def));
        return true;
      },
      removeJunction: (uuid) => {
        const index = junctions.findIndex((junction) => junction.uuid === uuid);
        if (index === -1) return false;
        junctions.splice(index, 1);
        return true;
      },
    };
    this.batchInProgress = true;
    try {
      let accepted: boolean;
      try {
        accepted = mutate(draft);
      } catch {
        return this.restoreBatchSnapshot(world, snapshot);
      }
      if (!accepted
        || this._world !== world
        || !equalPlainData(world, snapshot)
        || (equalPlainData(tracks, snapshot.tracks)
          && equalPlainData(junctions, snapshot.junctions)
          && equalPlainData(company, snapshot.company))) {
        return this.restoreBatchSnapshot(world, snapshot);
      }

      const candidate: WorldData = {
        ...snapshot,
        revision: rootRevision + 1,
        constructionRevision: expectedConstructionRevision + 1,
        tracks,
        junctions,
        company,
      };
      if (!validateWorldData(candidate).compatible) {
        return this.restoreBatchSnapshot(world, snapshot);
      }

      try {
        world.tracks = clonePlainData(candidate.tracks);
        world.junctions = clonePlainData(candidate.junctions);
        world.company = clonePlainData(candidate.company);
        world.revision = candidate.revision;
        world.constructionRevision = candidate.constructionRevision;
      } catch {
        return this.restoreBatchSnapshot(world, snapshot);
      }
      return true;
    } finally {
      this.batchInProgress = false;
    }
  }

  applyEconomyBatch(
    expectedEconomyRevision: number,
    mutate: (draft: EconomyStateDef) => boolean,
  ): boolean {
    const world = this._world;
    if (this.batchInProgress
      || !world
      || world.economyRevision !== expectedEconomyRevision
      || !this.canAdvanceRevision()
      || !Number.isSafeInteger(world.economyRevision)
      || world.economyRevision < 0
      || world.economyRevision >= Number.MAX_SAFE_INTEGER) return false;
    if (!validateWorldData(world).compatible) return false;
    const snapshot = clonePlainData(world);
    const rootRevision = world.revision;
    const economy = clonePlainData(world.economy);
    this.batchInProgress = true;
    try {
      let accepted: boolean;
      try {
        accepted = mutate(economy);
      } catch {
        return this.restoreBatchSnapshot(world, snapshot);
      }
      if (!accepted
        || this._world !== world
        || !equalPlainData(world, snapshot)
        || equalPlainData(economy, snapshot.economy)) {
        return this.restoreBatchSnapshot(world, snapshot);
      }

      const candidate: WorldData = {
        ...snapshot,
        revision: rootRevision + 1,
        economyRevision: expectedEconomyRevision + 1,
        economy,
      };
      if (!validateWorldData(candidate).compatible) {
        return this.restoreBatchSnapshot(world, snapshot);
      }

      try {
        world.economy = clonePlainData(candidate.economy);
        world.revision = candidate.revision;
        world.economyRevision = candidate.economyRevision;
      } catch {
        return this.restoreBatchSnapshot(world, snapshot);
      }
      return true;
    } finally {
      this.batchInProgress = false;
    }
  }

  addTrackDef(def: TrackDef): boolean {
    const revision = this._world?.constructionRevision;
    return revision !== undefined
      && this.applyConstructionBatch(revision, (draft) => draft.addTrack(def));
  }

  removeTrackDef(uuid: string): boolean {
    const revision = this._world?.constructionRevision;
    return revision !== undefined
      && this.applyConstructionBatch(revision, (draft) => draft.removeTrack(uuid));
  }

  updateTrackDef(updated: TrackDef): boolean {
    const revision = this._world?.constructionRevision;
    return revision !== undefined
      && this.applyConstructionBatch(revision, (draft) => draft.updateTrack(updated));
  }

  // ── Junction mutations ─────────────────────────────────────────────────────

  addJunctionDef(def: JunctionDef): boolean {
    const revision = this._world?.constructionRevision;
    return revision !== undefined
      && this.applyConstructionBatch(revision, (draft) => draft.addJunction(def));
  }

  removeJunctionDef(uuid: string): boolean {
    const revision = this._world?.constructionRevision;
    return revision !== undefined
      && this.applyConstructionBatch(revision, (draft) => draft.removeJunction(uuid));
  }

  // ── Station mutations ──────────────────────────────────────────────────────

  addStationDef(def: WorldStationDef): boolean {
    if (!this._world || !this.canAdvanceRevision()
      || this._world.stations.some((station) => station.id === def.id)) return false;
    this._world.stations.push(def);
    return this.incrementRevision();
  }

  removeStationDef(id: string): boolean {
    if (!this._world || !this.canAdvanceRevision()
      || !this._world.stations.some((station) => station.id === id)) return false;
    this._world.stations = this._world.stations.filter((s) => s.id !== id);
    return this.incrementRevision();
  }

  // ── Train mutations ────────────────────────────────────────────────────────

  addTrainDef(def: TrainDef): boolean {
    if (!this._world || !this.canAdvanceRevision()
      || this._world.trains.some((train) => train.id === def.id)) return false;
    this._world.trains.push(def);
    return this.incrementRevision();
  }

  removeTrainDef(id: string): boolean {
    if (!this._world || !this.canAdvanceRevision()
      || !this._world.trains.some((train) => train.id === id)) return false;
    this._world.trains = this._world.trains.filter((t) => t.id !== id);
    return this.incrementRevision();
  }

  updateTrainDef(updated: Partial<TrainDef> & { id: string }): boolean {
    if (!this._world || !this.canAdvanceRevision()) return false;
    const idx = this._world.trains.findIndex((t) => t.id === updated.id);
    if (idx === -1) return false;
    const next = { ...this._world.trains[idx], ...updated };
    if (JSON.stringify(next) === JSON.stringify(this._world.trains[idx])) return false;
    this._world.trains[idx] = next;
    return this.incrementRevision();
  }

  /** Replace the entire trains array (used to sync live train state before saving). */
  setTrainDefs(defs: TrainDef[]): boolean {
    if (!this._world || !this.canAdvanceRevision()
      || JSON.stringify(this._world.trains) === JSON.stringify(defs)) return false;
    this._world.trains = defs;
    return this.incrementRevision();
  }

  // ── Scenery mutations ──────────────────────────────────────────────────────

  addSceneryDef(def: SceneryObjectDef): boolean {
    if (!this._world || !this.canAdvanceRevision()
      || this._world.scenery.some((scenery) => scenery.id === def.id)) return false;
    this._world.scenery.push(def);
    return this.incrementRevision();
  }

  removeSceneryDef(id: string): boolean {
    if (!this._world || !this.canAdvanceRevision()
      || !this._world.scenery.some((scenery) => scenery.id === id)) return false;
    this._world.scenery = this._world.scenery.filter((s) => s.id !== id);
    return this.incrementRevision();
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

}

export const WorldManager = new WorldManagerClass();
