import { INITIAL_FACILITY_DEFINITIONS, LAUNCH_PRODUCTS, LAUNCH_RECIPES, LAUNCH_FACILITY_DEFINITIONS } from '../../src/economy/InitialEconomyContent';
import { validateEconomyContent, getProduct } from '../../src/economy/ProductCatalog';
import { quoteLocalProduct } from '../../src/economy/MarketSystem';
import { advanceFacilityRecipe } from '../../src/economy/IndustrySystem';
import { LAUNCH_FREIGHT_SETS, capacityForProduct, validateFreightSetContent } from '../../src/freight/FreightSetCatalog';
import { acceptProject, applyRegionEvent, connectProjectStation, createRegionState, footprintIsClear, REGIONAL_PROJECTS, resolveTransformationFootprints, validateRegionState } from '../../src/region/RegionalProjects';
import { advanceRegionalEconomy } from '../../src/region/RegionalEconomy';
import { generateSecondaryFacilities } from '../../src/region/SecondaryFacilities';
import { POWERED_VEHICLE_FAMILIES, UNPOWERED_VEHICLE_FAMILIES, availableTractiveEffortN, physicsForVehicleFamily, vehicleFamilyRouteBlocker } from '../../src/region/VehicleRoster';
import type { EconomyStateDef } from '../../src/config/WorldData';
import type { FacilityEconomyDef } from '../../src/economy/EconomyData';

const facilities = (): FacilityEconomyDef[] => LAUNCH_FACILITY_DEFINITIONS.map((d, i) => ({ id: d.id, definitionId: d.id, name: d.displayName, x: i * 1_000, y: 0, railAccess: { x: i * 1_000, y: 0, radius: 320 }, inventories: Object.fromEntries(d.inventory.map(s => [s.productId, { productId: s.productId, quantity: s.initialQuantity, capacity: s.capacity, targetStock: s.targetStock, recentInflow: 0, recentOutflow: 0, reservedQuantity: 0 }])), activeRecipeId: d.recipeIds[0] ?? null, recipeProgressTicks: 0 }));
const economy = (): EconomyStateDef => ({ economyVersion: 1, tick: 0, facilities: facilities(), market: { constructionIndexBps: 10_000, regionalDemandBpsByProduct: Object.fromEntries(LAUNCH_PRODUCTS.map(p => [p.id, 10_000])) } });
const freight = (id: string, productId: string, units: number, destinationFacilityId: string, originFacilityId?: string) => ({ id, kind: 'freight-delivery' as const, tick: 4, productId, units, destinationFacilityId, originFacilityId });

describe('launch content', () => {
  it('validates ten goods and complete production chains without altering the original seven-site catalogue', () => {
    expect(INITIAL_FACILITY_DEFINITIONS).toHaveLength(7);
    expect(LAUNCH_PRODUCTS).toHaveLength(10);
    expect(validateEconomyContent(LAUNCH_PRODUCTS, LAUNCH_RECIPES, LAUNCH_FACILITY_DEFINITIONS)).toEqual({ valid: true });
    expect(validateFreightSetContent(LAUNCH_FREIGHT_SETS, LAUNCH_PRODUCTS)).toEqual({ valid: true });
    for (const product of LAUNCH_PRODUCTS) expect(LAUNCH_FREIGHT_SETS.some(set => capacityForProduct(set, product).ok)).toBe(true);
    expect(LAUNCH_RECIPES.find(r => r.id === 'steel-recycling')?.outputs).toEqual([{ productId: 'steel', quantity: 8 }]);
  });
  it('does not expose food prices to the construction index and reads legacy missing launch factors safely', () => {
    const slot = facilities().find(f => f.definitionId === 'town-food-market')!.inventories.food;
    const first = quoteLocalProduct('food', { constructionIndexBps: 8_500, regionalDemandBpsByProduct: {} }, slot);
    const second = quoteLocalProduct('food', { constructionIndexBps: 11_500, regionalDemandBpsByProduct: {} }, slot);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(getProduct('scrap')).toBeDefined();
  });
  it('executes food and recycling recipes while consuming their actual inputs', () => {
    for (const recipeId of ['grain-milling', 'food-production', 'steel-recycling']) {
      const recipe = LAUNCH_RECIPES.find(r => r.id === recipeId)!;
      let facility = facilities().find(f => f.activeRecipeId === recipeId)!;
      recipe.inputs.forEach(input => { facility.inventories[input.productId].quantity = input.quantity; });
      for (let tick = 0; tick < recipe.cycleTicks; tick++) facility = advanceFacilityRecipe(facility, recipe).facility;
      for (const input of recipe.inputs) expect(facility.inventories[input.productId].quantity).toBe(0);
      for (const output of recipe.outputs) expect(facility.inventories[output.productId].quantity).toBe(output.quantity);
      expect(advanceFacilityRecipe(facility, recipe).blocker).toBe('waiting-input');
    }
  });
  it('gives six powered and five unpowered roles real physical and route differences', () => {
    expect(POWERED_VEHICLE_FAMILIES).toHaveLength(6);
    expect(UNPOWERED_VEHICLE_FAMILIES).toHaveLength(5);
    expect(new Set(POWERED_VEHICLE_FAMILIES.map(f => `${f.role}:${f.traction}`)).size).toBe(6);
    for (const family of POWERED_VEHICLE_FAMILIES) {
      expect(physicsForVehicleFamily(family.id)?.massKg).toBe(family.massKg);
      expect(availableTractiveEffortN(family, 100)).toBeLessThanOrEqual(family.tractiveEffortN);
      expect(vehicleFamilyRouteBlocker(family, { electrified: false, passengerService: false }) !== null).toBe(family.traction === 'electric');
    }
    expect(vehicleFamilyRouteBlocker(POWERED_VEHICLE_FAMILIES[4], { electrified: true, shortestPlatformMetres: 60, passengerService: true })).toContain('platform');
  });
});

