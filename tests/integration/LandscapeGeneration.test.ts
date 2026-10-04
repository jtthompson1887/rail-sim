import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { WorldOpportunityGenerator } from '../../src/systems/WorldOpportunityGenerator';
import { WorldOpportunityValidator } from '../../src/systems/WorldOpportunityValidator';
import { WorldEconomyGenerator, validateGeneratedEconomy, type EconomyGenerationResult } from '../../src/economy/WorldEconomyGenerator';
import { LANDSCAPE_PRESET_IDS } from '../../src/config/WorldGeneration';
import type { WorldGenerationConfigDef } from '../../src/config/WorldData';
import { generateSecondaryFacilities } from '../../src/region/SecondaryFacilities';

describe('landscape generation witnesses', () => {
  it.each(LANDSCAPE_PRESET_IDS)('finds affordable verified starter and industry routes on %s', preset => {
    const seed = 'playtest-884';
    const terrain = new TerrainGenerator(seed, preset);
    const config: WorldGenerationConfigDef = { generationConfigVersion: 1, seed, biome: preset === 'mountains' ? 'alpine' : 'temperate', constructionDifficultyId: 'standard' };
    const economyGenerator = new WorldEconomyGenerator(terrain);
    let accepted: Extract<EconomyGenerationResult, { ok: true }> | null = null;
    const generated = new WorldOpportunityGenerator(terrain, opportunity => {
      const economy = economyGenerator.generate(config, opportunity);
      if (!economy.ok) return false;
      accepted = economy;
      return true;
    }).generate(config);
    expect(generated.ok).toBe(true);
    if (!generated.ok || !accepted) throw new Error(`No valid ${preset} starter`);
    expect(new WorldOpportunityValidator(terrain).validate(generated.opportunity, config).valid).toBe(true);
    expect(validateGeneratedEconomy(accepted.economy, generated.opportunity, terrain, accepted.diagnostics)).toBe(true);
    const additions = generateSecondaryFacilities({ id: 'preset-test', generationConfig: config, economy: accepted.economy, tracks: [] }, terrain);
    expect(additions).toHaveLength(6);
    expect(additions.every(f => terrain.getHeightAt(f.x, f.y) >= 0)).toBe(true);
  }, 60_000);
});
