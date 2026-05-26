import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { SceneryObject } from '../entities/SceneryObject';
import { SceneryGenerator } from '../systems/SceneryGenerator';
import type { TerrainGenerator } from '../systems/TerrainGenerator';
import type { SceneryObjectDef, BiomeType } from '../config/WorldData';
import { WorldManager } from './WorldManager';

const CHUNK = GameConfig.WORLD.CHUNK_SIZE;

/**
 * SceneryManager
 *
 * Manages the lifecycle of SceneryObject instances for the currently visible
 * chunk neighbourhood. On chunk load it first checks WorldData.scenery for
 * persisted player-authored placements; if none exist it falls back to
 * procedural generation via SceneryGenerator.
 */
export class SceneryManager {
  private readonly scene: Phaser.Scene;
  private readonly generator: SceneryGenerator;
  private readonly biome: BiomeType;
  private readonly seed: string;
  /** Map of chunk key → active SceneryObject list. */
  private readonly chunkObjects: Map<string, SceneryObject[]> = new Map();
  private readonly VIEW_RADIUS = 2;

  constructor(
    scene: Phaser.Scene,
    terrain: TerrainGenerator,
    biome: BiomeType,
    seed: string,
  ) {
    this.scene     = scene;
    this.generator = new SceneryGenerator(terrain);
    this.biome     = biome;
    this.seed      = seed;
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  /**
   * Call once per frame from WorldScene.update().
   * Streams scenery objects in and out with the camera.
   */
  update(cameraWorldX: number, cameraWorldY: number): void {
    const centreChunkX = Math.floor(cameraWorldX / CHUNK);
    const centreChunkY = Math.floor(cameraWorldY / CHUNK);

    const r = this.VIEW_RADIUS;
    const needed = new Set<string>();

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = centreChunkX + dx;
        const cy = centreChunkY + dy;
        const key = `${cx}:${cy}`;
        needed.add(key);

        if (!this.chunkObjects.has(key)) {
          this.loadChunk(cx, cy, key);
        }
      }
    }

    // Unload chunks that left the view radius
    for (const [key, objects] of this.chunkObjects) {
      if (!needed.has(key)) {
        for (const obj of objects) obj.destroy();
        this.chunkObjects.delete(key);
      }
    }
  }

  /** Destroy all managed objects (call on scene shutdown). */
  destroyAll(): void {
    for (const objects of this.chunkObjects.values()) {
      for (const obj of objects) obj.destroy();
    }
    this.chunkObjects.clear();
  }

  /** Number of currently active SceneryObject instances. */
  get activeObjectCount(): number {
    let count = 0;
    for (const objs of this.chunkObjects.values()) count += objs.length;
    return count;
  }

  // ── Chunk loading ────────────────────────────────────────────────────────────

  private loadChunk(cx: number, cy: number, key: string): void {
    const defs = this.getSceneryDefsForChunk(cx, cy);
    const objects: SceneryObject[] = [];

    for (const def of defs) {
      objects.push(new SceneryObject(this.scene, def));
    }

    this.chunkObjects.set(key, objects);
  }

  /**
   * Return scenery definitions for a chunk. Checks WorldData.scenery for
   * persisted edits first; falls back to procedural generation.
   */
  getSceneryDefsForChunk(cx: number, cy: number): SceneryObjectDef[] {
    const chunkX = cx * CHUNK;
    const chunkY = cy * CHUNK;
    const world  = WorldManager.world;

    // Use persisted defs if the player has manually edited this chunk
    if (world && world.scenery.length > 0) {
      const persisted = world.scenery.filter(
        (s) => s.x >= chunkX && s.x < chunkX + CHUNK &&
                s.y >= chunkY && s.y < chunkY + CHUNK,
      );
      if (persisted.length > 0) return persisted;
    }

    // Fall back to procedural generation
    return this.generator.generateForChunk(chunkX, chunkY, this.seed, this.biome);
  }
}
