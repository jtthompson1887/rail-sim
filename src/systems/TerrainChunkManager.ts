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
 * the chunks within the view radius of the camera centre are kept alive; chunks
 * that scroll out of view are destroyed and recreated on demand.
 *
 * The view radius is computed dynamically from the current camera zoom so that
 * zooming out never leaves black gaps at the viewport edges.
 */
export class TerrainChunkManager {
  private readonly scene: Phaser.Scene;
  private readonly terrain: TerrainGenerator;
  private readonly biome: BiomeType;
  private readonly chunks: Map<string, TerrainChunk> = new Map();
  /** Minimum chunk radius kept alive regardless of zoom. */
  private readonly MIN_RADIUS = 2;

  constructor(scene: Phaser.Scene, terrain: TerrainGenerator, biome: BiomeType) {
    this.scene   = scene;
    this.terrain = terrain;
    this.biome   = biome;
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  /**
   * Call once per frame from WorldScene.update().
   * Loads chunks that enter the view radius and destroys those that leave.
   *
   * @param cameraWorldX  World-space X of the camera centre.
   * @param cameraWorldY  World-space Y of the camera centre.
   * @param zoom          Current camera zoom (default 1 → falls back to MIN_RADIUS).
   */
  update(cameraWorldX: number, cameraWorldY: number, zoom = 1): void {
    // Clamp zoom to safe bounds to avoid division by zero, Infinity, or NaN.
    const safeZoom = Math.max(
      GameConfig.CAMERA.MIN_ZOOM,
      Math.min(GameConfig.CAMERA.MAX_ZOOM, Number.isFinite(zoom) ? zoom : 1),
    );

    const centreChunkX = Math.floor(cameraWorldX / CHUNK);
    const centreChunkY = Math.floor(cameraWorldY / CHUNK);

    // Compute how many chunks are visible in each half-axis at this zoom level,
    // add +1 as a boundary buffer so there is always at least one chunk of terrain
    // outside the visible edge even when the centre sits right on a chunk boundary.
    const { WIDTH, HEIGHT } = GameConfig.RESOLUTION;
    const halfVisW = (WIDTH  / safeZoom) / 2;
    const halfVisH = (HEIGHT / safeZoom) / 2;
    const neededX  = Math.ceil(halfVisW / CHUNK) + 1;
    const neededY  = Math.ceil(halfVisH / CHUNK) + 1;
    const r = Math.max(this.MIN_RADIUS, neededX, neededY);

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