describe('regional projects', () => {
  it('only progresses accepted projects from matching authoritative events and pays once across reload', () => {
    const original = createRegionState({ economy: economy() });
    expect(applyRegionEvent(original, freight('ignored', 'building-modules', 16, 'town-construction-market')).state.projects[0].progress.modules).toBe(0);
    let state = connectProjectStation(acceptProject(original, 'housing'), 'housing', 'town-station');
    state = applyRegionEvent(state, freight('modules', 'building-modules', 16, 'town-construction-market')).state;
    expect(applyRegionEvent(state, { id: 'far', kind: 'passenger-arrival', tick: 5, stationId: 'far-away', passengers: 60 }).outcomes).toEqual([]);
    const housing = state.projects.find(project => project.definitionId === 'housing')!;
    const arrival = { id: 'arrive', kind: 'passenger-arrival' as const, tick: 6, stationId: 'town-station', passengers: 60, x: housing.x, y: housing.y };
    const completed = applyRegionEvent(state, arrival);
    expect(completed.outcomes).toEqual([expect.objectContaining({ id: 'project:housing', grant: 30_000 })]);
    expect(completed.state.transformations).toHaveLength(1);
    expect(validateRegionState(JSON.parse(JSON.stringify(completed.state)))).toBe(true);
    expect(validateRegionState({ ...completed.state, transformations: [] })).toBe(false);
    expect(completed.state.passengerDemandBonusBps).toBe(2_500);
    expect(applyRegionEvent(JSON.parse(JSON.stringify(completed.state)), arrival).outcomes).toEqual([]);
    expect(original.projects[0].progress.modules).toBe(0);
  });
  it('never allocates one delivered consignment twice to competing projects', () => {
    let state = acceptProject(acceptProject(createRegionState({ economy: economy() }), 'housing'), 'port');
    state = applyRegionEvent(state, freight('one', 'building-modules', 20, 'town-construction-market')).state;
    expect(state.projects.find(p => p.definitionId === 'housing')!.progress.modules).toBe(16);
    expect(state.projects.find(p => p.definitionId === 'port')!.progress.modules).toBe(4);
    expect(applyRegionEvent(state, freight('one', 'building-modules', 20, 'town-construction-market')).state).toBe(state);
  });
  it('requires the recycled steel origin and prevents invalid quantities from counting', () => {
    let state = acceptProject(createRegionState({ economy: economy() }), 'recycling');
    state = applyRegionEvent(state, freight('scrap', 'scrap', 60, 'recycling-works')).state;
    expect(applyRegionEvent(state, freight('import', 'steel', 30, 'prefabrication-plant', 'port-interchange')).outcomes).toEqual([]);
    expect(applyRegionEvent(state, freight('bad', 'steel', NaN, 'prefabrication-plant', 'recycling-works')).state).toBe(state);
    expect(applyRegionEvent(state, freight('recycled', 'steel', 30, 'prefabrication-plant', 'recycling-works')).outcomes[0].projectId).toBe('recycling');
  });
  it('offers five distinct completion requirements', () => {
    expect(REGIONAL_PROJECTS.map(d => d.id)).toEqual(['housing', 'factory', 'port', 'visitor', 'recycling']);
    expect(REGIONAL_PROJECTS.every(d => d.requirements.length > 1)).toBe(true);
  });
  it.each(REGIONAL_PROJECTS)('completes and persists $id through real requirement events exactly once', definition => {
    let state = connectProjectStation(acceptProject(createRegionState({ economy: economy() }), definition.id), definition.id, 'project-station');
    const project = state.projects.find(candidate => candidate.definitionId === definition.id)!;
    const outcomes: unknown[] = [];
    for (const requirement of definition.requirements) {
      const event = requirement.kind === 'freight-delivery'
        ? freight(`${definition.id}:${requirement.id}`, requirement.productId, requirement.units, requirement.destinationDefinitionId, requirement.productId === 'steel' ? 'recycling-works' : undefined)
        : { id: `${definition.id}:${requirement.id}`, kind: 'passenger-arrival' as const, tick: 5, stationId: 'project-station', passengers: requirement.passengers, x: project.x, y: project.y };
      const applied = applyRegionEvent(state, event);
      state = JSON.parse(JSON.stringify(applied.state));
      outcomes.push(...applied.outcomes);
      expect(applyRegionEvent(state, event).outcomes).toEqual([]);
    }
    expect(outcomes).toHaveLength(1);
    expect(state.projects.find(p => p.definitionId === definition.id)!.completedAtTick).not.toBeNull();
    expect(validateRegionState(state)).toBe(true);
    expect(state.unlockIds).toEqual([...definition.reward.unlockIds].sort());
  });
  it('production and demand rewards affect the actual economy without creating inputs', () => {
    const source = economy();
    const factory = source.facilities.find(f => f.definitionId === 'prefabrication-plant')!;
    factory.inventories['structural-timber'].quantity = 8;
    factory.inventories.cement.quantity = 8;
    factory.inventories.steel.quantity = 6;
    factory.recipeProgressTicks = 5;
    let region = createRegionState({ economy: source });
    region.productionBonusBpsByDefinition['prefabrication-plant'] = 10_000;
    region.demandBonusBpsByProduct.food = 1_000;
    const result = advanceRegionalEconomy(region, source);
    const produced = result.economy.facilities.find(f => f.id === factory.id)!;
    expect(produced.inventories['building-modules'].quantity).toBe(4);
    expect(produced.inventories.steel.quantity).toBe(0);
    expect(factory.inventories.steel.quantity).toBe(6);
    expect(result.economy.market.regionalDemandBpsByProduct.food).toBe(11_000);
    const noInputs = advanceRegionalEconomy(result.region, result.economy);
    expect(noInputs.economy.facilities.find(f => f.id === factory.id)!.inventories['building-modules'].quantity).toBe(4);
  });
  it('relocates visible transformation away from both live rails and blueprint rails', () => {
    const state = createRegionState({ economy: economy() });
    state.projects[0].completedAtTick = 10;
    const first = resolveTransformationFootprints(state, [])[0];
    const blocked = { geometryVersion: 1 as const, p0: { x: first.x - 200, y: first.y }, p1: { x: first.x - 50, y: first.y }, p2: { x: first.x + 50, y: first.y }, p3: { x: first.x + 200, y: first.y } };
    expect(footprintIsClear(first, [blocked])).toBe(false);
    const next = resolveTransformationFootprints(state, [], [blocked])[0];
    expect(next).not.toEqual(first);
    expect(footprintIsClear(next, [blocked])).toBe(true);
  });
});

