import type Phaser from 'phaser';
import type { RegionalFootprint } from '../region/RegionalProjects';

/** A compact nine-home parcel with lanes and garden boundaries matching the existing town. */
export function drawNeighbourhood(g: Phaser.GameObjects.Graphics, f: RegionalFootprint): void {
  const scale = f.radius / 160;
  const point = (x: number, y: number): [number, number] => [f.x + x * scale, f.y + y * scale];
  const bounded = (x: number, y: number): [number, number] => {
    const distance = Math.hypot(x, y), ratio = distance > 158 ? 158 / distance : 1;
    return point(x * ratio, y * ratio);
  };
  const polygon = (points: number[][], colour: number, alpha = 1) => {
    g.fillStyle(colour, alpha).beginPath();
    points.forEach(([x, y], i) => { const p = bounded(x, y); if (i) g.lineTo(...p); else g.moveTo(...p); });
    g.closePath().fillPath();
  };
  const rect = (x: number, y: number, width: number, height: number, colour: number, alpha = 1) =>
    g.fillStyle(colour, alpha).fillRect(f.x + x * scale, f.y + y * scale, width * scale, height * scale);
  const line = (x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha = 1) =>
    g.lineStyle(width * scale, colour, alpha).lineBetween(...point(x1, y1), ...point(x2, y2));
  const garden = (x: number, y: number, width: number, height: number, index: number) => {
    polygon([[x, y], [x + width, y], [x + width, y + height], [x, y + height]], index % 2 ? 0x91a877 : 0xa6b68a);
    for (let row = 0; row < 2; row++) {
      polygon([[x + 5, y + 4 + row * 7], [x + width - 5, y + 4 + row * 7],
        [x + width - 5, y + 8 + row * 7], [x + 5, y + 8 + row * 7]], row ? 0x8f9365 : 0x728a58, .8);
    }
  };

  g.fillStyle(0xa5b88b).fillRoundedRect(f.x-f.radius,f.y-f.radius,f.radius*2,f.radius*2,12*scale);
  // The west entrance meets the authored access lane at y0. Its spine runs
  // beside the roofs, then branches into the two clear gaps between rows.
  polygon([[-160, 0], [-150, -6], [-139, -6], [-139, 6], [-150, 6]], 0xd5c6a7);
  rect(-149, -43, 10, 86, 0xd5c6a7);
  for (const y of [-37, 37]) {
    rect(-145, y - 6, 290, 12, 0xb7aa8c);
    rect(-145, y - 4, 290, 8, 0xd8cbb0);
    line(-143, y - 4, 143, y - 4, 1.2, 0xeadfbe, .6);
  }
  rect(139, -43, 10, 86, 0xd5c6a7);
  // Soft hedge punctuation, with the western gate left open.
  for (let i = 0; i < 44; i++) {
    const side=Math.floor(i/11),along=-146+(i%11)*29.2;
    const x=side===0||side===2?along:side===1?153:-153;
    const y=side===1||side===3?along:side===0?-153:153;
    if (x < 0 && Math.abs(y) < 17) continue;
    g.fillStyle(0x617b4e, .8).fillEllipse(...point(x, y), 9 * scale, 7 * scale);
    g.fillStyle(0x8ca56b, .6).fillEllipse(...point(x - 1, y - 1), 5 * scale, 4 * scale);
  }

  const colours = [0x956e57, 0x6a817b, 0xaa7c61, 0x7e8a78, 0x94775d];
  for (let i = 0; i < Math.min(9, f.buildingCount); i++) {
    const row = Math.floor(i / 3), column = i % 3;
    const cx = (column - 1) * (row === 1 ? 91 : 84), cy = (row - 1) * 74;
    const width = row !== 1 && column !== 1 ? 76 : 84, height = 54;
    const x = cx - width / 2, y = cy - height / 2;
    if (row === 0) garden(cx - 24, -131, 48, 24, i);
    if (row === 2) garden(cx - 24, 107, 48, 24, i);
    // Roof shadows are clipped to the parcel only at the outer corners.
    polygon([[x + 5, y + 7], [x + width + 13, y + 7], [x + width + 13, y + height + 17], [x + 5, y + height + 17]], 0x243c34, .07);
    polygon([[x + 8, y + 10], [x + width + 8, y + 10], [x + width + 8, y + height + 10], [x + 8, y + height + 10]], 0x243c34, .15);
    polygon([[x - 2, y - 2], [x + width + 2, y - 2], [x + width + 2, y + height + 2], [x - 2, y + height + 2]], 0xcbbd9b);
    rect(x, y, width, height, colours[i % colours.length]);
    rect(x, y, width, height * .48, 0xf7e4bc, .13);
    rect(x, y + height * .52, width, height * .48, 0x263e35, .15);
    for (let tile = 8; tile < height; tile += 8) line(x + 2, y + tile, x + width - 2, y + tile, 1.3, 0xe9d9b6, .25);
    line(x - 1, cy, x + width + 1, cy, 3, 0xd6c5a4, .85);
    // Masonry chimney tops and occasional rooflights match the established town.
    rect(x + width * .68 + 5, y + 18, 11, 13, 0x243c34, .2);
    rect(x + width * .68, y + 12, 11, 13, 0xbca68a);
    rect(x + width * .68 + 3, y + 15, 5, 7, 0x435950);
    if (i % 3 === 1) {
      rect(x + 13, y + 8, 16, 9, 0xcbd2bb);
      rect(x + 15, y + 10, 12, 5, 0x93b5ad);
    }
    const front = row === 2 ? y : y + height, laneY = row === 0 ? -37 : 37;
    // Paths end at a lane rather than continuing beneath the neighbouring roof.
    line(cx, front, cx, laneY, 6, 0xd8c8a6);
    rect(cx - 9, front - (row === 2 ? 0 : 6), 18, 6, 0xd1c09c);
    rect(cx - 6, front - (row === 2 ? -1 : 5), 12, 4, 0x6a8171);
  }
  for (const [x, y] of [[-131, -64], [131, -64], [-131, 64], [131, 64]]) {
    g.fillStyle(0x243c34, .12).fillEllipse(...point(x + 5, y + 6), 14 * scale, 12 * scale);
    g.fillStyle(0x6e8955).fillEllipse(...point(x, y), 14 * scale, 12 * scale);
    g.fillStyle(0x99ac73, .5).fillEllipse(...point(x - 2, y - 2), 8 * scale, 6 * scale);
  }
}
