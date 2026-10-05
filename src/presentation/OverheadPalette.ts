/** Shared quiet materials for the overhead illustration; no gameplay state belongs here. */
export const OVERHEAD = {
  grass: 0x8c9c6c, meadow: 0x778d62, field: 0xa6ae79, harvest: 0xb9ae79,
  treeShade: 0x344c36, tree: 0x526d42, treeLight: 0x79955b,
  slate: 0x4b5b5c, slateLight: 0x6b7774, brick: 0x97765b,
  yard: 0xb9b19b, yardShade: 0x918c7b, sand: 0xc6bd99,
  water: 0x427c87, waterDeep: 0x355e71, waterLight: 0x74a7aa,
  shadow: 0x243b37, cream: 0xe0d9bd,
} as const;

export function artHash(x: number, y: number, salt = 0): number {
  let h = Math.imul(Math.floor(x), 374761393) ^ Math.imul(Math.floor(y), 668265263) ^ Math.imul(salt, 144269);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function mixArtColour(a: number, b: number, fraction: number): number {
  const t = Math.max(0, Math.min(1, fraction));
  const channel = (shift: number) => Math.round(((a >>> shift) & 255) * (1 - t) + ((b >>> shift) & 255) * t);
  return channel(16) << 16 | channel(8) << 8 | channel(0);
}
