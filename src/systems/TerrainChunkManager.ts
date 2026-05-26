import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { TerrainChunk } from '../entities/TerrainChunk';
import type { TerrainGenerator } from './TerrainGenerator';
import type { BiomeType } from '../config/WorldData';

const CHUNK = GameConfig.WORLD.CHUNK_SIZE;

/**
 * TerrainChunkManager
 *
 * Manages a streaming pool of TerrainChunk objects around the camera. Only
 * the chunks within a VIEW_RADIUS of the camera centre are kept alive; chunks
 * that scroll out of view are destroyed and recreated on demand.
 *
 * Uses a 5×5 grid of chunks (2 chunks' radius in each direction) so there is
 * always a buffer of at least one chunk outside the visible viewport.
 */
export class TerrainChunkManager {
  private readonly scene: Phaser.Scene;
  private readonly terrain: TerrainGenerator;
  private readonly biome: BiomeType;
  private readonly chunks: Map<string, TerrainChunk> = new Map();
  /** Number of chunks to maintain in each direction from the camera. */
  private readonly VIEW_RADIUS = 2;

  constructor(scene: Phaser.Scene, terrain: TerrainGenerator, biome: BiomeType) {
    this.scene   = scene;
    this.terrain = terrain;
    this.biome   = biome;
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  /**
   * Call once per frame from WorldScene.update().
   * Loads chunks that enter the view radius and destroys those that leave.
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

        if (!this.chunks.has(key)) {
          const chunk = new TerrainChunk(
            this.scene,
            cx * CHUNK,
            cy * CHUNK,
            this.terrain,
            this.biome,
          );
          this.chunks.set(key, chunk);
        }
      }
    }

    // Destroy chunks no longer needed
    for (const [key, chunk] of this.chunks) {
      if (!needed.has(key)) {
        chunk.destroy();
        this.chunks.delete(key);
      }
    }
  }

  /** Destroy all chunks (call when the scene shuts down). */
  destroyAll(): void {
    for (const chunk of this.chunks.values()) {
      chunk.destroy();
    }
    this.chunks.clear();
  }

  /** Number of currently active chunks. */
  get activeChunkCount(): number {
    return this.chunks.size;
  }
}
