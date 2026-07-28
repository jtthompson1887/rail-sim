import type { SceneryObjectDef } from '../model/CabWorldSnapshot';
import { worldToBabylon } from '../model/CabCoordinate';

export type SceneryType = SceneryObjectDef['type'];

/**
 * Pure helper that turns scenery definitions into per-type Float32Array matrix
 * buffers ready for Babylon `thinInstanceSetBuffer`.
 *
 * Each matrix encodes scale, a Y-axis rotation derived from `def.rotation`, and
 * a translation at `worldToBabylon(def.x, def.y, getHeightAt(def.x, def.y))`.
 */
export function buildSceneryMatrixBuffers(
  scenery: ReadonlyArray<SceneryObjectDef>,
  getHeightAt: (worldX: number, worldY: number) => number,
): Map<SceneryType, Float32Array> {
  const groups = new Map<SceneryType, number[]>();

  for (const def of scenery) {
    const floats = groups.get(def.type);
    if (floats) {
      floats.push(...computeSceneryMatrixFloats(def, getHeightAt));
    } else {
      groups.set(def.type, computeSceneryMatrixFloats(def, getHeightAt));
    }
  }

  const buffers = new Map<SceneryType, Float32Array>();
  for (const [type, floats] of groups) {
    buffers.set(type, new Float32Array(floats));
  }
  return buffers;
}

/**
 * Build a single 16-float column-major matrix for a scenery instance.
 *
 * The Babylon yaw is the negative of the world rotation so that the object
 * faces the same way as it would in the 2-D world.
 */
export function computeSceneryMatrixFloats(
  def: SceneryObjectDef,
  getHeightAt: (worldX: number, worldY: number) => number,
): number[] {
  const pos = worldToBabylon(def.x, def.y, getHeightAt(def.x, def.y));
  const yaw = -def.rotation;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const scale = def.scale;

  return [
    scale * c, 0, -scale * s, 0,
    0, scale, 0, 0,
    scale * s, 0, scale * c, 0,
    pos.x, pos.y, pos.z, 1,
  ];
}
