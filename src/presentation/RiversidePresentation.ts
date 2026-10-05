import Phaser from 'phaser';
import { riverCentre } from '../region/RiversideRegion';
import { artHash, OVERHEAD } from './OverheadPalette';

type Point = [number, number];

/** Authored illustration only: roads and parcels leave the railway and its relief corridor clear. */
export function drawRiversideVillage(scene: Phaser.Scene): void {
  const ground = scene.add.graphics().setDepth(-25);
  const buildings = scene.add.graphics().setDepth(5);
  const path = (points: Point[], width: number, colour: number, alpha = 1, closed = false) => {
    ground.lineStyle(width, colour, alpha).beginPath();
    points.forEach(([x, y], i) => i ? ground.lineTo(x, y) : ground.moveTo(x, y));
    if (closed) ground.closePath();
    ground.strokePath();
  };
  const polygon = (points: Point[], colour: number, alpha = 1) => {
    ground.fillStyle(colour, alpha).beginPath();
    points.forEach(([x, y], i) => i ? ground.lineTo(x, y) : ground.moveTo(x, y));
    ground.closePath().fillPath();
  };
  const shrub = (x: number, y: number, radius: number, pale = false) => {
    ground.fillStyle(OVERHEAD.shadow, .15).fillEllipse(x + 8, y + 10, radius * 2, radius * 1.8);
    ground.fillStyle(pale ? 0x829b61 : 0x55784c).fillEllipse(x, y, radius * 2, radius * 1.8);
    ground.fillStyle(pale ? 0xa8b87d : 0x8da56a, .45).fillEllipse(x - radius * .22, y - radius * .25, radius * 1.2, radius);
  };
  const hedge = (points: Point[], width = 13, gates: number[] = []) => {
    path(points.map(([x, y]) => [x + 5, y + 7]), width + 4, OVERHEAD.shadow, .1, true);
    points.forEach((a, index) => {
      const b = points[(index + 1) % points.length];
      if (gates.includes(index)) return;
      const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
      path([a, b], width, 0x526f47, .8);
      for (let d = 8; d < distance - 6; d += 28) {
        const t = d / distance, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        ground.fillStyle(d % 56 < 28 ? 0x7e945d : 0x6c8653, .9).fillEllipse(x - 1, y - 2, width + 6, width + 3);
      }
    });
  };

  // Irregular headlands follow the groves and lanes instead of tiling the countryside.
  const fields: Array<{ points: Point[]; colour: number; rows: 'horizontal' | 'vertical' }> = [
    { points: [[1490, 974], [1835, 866], [2045, 986], [2184, 1290], [2078, 1370], [1546, 1327]], colour: 0xbab07b, rows: 'horizontal' },
    { points: [[2260, 1212], [2690, 1188], [3105, 1090], [3112, 1388], [2765, 1407], [2310, 1381]], colour: 0xc4b984, rows: 'horizontal' },
    { points: [[3240, 846], [3680, 824], [3804, 935], [3760, 1375], [3225, 1408], [3197, 1160]], colour: 0x98aa78, rows: 'vertical' },
    { points: [[1404, 3165], [1849, 3118], [2010, 3217], [1975, 3640], [1519, 3634], [1360, 3490]], colour: 0xbdb782, rows: 'vertical' },
    { points: [[4330, 3232], [4640, 3150], [5000, 3201], [4994, 3653], [4490, 3700], [4274, 3531]], colour: 0xa5b47d, rows: 'horizontal' },
    { points: [[5118, 3167], [5550, 3111], [5785, 3220], [5760, 3690], [5410, 3760], [5104, 3593]], colour: 0xc8bc81, rows: 'vertical' },
  ];
  fields.forEach((field, index) => {
    polygon(field.points, field.colour);
    path(field.points, 20, 0xe0cc93, .17, true);
    // Clip furrows to the polygon rather than drawing through its angled edges.
    const across = field.rows === 'horizontal' ? 1 : 0, along = 1 - across;
    const min = Math.min(...field.points.map(p => p[across])), max = Math.max(...field.points.map(p => p[across]));
    for (let row = min + 18; row < max - 16; row += index % 2 ? 19 : 16) {
      const crossings: number[] = [];
      field.points.forEach((a, i) => {
        const b = field.points[(i + 1) % field.points.length];
        if ((a[across] <= row && b[across] > row) || (b[across] <= row && a[across] > row)) {
          const t = (row - a[across]) / (b[across] - a[across]);
          crossings.push(a[along] + (b[along] - a[along]) * t);
        }
      });
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const a: Point = field.rows === 'horizontal' ? [crossings[i] + 14, row] : [row, crossings[i] + 14];
        const b: Point = field.rows === 'horizontal' ? [crossings[i + 1] - 14, row] : [row, crossings[i + 1] - 14];
        if (crossings[i + 1] - crossings[i] > 30) path([a, b], 2.5, index % 2 ? 0x79875c : 0xe3d09a, .36);
      }
    }
    hedge(field.points, 12, [index % field.points.length]);
    const gate = field.points[index % field.points.length];
    ground.fillStyle(0x5c6f50).fillRect(gate[0] - 3, gate[1] - 4, 7, 13);
  });

  const lane = (points: Point[], width = 23) => {
    path(points, width + 12, 0x617b50, .2);
    path(points, width, 0xc8bda1);
    path(points, 2, 0xa3997d, .3);
  };
  lane([[1780, 1460], [1484, 1390], [1392, 1240], [1410, 911], [1660, 775], [1848, 702]], 25);
  lane([[3180, 1465], [3162, 1200], [3171, 932], [3253, 780]], 19);
  lane([[1310, 3810], [1280, 3500], [1360, 3120], [1840, 3105], [2105, 3160]], 20);
  lane([[4140, 3810], [4210, 3130], [4550, 3057], [5016, 3090], [5055, 3740]], 24);
  lane([[5016, 3090], [5470, 3016], [5825, 3130], [5857, 3720]], 19);

  const road = (points: Point[], major = false) => {
    path(points, 69, 0x66795b, .18);
    path(points, 56, 0xd5cbb5);
    path(points, 34, 0x8a948c);
    path(points, 29, 0x939c93);
    if (major) {
      points.slice(0, -1).forEach((a, i) => {
        const b = points[i + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 15; d < length - 20; d += 63) {
          const point = (n: number): Point => [a[0] + (b[0] - a[0]) * n / length, a[1] + (b[1] - a[1]) * n / length];
          path([point(d), point(d + 25)], 2, 0xddd9bb, .65);
        }
      });
    }
  };
  road([[100, 1400], [1100, 1390], [1600, 1470], [3500, 1470], [4020, 1390], [5700, 1390], [6400, 1460]], true);
  road([[4180, 400], [4180, 1390]]); road([[4890, 450], [4890, 1390], [5070, 1610]]);
  road([[5550, 700], [5550, 1390]]); road([[4030, 810], [5600, 810]]); road([[4030, 1110], [5550, 1110]]);
  lane([[1050, 1390], [1050, 1870], [910, 1990]], 34);
  lane([[5400, 1390], [6000, 1770], [6000, 2270], [5340, 2270]], 28);
  lane([[4700, 1570], [4780, 1690]], 34);
  // Zebra crossings, corner paving and drains give the small street network scale.
  for (const y of [810, 1110, 1390]) for (const x of [4180, 4890, 5550]) {
    ground.fillStyle(0xd8ceb4).fillCircle(x, y, 31);
    ground.fillStyle(0x949c92).fillCircle(x, y, 22);
    for (let j = 0; j < 5; j++) ground.fillStyle(0xe8dfc3, .8).fillRect(x - 14, y - 51 + j * 6, 28, 3);
    ground.fillStyle(0x5e7561).fillRect(x + 24, y + 24, 7, 9);
  }

  const roof = (x: number, y: number, w: number, h: number, colour: number, index: number) => {
    buildings.fillStyle(OVERHEAD.shadow, .08).fillRoundedRect(x + 6, y + 8, w + 10, h + 10, 4);
    buildings.fillStyle(OVERHEAD.shadow, .14).fillRoundedRect(x + 8, y + 10, w + 3, h + 3, 3);
    buildings.fillStyle(0xcbbd9b).fillRect(x - 3, y - 3, w + 6, h + 6);
    buildings.fillStyle(colour).fillRect(x, y, w, h);
    buildings.fillStyle(0xf7e4bc, .13).fillRect(x, y, w, h * .48);
    buildings.fillStyle(0x263e35, .15).fillRect(x, y + h * .52, w, h * .48);
    buildings.lineStyle(1.5, 0xe9d9b6, .23);
    for (let row = 8; row < h; row += 8) buildings.lineBetween(x + 2, y + row, x + w - 2, y + row);
    buildings.lineStyle(3, 0xd6c5a4, .85).lineBetween(x - 2, y + h / 2, x + w + 2, y + h / 2);
    buildings.lineStyle(2, 0x4f5e4b, .5).strokeRect(x, y, w, h);
    buildings.fillStyle(OVERHEAD.shadow, .22).fillRect(x + w * .68 + 6, y + h * .3 + 8, 12, 15);
    buildings.fillStyle(0xbca68a).fillRect(x + w * .68, y + h * .3, 12, 15);
    buildings.fillStyle(0x435950).fillRect(x + w * .68 + 3, y + h * .3 + 3, 6, 8);
    if (index % 3 === 0) {
      buildings.fillStyle(0x9bb9b1).fillRect(x + 17, y + 11, 17, 11);
      buildings.lineStyle(2, 0xd6d6bc).strokeRect(x + 17, y + 11, 17, 11);
    }
  };
  const home = (x: number, y: number, width: number, height: number, colour: number, index: number, streetY: number) => {
    const left = x - 12, right = x + width + 40, back = y - 62, front = streetY - 34;
    polygon([[left, back + 7], [right - 9, back], [right, front], [left + 4, front]], index % 2 ? 0x91a877 : 0xa5b789);
    hedge([[left, back], [right, back], [right, front], [left, front]], 5, [2]);
    lane([[x + width * .47, y + height], [x + width * .47, streetY - 20]], 10);
    if (index % 4 !== 0) {
      const gx = x + width + 12;
      ground.fillStyle(0xccbea0).fillRect(gx - 3, y + height - 20, 37, streetY - y - height - 14);
      roof(gx, y + height - 27, 29, 42, 0x738371, index + 1);
    }
    for (let j = 0; j < 3; j++) {
      ground.fillStyle(index % 3 ? 0x74895a : 0x8c8860).fillRect(x + 7 + j * 17, back + 18, 10, 23);
      ground.lineStyle(1, 0xadc18d, .6).lineBetween(x + 12 + j * 17, back + 19, x + 12 + j * 17, back + 38);
    }
    shrub(x + width - 8, back + 23, 13, index % 2 === 0);
    ground.fillStyle(0xdbc6a1).fillRect(x + 8, y + height + 8, 24, 13);
    ground.fillStyle(0x958260).fillRect(x + 10, y + height + 10, 20, 9);
    roof(x, y, width, height, colour, index);
    buildings.fillStyle(0xd4c4a3).fillRect(x + width * .42, y + height - 2, 22, 11);
    buildings.fillStyle(0x6a8171).fillRect(x + width * .42 + 3, y + height, 16, 6);
  };
  let i = 0;
  const colours = [0x956e57, 0x6a817b, 0xaa7c61, 0x7e8a78, 0x94775d];
  for (const [y, start, end, streetY] of [[590, 4290, 5450, 810], [900, 4270, 5440, 1110], [1190, 4270, 5440, 1390]]) {
    for (let x = start; x < end; x += 167) {
      if (Math.abs(x - 4890) < 100) continue;
      home(x, y + i % 3 * 4, 94 + i % 3 * 9, 69 + i % 2 * 10, colours[i % colours.length], i++, streetY);
    }
  }

  // A churchyard, village green and connected shop forecourt break up the regular blocks.
  polygon([[4390, 316], [4625, 280], [4704, 398], [4668, 568], [4412, 558]], 0x96ac7b);
  hedge([[4390, 316], [4625, 280], [4704, 398], [4668, 568], [4412, 558]], 8, [3]);
  lane([[4180, 542], [4407, 542], [4508, 506]], 18);
  roof(4480, 375, 190, 85, 0x637574, i++); roof(4540, 324, 70, 190, 0x637574, i++);
  roof(4480, 382, 55, 70, 0x526b63, i++);
  buildings.fillStyle(0xabb69c).fillRect(4492, 394, 31, 31);
  buildings.fillStyle(0x48685e).fillCircle(4507, 409, 8);
  for (let j = 0; j < 6; j++) {
    ground.fillStyle(0xc3c9ae).fillRect(4635 + j % 2 * 23, 487 + Math.floor(j / 2) * 24, 9, 16);
  }
  polygon([[4968, 370], [5234, 341], [5332, 394], [5306, 529], [4991, 552], [4954, 471]], 0x91ab78);
  hedge([[4968, 370], [5234, 341], [5332, 394], [5306, 529], [4991, 552], [4954, 471]], 7, [5]);
  lane([[4890, 451], [4990, 451], [5130, 491], [5312, 451]], 13);
  ground.fillStyle(0xdad1b5).fillCircle(5130, 491, 25);
  ground.fillStyle(0x6e8980).fillCircle(5130, 491, 15);
  ground.fillStyle(0x93b5af).fillCircle(5126, 487, 10);
  for (const [x, y] of [[5002, 396], [5212, 382], [5277, 500]]) shrub(x, y, 18, true);
  for (const [x, y] of [[5020, 501], [5220, 442]]) {
    ground.fillStyle(0x816f4e).fillRect(x, y, 29, 7);
    ground.fillStyle(0xd5c29b).fillRect(x + 3, y + 1, 23, 3);
  }
  ground.fillStyle(0xd5c9ad).fillRect(4265, 1415, 545, 116);
  for (let j = 0; j < 4; j++) {
    roof(4290 + j * 124, 1445, 102, 75, colours[j], i++);
    buildings.fillStyle(j % 2 ? 0xe0d1a4 : 0x396e63).fillRect(4290 + j * 124, 1436, 102, 14);
    buildings.lineStyle(2, 0xf0dec0, .55).lineBetween(4290 + j * 124, 1440, 4392 + j * 124, 1440);
    ground.fillStyle(0x75815e).fillRect(4298 + j * 124, 1423, 24, 8);
  }

  // Farm courts link buildings, field gates and lanes rather than floating in the grass.
  polygon([[1728, 536], [1987, 561], [2117, 677], [1986, 744], [1745, 711]], 0xbfb494);
  lane([[1848, 702], [1848, 653], [2010, 678]], 21);
  roof(1770, 565, 175, 90, 0x9b7961, i++); roof(1980, 620, 100, 70, 0x6b817d, i++);
  roof(1755, 682, 83, 38, 0x718270, i++);
  for (let j = 0; j < 4; j++) {
    ground.fillStyle(0xbda26c).fillCircle(2070 + j % 2 * 20, 572 + Math.floor(j / 2) * 22, 8);
    ground.lineStyle(2, 0xd7c490).strokeCircle(2070 + j % 2 * 20, 572 + Math.floor(j / 2) * 22, 5);
  }
  hedge([[5604, 888], [5900, 876], [5900, 1205], [5610, 1210]], 8, [0]);
  lane([[5550, 860], [5650, 860], [5650, 891]], 15);
  for (let j = 0; j < 10; j++) {
    const x = 5630 + j % 5 * 49, y = 916 + Math.floor(j / 5) * 140;
    ground.fillStyle(0xb39e77).fillRect(x - 3, y - 3, 38, 118);
    ground.fillStyle(j % 2 ? 0x678456 : 0x8e8c5e).fillRect(x, y, 32, 110);
    for (let row = y + 9; row < y + 110; row += 15) path([[x + 2, row], [x + 30, row]], 2, 0xc0c394, .55);
    if (j % 3 === 0) roof(x + 4, y + 88, 19, 24, 0x7f8a6c, i++);
  }
  for (let j = 0; j < 7; j++) {
    buildings.fillStyle(OVERHEAD.shadow, .16).fillRoundedRect(4966 + j * 44, 1582, 24, 45, 4);
    buildings.fillStyle(j % 3 === 0 ? 0xb9886a : 0x657e7f).fillRoundedRect(4960 + j * 44, 1574, 22, 43, 4);
    buildings.fillStyle(0xc5d0bb).fillRect(4963 + j * 44, 1582, 16, 11);
  }

  // The river remains the actual terrain water. All glints sit safely inside it;
  // reeds and the towpath follow its bank without painting over the railway.
  const towpath: Point[] = [];
  for (let x = 150; x <= 6250; x += 110) {
    const clearance = x > 5400 && x < 5900 ? 226 : 262;
    towpath.push([x, riverCentre(x) - clearance - Math.sin(x / 240) * 5]);
  }
  path(towpath, 22, 0x81946b, .35); path(towpath, 12, 0xc5b893, .85);
  for (let x = 230; x < 6200; x += 172) {
    for (const side of [-1, 1]) {
      if (side === -1 && x > 5300 && x < 5950) continue;
      const ry = riverCentre(x) + side * (219 + artHash(x, side, 21) * 17);
      ground.fillStyle(0x698363, .45).fillEllipse(x, ry, 42, 17);
      for (let reed = 0; reed < 6; reed++) {
        const rx = x - 15 + reed * 6, y = ry + artHash(x, reed, 22) * 9;
        path([[rx - 3, y + 2], [rx, y - 9], [rx + 4, y - 5]], 1.5, reed % 2 ? 0xa8b387 : 0x597f65, .7);
      }
    }
    const y = riverCentre(x) - 50 + artHash(x, 0, 31) * 100;
    path([[x - 23, y + 1], [x + 11, y - 2]], 2.5, 0x9ac5bd, .32);
    path([[x + 16, y + 10], [x + 31, y + 9]], 1.8, 0xa4ccc0, .24);
  }
  lane([[6000, 2270], [6050, riverCentre(6050) - 264]], 14);
  ground.fillStyle(0xbaab8c).fillRect(4510, riverCentre(4510) - 239, 60, 16);
  ground.fillStyle(0x756b55).fillRect(4528, riverCentre(4510) - 237, 31, 6);
  // No animation, timers or listeners: static illustration also respects reduced motion.
  const label = (x: number, y: number, text: string, size: number) => scene.add.text(x, y, text,
    { fontFamily: 'Georgia,serif', fontSize: size, color: '#2f5148', stroke: '#e0dabe', strokeThickness: 1 })
    .setOrigin(.5).setDepth(8).setAlpha(.85);
  label(4820, 270, 'B R O O K F O R D', 51);
  label(2580, 3040, 'R i v e r   A l d e r', 36);
}
