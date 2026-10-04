export type GameDifficulty = 'standard' | 'expert' | 'sandbox';
export const GAME_DIFFICULTIES = [
  { id: 'standard' as const, name: 'Standard', startingCashMultiplier: 1, runningCostMultiplier: 1, recoveryGrant: 30_000, unlimitedMoney: false, description: 'Thoughtful pressure, clear warnings and a recovery grant.' },
  { id: 'expert' as const, name: 'Expert', startingCashMultiplier: 0.75, runningCostMultiplier: 1.25, recoveryGrant: 15_000, unlimitedMoney: false, description: 'Tighter finances and stronger operating pressure; all failures remain recoverable.' },
  { id: 'sandbox' as const, name: 'Sandbox', startingCashMultiplier: 1, runningCostMultiplier: 0, recoveryGrant: 0, unlimitedMoney: true, description: 'Build freely with the same railway operations and optional projects.' },
] as const;
export const LANDSCAPE_PRESETS = [
  { id: 'lowlands', name: 'Rolling Lowlands', biome: 'temperate' as const, seedPrefix: 'heartland', description: 'Gentle farmland, market towns and mixed passenger and freight lines.' },
  { id: 'coastal', name: 'Coastal Estuary', biome: 'temperate' as const, seedPrefix: 'estuary', description: 'A tidal coastline and inland shelf make crossings and harbour connections matter.' },
  { id: 'mountains', name: 'Highland Valleys', biome: 'alpine' as const, seedPrefix: 'highland', description: 'Broad mountain ridges and winding valleys make power and earthworks matter.' },
] as const;
export const getGameDifficulty = (id: string) => GAME_DIFFICULTIES.find(d => d.id === id) ?? GAME_DIFFICULTIES[0];
