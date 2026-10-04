import type { EconomyStateDef } from '../config/WorldData';
import { advanceFacilityRecipe, applyFacilityBoundary } from '../economy/IndustrySystem';
import { getFacilityDefinition, getRecipe } from '../economy/ProductCatalog';
import type { RegionState } from './RegionalProjects';

/** Apply project effects once per ordinary economy tick, after the base industry update. */
export function advanceRegionalEconomy(region: RegionState, economy: EconomyStateDef): { region: RegionState; economy: EconomyStateDef } {
  const nextRegion = { ...region, productionRemainders: { ...region.productionRemainders } };
  const nextEconomy: EconomyStateDef = { ...economy, market: { ...economy.market, regionalDemandBpsByProduct: { ...economy.market.regionalDemandBpsByProduct } }, facilities: [...economy.facilities] };
  for (const [productId, bonus] of Object.entries(region.demandBonusBpsByProduct)) nextEconomy.market.regionalDemandBpsByProduct[productId] = Math.min(12_000, 10_000 + bonus);
  nextEconomy.facilities = nextEconomy.facilities.map(facility => {
    let next = facility;
    const definition = getFacilityDefinition(facility.definitionId);
    if (!definition) return next;
    // Consumers actually remove delivered goods; an established supply line stays useful.
    if (definition.boundary === 'town-consumer') {
      for (const productId of Object.keys(facility.inventories)) {
        const units = Math.max(1, Math.floor(2 * (10_000 + (region.demandBonusBpsByProduct[productId] ?? 0)) / 10_000));
        next = applyFacilityBoundary(next, definition, productId, units, 'consumption').facility;
      }
    }
    const bonus = region.productionBonusBpsByDefinition[facility.definitionId] ?? 0;
    const recipe = facility.activeRecipeId ? getRecipe(facility.activeRecipeId) : undefined;
    if (bonus > 0 && recipe) {
      let remainder = (nextRegion.productionRemainders[facility.id] ?? 0) + bonus;
      while (remainder >= 10_000) { next = advanceFacilityRecipe(next, recipe).facility; remainder -= 10_000; }
      nextRegion.productionRemainders[facility.id] = remainder;
    }
    return next;
  });
  return { region: nextRegion, economy: nextEconomy };
}
