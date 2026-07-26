/**
 * Read-only height sampler used by the 3-D cab view.
 *
 * Adapters wrap the existing {@link TerrainGenerator} so the renderer can
 * sample terrain heights without pulling Phaser into the lazy-loaded chunk.
 */
export interface ITerrainSampler {
  /** Height above sea level in metres at the given world position. */
  getHeightAt(worldX: number, worldY: number): number;
}