describe('secondary industry sites', () => {
  it('is deterministic, additive and idempotent without changing the witnessed starter sites', () => {
    const source = { id: 'world', generationConfig: { generationConfigVersion: 1 as const, seed: 'regional-test', biome: 'temperate' as const, constructionDifficultyId: 'standard' as const }, economy: { ...economy(), facilities: facilities().slice(0, 7) }, tracks: [] };
    const additions = generateSecondaryFacilities(source, { getHeightAt: () => 10 });
    expect(additions).toHaveLength(6);
    expect(generateSecondaryFacilities(source, { getHeightAt: () => 10 })).toEqual(additions);
    expect(source.economy.facilities).toHaveLength(7);
    expect(generateSecondaryFacilities({ ...source, economy: { ...source.economy, facilities: [...source.economy.facilities, ...additions] } })).toEqual([]);
  });
  it('fails atomically when all candidate terrain is underwater', () => {
    const source = { id: 'world', generationConfig: { generationConfigVersion: 1 as const, seed: 'wet', biome: 'temperate' as const, constructionDifficultyId: 'standard' as const }, economy: economy(), tracks: [] };
    source.economy.facilities = source.economy.facilities.slice(0, 7);
    expect(() => generateSecondaryFacilities(source, { getHeightAt: () => -1 })).toThrow('No safe secondary site');
    expect(source.economy.facilities).toHaveLength(7);
  });
});
