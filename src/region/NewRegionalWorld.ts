import type { WorldData } from '../config/WorldData';
import { STANDARD_STARTING_CASH } from '../config/ConstructionConfig';
import { createCompanyState } from '../economy/FinanceLedger';
import { LAUNCH_PRODUCTS } from '../economy/InitialEconomyContent';
import { createManagementState } from '../simulation/SimulationTypes';
import { clonePlainData } from '../utils/PlainData';
import { createRegionState } from './RegionalProjects';
import { generateSecondaryFacilities, type SecondaryTerrainSampler } from './SecondaryFacilities';
import { getGameDifficulty, type GameDifficulty } from './GamePresets';

/** Prepare a detached new world before its first durable save; failure cannot install a partial region. */
export function prepareNewRegionalWorld(world: WorldData, terrain: SecondaryTerrainSampler, difficulty: GameDifficulty = 'standard'): WorldData {
  if (world.revision !== 0 || world.tracks.length !== 0 || world.trains.length !== 0 || world.company.ledger.length !== 1) throw new Error('Regional new-world preparation only accepts an untouched world.');
  const next = clonePlainData(world);
  const rules = getGameDifficulty(difficulty);
  next.economy.facilities.push(...generateSecondaryFacilities(next, terrain));
  LAUNCH_PRODUCTS.forEach(product => { next.economy.market.regionalDemandBpsByProduct[product.id] ??= 10_000; });
  next.management = createManagementState();
  next.management.speed = 0;
  next.region = createRegionState(next);
  next.generationConfig.gameDifficulty = rules.id;
  // Sandbox expenses are waived by management commands; the reserve also supports legacy construction tools.
  const cash = rules.unlimitedMoney ? 1_000_000_000 : Math.round(STANDARD_STARTING_CASH * rules.startingCashMultiplier);
  next.company = createCompanyState(cash);
  return next;
}
