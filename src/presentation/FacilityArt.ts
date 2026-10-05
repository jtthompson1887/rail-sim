import type Phaser from 'phaser';
import type { FacilityInspectionDto } from '../economy/FacilityPresentation';
import { OVERHEAD, artHash } from './OverheadPalette';

type G = Phaser.GameObjects.Graphics;

function roof(g: G, x: number, y: number, width: number, height: number, brick = false): void {
  g.fillStyle(OVERHEAD.shadow, .08).fillRoundedRect(x + 5, y + 7, width + 9, height + 10, 5);
  g.fillStyle(OVERHEAD.shadow, .16).fillRoundedRect(x + 8, y + 10, width + 2, height + 3, 3);
  g.fillStyle(brick ? OVERHEAD.brick : 0xb2aa8f).fillRect(x - 3, y - 3, width + 6, height + 6);
  g.fillStyle(OVERHEAD.slateLight).fillRect(x, y, width, height / 2);
  g.fillStyle(OVERHEAD.slate).fillRect(x, y + height / 2, width, height / 2);
  g.lineStyle(2, 0xa4aaa0, .26);
  for (let line = 11; line < width; line += 13) g.lineBetween(x + line, y + 2, x + line, y + height - 2);
  g.lineStyle(4, 0x97a298, .9).lineBetween(x - 2, y + height / 2, x + width + 2, y + height / 2);
  g.lineStyle(2, 0x30433f, .8).strokeRect(x, y, width, height);
  for (let line = 25; line < width - 20; line += 64) {
    g.fillStyle(0x8caeb0).fillRect(x + line, y + 19, 26, 14);
    g.lineStyle(2, 0xc0c8b8).strokeRect(x + line, y + 19, 26, 14);
    g.lineStyle(1, 0x567975).lineBetween(x + line + 13, y + 19, x + line + 13, y + 33);
  }
  // Roof vents and masonry chimneys stay entirely within the overhead footprint.
  g.fillStyle(OVERHEAD.shadow, .2).fillRect(x + width - 31, y + height - 25, 17, 17);
  g.fillStyle(0xb7afa0).fillRect(x + width - 35, y + height - 29, 17, 17);
  g.fillStyle(0x344c48).fillRect(x + width - 31, y + height - 25, 9, 9);
}

function tank(g: G, x: number, y: number, radius: number): void {
  g.fillStyle(OVERHEAD.shadow, .17).fillCircle(x + 8, y + 10, radius + 1);
  g.fillStyle(0x6d7c73).fillCircle(x, y, radius + 3);
  g.fillStyle(0xc4c9b8).fillCircle(x, y, radius);
  g.fillStyle(0xdce0cd, .8).fillEllipse(x - radius * .2, y - radius * .22, radius * 1.4, radius * 1.3);
  g.lineStyle(2, 0x8b9e91).strokeCircle(x, y, radius * .76);
  g.fillStyle(0x6b837b).fillCircle(x, y, 5);
  g.lineStyle(2, 0x9dad99).lineBetween(x, y, x + radius * .7, y + radius * .3);
}

function stock(g: G, product: string, quantity: number, capacity: number, x: number, y: number): void {
  const count = Math.min(6, Math.max(0, Math.ceil(quantity / Math.max(1, capacity) * 6)));
  g.fillStyle(0x867d68, .24).fillRoundedRect(x - 5, y - 5, 135, 84, 4);
  for (let i = 0; i < count; i++) {
    const sx = x + i % 3 * 44, sy = y + Math.floor(i / 3) * 39;
    g.fillStyle(OVERHEAD.shadow, .16).fillRect(sx + 5, sy + 6, 36, 31);
    if (product === 'logs' || product === 'structural-timber') {
      for (let p = 0; p < 4; p++) {
        g.fillStyle(p % 2 ? 0xac8454 : 0xc09967).fillRect(sx, sy + p * 7, 35, 5);
        if (product === 'logs') {g.fillStyle(0xd7b27b).fillCircle(sx + 2, sy + p * 7 + 2.5, 2.5);}
        g.lineStyle(1, 0x7e6242, .65).lineBetween(sx + 5, sy + p * 7 + 2, sx + 32, sy + p * 7 + 2);
      }
      g.lineStyle(2, 0x66716a).lineBetween(sx + 10, sy - 1, sx + 10, sy + 27).lineBetween(sx + 27, sy - 1, sx + 27, sy + 27);
    } else if (product === 'building-modules') {
      g.fillStyle(0xddd7c2).fillRect(sx, sy, 36, 28);
      g.fillStyle(0xc2c8b9).fillRect(sx + 3, sy + 3, 30, 22);
      g.lineStyle(2, 0x82978c).strokeRect(sx + 3, sy + 3, 30, 22).lineBetween(sx + 18, sy + 3, sx + 18, sy + 25);
      g.lineStyle(2, 0xd7bc79).lineBetween(sx + 8, sy - 1, sx + 8, sy + 29).lineBetween(sx + 28, sy - 1, sx + 28, sy + 29);
    } else if (product === 'steel' || product === 'scrap') {
      for (let p = 0; p < 5; p++) {
        g.fillStyle(p % 2 ? 0x6c8280 : 0x3e5a5b).fillRect(sx, sy + p * 6, 35 - (product === 'scrap' ? p * 3 : 0), 4);
        g.lineStyle(1, 0xa2b2a6, .7).lineBetween(sx + 1, sy + p * 6, sx + 30, sy + p * 6);
      }
    } else if (product === 'limestone' || product === 'grain' || product === 'cement') {
      g.fillStyle(product === 'grain' ? 0xc4b276 : product === 'cement' ? 0xb9beb0 : 0xb2af99).fillEllipse(sx + 18, sy + 15, 39, 30);
      g.fillStyle(0xe2d6b5, .35).fillEllipse(sx + 13, sy + 10, 24, 18);
      for (let p = 0; p < 8; p++) {
        g.fillStyle(0x756f57, .24).fillCircle(sx + 5 + artHash(i, p, 2) * 25, sy + 6 + artHash(i, p, 3) * 20, 1.5);
      }
    } else {
      g.fillStyle(product === 'food' ? 0xb49565 : 0xbab397).fillRect(sx, sy, 33, 26);
      g.lineStyle(2, 0x80795b, .6).strokeRect(sx, sy, 33, 26).lineBetween(sx + 16, sy, sx + 16, sy + 26);
    }
  }
}

