import type { WorldData } from '../config/WorldData';
import type { FacilityEconomyDef } from '../economy/EconomyData';
import { SECONDARY_FACILITY_DEFINITIONS } from '../economy/InitialEconomyContent';
import { createSeededRandom } from '../utils/SeededRandom';
import { footprintIsClear } from './RegionalProjects';

export interface SecondaryTerrainSampler { getHeightAt(x: number, y: number): number }

/** Returns additions only. Call before createRegionState when enabling the regional game. */
export function generateSecondaryFacilities(world: Pick<WorldData, 'id' | 'generationConfig' | 'economy' | 'tracks'>, terrain?: SecondaryTerrainSampler): FacilityEconomyDef[] {
  const occupied = world.economy.facilities.map(f => ({ x: f.x, y: f.y }));
  const output: FacilityEconomyDef[] = [];
  for (const definition of SECONDARY_FACILITY_DEFINITIONS) {
    if (world.economy.facilities.some(f => f.definitionId === definition.id)) continue;
    const random = createSeededRandom(`${world.generationConfig.seed}:secondary:${definition.id}`);
    let position: { x: number; y: number } | null = null;
    for (let attempt = 0; attempt < 512; attempt++) {
      const candidate = { x: Math.round((random() * 14_000 - 7_000) / 16) * 16, y: Math.round((random() * 14_000 - 7_000) / 16) * 16 };
      if (occupied.some(p => Math.hypot(p.x - candidate.x, p.y - candidate.y) < 720) || !footprintIsClear({ ...candidate, radius: 200 }, world.tracks)) continue;
      if (terrain) {
        const heights = [[0, 0], [160, 0], [-160, 0], [0, 160], [0, -160]].map(([x, y]) => terrain.getHeightAt(candidate.x + x, candidate.y + y));
        if (heights.some(h => !Number.isFinite(h) || h < 0) || Math.max(...heights) - Math.min(...heights) > 40) continue;
      }
      position = candidate;
      break;
    }
    if (!position) throw new Error(`No safe secondary site for ${definition.id}; the existing world has not been changed.`);
    occupied.push(position);
    output.push({ id: `${world.id}:${definition.id}`, definitionId: definition.id, name: definition.displayName, ...position, railAccess: { ...position, radius: 320 }, inventories: Object.fromEntries(definition.inventory.map(slot => [slot.productId, { productId: slot.productId, quantity: slot.initialQuantity, reservedQuantity: 0, capacity: slot.capacity, targetStock: slot.targetStock, recentInflow: 0, recentOutflow: 0 }])), activeRecipeId: definition.recipeIds[0] ?? null, recipeProgressTicks: 0 });
  }
  return output;
}