/** Changes only when visible stock groups or the building's role change. */
export function facilityArtKey(dto: FacilityInspectionDto): string {
  return [dto.name, dto.activeRecipe?.id, dto.boundaryTrade?.kind, ...dto.produces,
    ...dto.inventories.map(s => `${s.productId}:${Math.ceil(s.quantity / Math.max(1, s.capacity) * 6)}`)].join('|');
}

/** World-sized roofs and yard contents; neither drawing nor camera zoom mutates industry state. */
export function drawFacilityArt(ground: G, buildings: G, dto: FacilityInspectionDto, x: number, y: number): void {
  ground.clear(); buildings.clear();
  const mill = /mill|timber/i.test(dto.name) || dto.produces.includes('structural-timber');
  const port = dto.boundaryTrade?.kind === 'import-source';
  const minerals = dto.produces.includes('cement') || dto.produces.includes('limestone');
  const farm = dto.produces.includes('grain');
  // The works is north of its loading point, leaving the railway approach open.
  ground.fillStyle(OVERHEAD.meadow, .45).fillRoundedRect(x - 292, y - 392, 586, 376, 27);
  ground.fillStyle(OVERHEAD.yardShade, .55).fillRoundedRect(x - 276, y - 372, 552, 347, 14);
  ground.fillStyle(OVERHEAD.yard).fillRoundedRect(x - 267, y - 363, 534, 329, 9);
  ground.lineStyle(3, 0x898a73, .6);
  for (let j = 0; j < 19; j++) {
    const sx = x - 245 + artHash(j, 1, 3) * 483, sy = y - 345 + artHash(j, 2, 3) * 290;
    ground.lineBetween(sx, sy, sx + 11, sy - 2);
  }
  ground.lineStyle(4, 0x6e7965, .8).lineBetween(x - 282, y - 378, x + 282, y - 378)
    .lineBetween(x - 282, y - 378, x - 282, y - 30).lineBetween(x + 282, y - 378, x + 282, y - 30);
  for (let sx = x - 278; sx <= x + 278; sx += 42) {ground.fillStyle(0xc9c1a5).fillRect(sx - 2, y - 382, 4, 9);}
  ground.fillStyle(0xddd0a8).fillRect(x - 122, y - 61, 244, 24);
  ground.lineStyle(3, 0xede3bc, .8).lineBetween(x - 122, y - 39, x + 122, y - 39);
  ground.lineStyle(2, 0xf3e2a3, .75);
  for (let sx = x - 107; sx < x + 122; sx += 34) ground.lineBetween(sx, y - 93, sx, y - 65);
  roof(buildings, x - 164, y - 318, 328, 142, mill || farm);
  roof(buildings, x - 255, y - 145, 73, 78, true);
  if (minerals || farm) {tank(buildings, x + 218, y - 312, 30);tank(buildings, x + 218, y - 236, 30);}
  else if (port) {
    for (let i = 0; i < 3; i++) {
      buildings.fillStyle([0x486d68, 0x9c755b, 0xc2ae76][i]).fillRect(x + 183, y - 330 + i * 70, 59, 50);
      buildings.lineStyle(2, 0xe0d4ba, .35);
      for (let line = 5; line < 55; line += 8) buildings.lineBetween(x + 183 + line, y - 327 + i * 70, x + 183 + line, y - 284 + i * 70);
    }
  } else {
    roof(buildings, x + 185, y - 335, 62, 113);
    buildings.fillStyle(0xc5c8b8).fillRect(x + 197, y - 196, 37, 20);
    buildings.lineStyle(3, 0x6e8983).lineBetween(x + 201, y - 189, x + 230, y - 189);
  }
  const visible = dto.inventories.filter(s => s.quantity > 0);
  // Empty bays remain legible even when all supplies have been loaded away.
  for (let i = 0; i < 3; i++) {
    const slot = visible[i];
    stock(buildings, slot?.productId ?? '', slot?.quantity ?? 0, slot?.capacity ?? 1, x - 160 + i * 139, y - 142);
  }
  if (mill) {
    buildings.fillStyle(0x718575).fillRect(x - 253, y - 325, 61, 102);
    buildings.fillStyle(0x8fa08a).fillRect(x - 247, y - 319, 49, 90);
    buildings.lineStyle(3, 0xcbd0b5, .7).lineBetween(x - 239, y - 304, x - 239, y - 241);
  }
  // A small parked yard vehicle provides scale without a standing facade.
  buildings.fillStyle(OVERHEAD.shadow, .15).fillRoundedRect(x - 259, y - 195, 27, 47, 4);
  buildings.fillStyle(0x66837b).fillRoundedRect(x - 264, y - 201, 23, 42, 3);
  buildings.fillStyle(0xa7bcac).fillRect(x - 261, y - 195, 17, 10);
}
