import type Phaser from 'phaser';
import type { FleetPartVisual } from '../management/FleetPresentation';

/** Shared overhead light: the artwork moves and rotates, the sun does not. */
export const FLEET_SHADOW_OFFSET = { x: 8, y: 10 } as const;

const ART = {
  ink: 0x263b3d,
  underframe: 0x354648,
  steel: 0x7f8e89,
  paleSteel: 0xbec6bc,
  roof: 0xd6d8c8,
  roofLight: 0xe9e8d9,
  window: 0x193b48,
  glassLight: 0x88afb6,
  cream: 0xe9debf,
  warning: 0xe8bd56,
  shadow: 0x25382a,
  platform: 0xb9b19b,
  slate: 0x4b5b5c,
  slateLight: 0x6b7774,
} as const;

function mixColour(base: number, other: number, amount: number): number {
  const channel = (shift: number) => Math.round(((base >> shift) & 255) * (1 - amount) + ((other >> shift) & 255) * amount);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Layered edges soften the contact shadow without a per-frame texture or filter. */
export function drawFleetShadow(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
  g.clear();
  for (const [spread, alpha] of [[6, 0.025], [3, 0.055], [0, 0.12]]) {
    g.fillStyle(ART.shadow, alpha).fillRoundedRect(-part.length / 2 - spread, -part.width / 2 - spread, part.length + spread * 2, part.width + spread * 2, 8 + spread);
  }
}

export function drawFleetBogie(g: Phaser.GameObjects.Graphics, width: number, axles: number): void {
  g.clear();
  const half = axles === 3 ? 14 : 10;
  g.fillStyle(ART.ink).fillRoundedRect(-half, -width / 2 - 2, half * 2, width + 4, 3);
  g.fillStyle(0x536260).fillRoundedRect(-half + 3, -width * 0.31, half * 2 - 6, width * 0.62, 2);
  for (const x of axles === 3 ? [-10, 0, 10] : [-6, 6]) {
    g.fillStyle(0x182d31).fillRoundedRect(x - 2, -width / 2 - 3, 4, 7, 1).fillRoundedRect(x - 2, width / 2 - 4, 4, 7, 1);
    g.fillStyle(ART.steel).fillRect(x - 1, -width / 2 - 2, 2, 3).fillRect(x - 1, width / 2, 2, 3);
    g.lineStyle(1, 0x8d9790, 0.75).lineBetween(x, -width * 0.25, x, width * 0.25);
  }
}

function drawFrame(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
  const left = -part.length / 2, half = part.width / 2;
  g.fillStyle(ART.ink).fillRoundedRect(left - 1, -half + 1, part.length + 2, part.width, part.passenger ? 8 : 4);
  for (const end of [-1, 1]) {
    g.fillStyle(ART.underframe).fillRoundedRect(end * part.length / 2 - 3, -3, 7, 6, 1);
    for (const side of [-1, 1]) g.fillStyle(ART.steel).fillRoundedRect(end * (part.length / 2 - 1) - 2, side * (half - 5) - 2, 4, 4, 1);
  }
}

function drawShell(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
  const left = -part.length / 2, half = part.width / 2, radius = part.passenger ? 8 : 5;
  g.fillStyle(mixColour(part.colour, ART.ink, 0.25)).fillRoundedRect(left, -half, part.length, part.width, radius);
  g.fillStyle(part.colour).fillRoundedRect(left + 1, -half + 1, part.length - 2, part.width - 4, radius - 1);
  g.lineStyle(1, mixColour(part.colour, ART.cream, 0.55), 0.9).lineBetween(left + 9, -half + 2, -left - 9, -half + 2);
  for (const side of [-1, 1]) {
    g.fillStyle(ART.cream, 0.85).fillRect(left + 13, side * (half - 4) - 0.7, part.length - 26, 1.4);
    g.fillStyle(mixColour(part.colour, ART.ink, 0.5)).fillRect(left + 15, side * (half - 1) - 0.7, part.length - 30, 1.4);
  }
}

function drawFan(g: Phaser.GameObjects.Graphics, x: number, y: number, radius: number): void {
  g.fillStyle(0x9da99f).fillCircle(x, y, radius + 1.5);
  g.fillStyle(0x344c50).fillCircle(x, y, radius);
  g.lineStyle(0.8, 0x849c99, 0.85).strokeCircle(x, y, radius - 1.5);
  for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) {
    const dx = Math.cos(angle) * (radius - 2), dy = Math.sin(angle) * (radius - 2);
    g.lineStyle(1.1, 0x728f8b).lineBetween(x - dx, y - dy, x + dx, y + dy);
  }
  g.fillStyle(0xb5c1b7).fillCircle(x, y, 1.5);
}

function drawGrille(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number): void {
  g.fillStyle(0x788b84).fillRoundedRect(x, y, width, height, 1.5);
  g.lineStyle(0.9, 0x3c5557, 0.9);
  for (let line = x + 3; line < x + width - 1; line += 3) g.lineBetween(line, y + 1.5, line, y + height - 1.5);
  g.lineStyle(0.7, 0xd8dccb, 0.7).lineBetween(x + 1, y + 1, x + width - 1, y + 1);
}

function drawCab(g: Phaser.GameObjects.Graphics, part: FleetPartVisual, end: -1 | 1, passenger: boolean): void {
  const nose = end * (part.length / 2 - 11), glass = end * (part.length / 2 - 22);
  g.fillStyle(ART.warning).fillRoundedRect(nose - 9, -part.width / 2 + 2, 18, part.width - 4, passenger ? 7 : 4);
  g.fillStyle(0xf3d378).fillRoundedRect(nose - 7, -part.width / 2 + 3, 13, part.width * 0.36, 3);
  g.fillStyle(ART.ink).fillRoundedRect(glass - 4, -10.5, 8, 21, 2.5);
  g.fillStyle(ART.window).fillRoundedRect(glass - 3, -9, 6, 18, 2);
  g.lineStyle(1, ART.glassLight, 0.85).lineBetween(glass - 1, -8, glass - 1, 6);
  g.lineStyle(0.8, 0xb6c7bf, 0.7).lineBetween(glass - 3, 0, glass + 3, 0);
  for (const side of [-1, 1]) {
    g.fillStyle(ART.window).fillRoundedRect(glass - 7, side * (part.width / 2 - 3) - 1.5, 9, 3, 1);
    const lampX = end * (part.length / 2 - 3);
    g.fillStyle(ART.ink).fillCircle(lampX, side * 8, 2.1);
    g.fillStyle(end === 1 ? 0xfff0bc : 0xc46152).fillCircle(lampX, side * 8, 1.3);
  }
}

function drawDiesel(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
  const left = -part.length / 2, roofLength = part.length - 58;
  g.fillStyle(0x546a65).fillRoundedRect(left + 28, -11.5, roofLength + 2, 23, 4);
  g.fillStyle(ART.roof).fillRoundedRect(left + 29, -10.5, roofLength, 20, 3);
  g.fillStyle(ART.roofLight).fillRoundedRect(left + 31, -9.5, roofLength - 4, 7, 2);
  g.lineStyle(1, 0x9eaca1).lineBetween(left + 32, 8.5, -left - 31, 8.5);
  drawCab(g, part, 1, false); drawCab(g, part, -1, false);
  const fans = part.silhouette === 'heavy-six-axle' ? 3 : 2;
  for (let i = 0; i < fans; i++) drawFan(g, (i - (fans - 1) / 2) * 21 - part.length * 0.06, 0, 6.5);
  drawGrille(g, left + 35, -7, Math.min(24, part.length * 0.14), 14);
  g.fillStyle(0x9baa9f).fillRoundedRect(part.length * 0.18 - 8, -7, 16, 14, 2);
  g.lineStyle(0.8, 0x657b75).strokeRoundedRect(part.length * 0.18 - 7, -6, 14, 12, 1.5);
  g.fillStyle(ART.underframe).fillRoundedRect(part.length * 0.1, -2.5, 8, 5, 1);
  for (let x = left + 33; x < -left - 30; x += 12) {
    g.fillStyle(ART.ink, 0.8).fillRect(x, part.width / 2 - 4, 5, 2);
    g.fillStyle(mixColour(part.colour, ART.cream, 0.4)).fillRect(x, -part.width / 2 + 2, 5, 1.5);
  }
}

function drawPantograph(g: Phaser.GameObjects.Graphics, x: number, width: number): void {
  g.fillStyle(0xb2b9ac).fillRoundedRect(x - 11, -7, 22, 14, 2);
  g.lineStyle(1.5, 0x43595a).lineBetween(x - 9, 0, x, -width * 0.27).lineBetween(x, -width * 0.27, x + 9, 0).lineBetween(x + 9, 0, x, width * 0.27).lineBetween(x, width * 0.27, x - 9, 0);
  g.lineStyle(2, 0xbb805a).lineBetween(x - 6, -width * 0.33, x + 6, -width * 0.33);
}

function drawPassengerUnit(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
  const left = -part.length / 2, half = part.width / 2;
  g.fillStyle(0x738780).fillRoundedRect(left + 11, -11, part.length - 22, 22, 6);
  g.fillStyle(ART.roof).fillRoundedRect(left + 12, -10, part.length - 24, 19, 5);
  g.fillStyle(ART.roofLight).fillRoundedRect(left + 14, -9, part.length - 28, 7, 4);
  g.lineStyle(0.8, 0xaab5a9).lineBetween(left + 19, 7.5, -left - 19, 7.5);
  for (let x = left + 32; x < -left - 28; x += 18) {
    for (const side of [-1, 1]) {
      g.fillStyle(ART.ink).fillRoundedRect(x, side * (half - 2.3) - 1.8, 11, 3.6, 0.7);
      g.lineStyle(0.7, ART.glassLight, 0.85).lineBetween(x + 1.5, side * (half - 2.3) - 0.6, x + 8, side * (half - 2.3) - 0.6);
    }
  }
  for (const x of [-part.length * 0.3, part.length * 0.3]) {
    for (const side of [-1, 1]) {
      g.fillStyle(ART.cream).fillRect(x - 4, side * (half - 2.3) - 2.3, 8, 4.6);
      g.fillStyle(ART.window).fillRect(x - 1.8, side * (half - 2.3) - 1.4, 3.6, 2.8);
    }
  }
  for (const x of [-part.length * 0.2, part.length * 0.2]) {
    g.fillStyle(0x92a197).fillRoundedRect(x - 13, -7, 26, 14, 3);
    g.fillStyle(0xc4cdbf).fillRoundedRect(x - 12, -6, 24, 10, 2);
    drawGrille(g, x - 8, -4, 16, 8);
  }
  g.fillStyle(0x8b9c92).fillRoundedRect(-5, -4, 10, 8, 1);
  for (const end of [-1, 1] as const) {
    if (end === 1 ? part.cabAtFront : part.cabAtRear) drawCab(g, part, end, true);
    else {
      const x = end * (part.length / 2 - 4);
      g.fillStyle(ART.ink).fillRoundedRect(x - 3, -8, 6, 16, 1);
      g.lineStyle(0.7, ART.steel).lineBetween(x - 1, -7, x - 1, 7).lineBetween(x + 1, -7, x + 1, 7);
    }
  }
  if (part.silhouette === 'commuter-unit') drawPantograph(g, 0, part.width);
}

function drawShunter(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
  const left = -part.length / 2;
  g.fillStyle(ART.roof).fillRoundedRect(left + 9, -part.width / 2 + 2, part.length * 0.29, part.width - 4, 3);
  g.fillStyle(ART.roofLight).fillRect(left + 12, -part.width / 2 + 3, part.length * 0.24, 6);
  g.fillStyle(ART.window).fillRoundedRect(left + part.length * 0.32, -10, 5, 20, 1);
  g.fillStyle(mixColour(part.colour, ART.ink, 0.3)).fillRoundedRect(-part.length * 0.07, -9, part.length * 0.44, 18, 3);
  g.fillStyle(mixColour(part.colour, ART.cream, 0.25)).fillRoundedRect(-part.length * 0.06, -8, part.length * 0.42, 7, 2);
  drawFan(g, part.length * 0.13, 0, 5);
  g.fillStyle(ART.warning).fillRect(part.length / 2 - 9, -part.width / 2 + 2, 7, part.width - 4);
  g.lineStyle(2, ART.ink);
  for (const y of [-7, 0, 7]) g.lineBetween(part.length / 2 - 9, y - 3, part.length / 2 - 3, y + 3);
}

function drawFlatbedLoad(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
  if (part.loadFraction <= 0) return;
  const length = Math.max(8, (part.length - 34) * part.loadFraction), left = -length / 2;
  g.fillStyle(ART.ink, 0.3).fillRoundedRect(left + 1.5, -9, length, 22, 2);
  if (part.productId === 'building-modules') {
    const modules = Math.max(1, Math.floor(length / 48)), bay = length / modules;
    for (let i = 0; i < modules; i++) {
      const x = left + i * bay;
      g.fillStyle(0x8c8975).fillRoundedRect(x, -11, bay - 3, 23, 1);
      g.fillStyle(0xe4dfc7).fillRoundedRect(x + 1, -11, bay - 5, 20, 1);
      g.fillStyle(0xf0ebd4).fillRect(x + 2, -10, bay - 7, 5);
      g.lineStyle(0.8, 0xb1b8ac).lineBetween(x + 3, 3, x + bay - 6, 3);
      g.fillStyle(0x5b7f89).fillRect(x + 5, -5, Math.min(10, bay * 0.3), 4);
    }
  } else {
    const logs = part.productId === 'logs', steel = part.productId === 'steel';
    const dark = steel ? 0x5a747a : logs ? 0x725335 : 0xa38351;
    const light = steel ? 0xacbdb7 : logs ? 0xc5965e : 0xddbd85;
    for (const y of [-7, 0, 7]) {
      g.fillStyle(dark).fillRoundedRect(left, y - 3.1, length, 6.2, logs ? 3 : 0.7);
      g.fillStyle(light).fillRoundedRect(left + 1, y - 2.5, length - 2, 3.8, logs ? 2 : 0.3);
      g.lineStyle(0.7, steel ? 0xd8ddd0 : 0xe2c191, 0.8).lineBetween(left + 3, y - 1.5, -left - 3, y - 1.5);
      if (logs) {
        for (let x = left + 15; x < -left - 7; x += 37) {
          g.fillStyle(0x966b42).fillCircle(x, y, 1.1);
          g.lineStyle(0.6, 0x7d5836, 0.7).lineBetween(x + 3, y + 1, Math.min(-left - 3, x + 12), y + 1);
        }
      }
    }
  }
  for (const x of length > 42 ? [-length * 0.32, length * 0.32] : [0]) {
    g.lineStyle(3, 0x3c5148, 0.6).lineBetween(x + 1, -11, x + 1, 12);
    g.lineStyle(2, 0xc5b47d).lineBetween(x, -11, x, 11);
    g.fillStyle(0x718275).fillRoundedRect(x - 2, 5, 4, 3, 0.5);
  }
}

function drawWagon(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
  const left = -part.length / 2, half = part.width / 2;
  g.fillStyle(0x53685f).fillRoundedRect(left, -half, part.length, part.width, 2);
  g.fillStyle(0x747b65).fillRect(left + 7, -half + 4, part.length - 14, part.width - 8);
  for (let y = -half + 5; y < half - 4; y += 4) {
    g.fillStyle(y < 0 ? 0x8b8e73 : 0x797e66).fillRect(left + 8, y, part.length - 16, 2.5);
    g.lineStyle(0.6, 0x525f53, 0.6).lineBetween(left + 9, y + 3, -left - 9, y + 3);
  }
  for (const side of [-1, 1]) {
    g.fillStyle(ART.underframe).fillRect(left + 2, side * (half - 1) - 1, part.length - 4, 2);
    g.fillStyle(part.colour).fillRect(-part.length * 0.22, side * (half - 1) - 1, part.length * 0.44, 2);
    for (let x = left + 13; x < -left - 8; x += 31) {
      g.fillStyle(ART.ink).fillRect(x - 1.5, side * (half - 3) - 3, 3, 6);
      g.fillStyle(ART.paleSteel).fillRect(x - 0.7, side * (half - 3) - 2, 1.4, 4);
    }
  }
  if (part.wagonFamilyId === 'flatbed') drawFlatbedLoad(g, part);
  else if (part.wagonFamilyId === 'bulk-hopper') {
    g.fillStyle(ART.ink).fillRoundedRect(left + 9, -half + 5, part.length - 18, part.width - 10, 2);
    if (part.loadFraction > 0) {
      const colour = part.productId === 'grain' ? 0xcdb16c : part.productId === 'scrap' ? 0x83988c : 0xbab8a1;
      const loadLength = (part.length - 24) * part.loadFraction;
      g.fillStyle(colour).fillRoundedRect(-loadLength / 2, -half + 7, loadLength, part.width - 14, 2);
      for (let x = -loadLength / 2 + 5; x < loadLength / 2 - 3; x += 14) {
        g.fillStyle(mixColour(colour, ART.cream, 0.25)).fillCircle(x, -2, 2.5);
        g.fillStyle(mixColour(colour, ART.ink, 0.2)).fillCircle(x + 5, 3, 1.8);
      }
    }
    g.lineStyle(2, ART.steel).strokeRoundedRect(left + 8, -half + 4, part.length - 16, part.width - 8, 2);
  } else {
    g.fillStyle(0xa4b0a1).fillRoundedRect(left + 5, -half + 2, part.length - 10, part.width - 4, 4);
    g.fillStyle(ART.roof).fillRoundedRect(left + 6, -half + 3, part.length - 12, part.width - 7, 3);
    g.fillStyle(ART.roofLight).fillRoundedRect(left + 8, -half + 4, part.length - 16, 7, 2);
    if (part.wagonFamilyId === 'covered-hopper') {
      for (const x of [-part.length * 0.25, 0, part.length * 0.25]) {
        g.fillStyle(0x8e9f92).fillCircle(x, 0, 6);
        g.fillStyle(0xc6ceba).fillCircle(x - 0.8, -1, 4.5);
        g.lineStyle(0.8, 0x75877e).lineBetween(x - 3, 0, x + 3, 0);
      }
    } else {
      g.lineStyle(0.8, 0xa6b09e);
      for (let x = left + 19; x < -left - 8; x += 18) g.lineBetween(x, -half + 5, x, half - 5);
    }
    if (part.loadFraction > 0) g.fillStyle(ART.warning).fillRect(left + 12, half - 4, (part.length - 24) * part.loadFraction, 2);
  }
  for (const y of [-7, 7]) g.fillStyle(0xbb6351).fillCircle(left + 2, y, 1.4);
}

/** All geometry is local to the completed bogie pose; this never changes the consist. */
export function drawFleetBody(g: Phaser.GameObjects.Graphics, part: FleetPartVisual): void {
  g.clear(); drawFrame(g, part);
  if (part.kind === 'wagon') { drawWagon(g, part); return; }
  drawShell(g, part);
  if (part.passenger) drawPassengerUnit(g, part);
  else if (part.silhouette === 'short-hood') drawShunter(g, part);
  else if (part.silhouette === 'electric-box') {
    drawDiesel(g, part);
    g.fillStyle(ART.roof).fillRoundedRect(-part.length * 0.3, -10, part.length * 0.6, 20, 3);
    drawPantograph(g, -part.length * 0.19, part.width); drawPantograph(g, part.length * 0.19, part.width);
    g.lineStyle(1.5, 0xb57c55).lineBetween(-part.length * 0.13, 0, part.length * 0.13, 0);
  } else drawDiesel(g, part);
}

export function drawStationShadow(g: Phaser.GameObjects.Graphics, length: number): void {
  g.clear();
  for (const [spread, alpha] of [[5, 0.03], [2, 0.06], [0, 0.1]]) g.fillStyle(ART.shadow, alpha).fillRoundedRect(-length / 2 - spread, 24 - spread, length + spread * 2, 30 + spread * 2, 4 + spread);
  const canopyLength = Math.min(250, length * 0.48);
  g.fillStyle(ART.shadow, 0.17).fillRoundedRect(-canopyLength / 2 + 1, 30, canopyLength, 20, 2);
}

export function drawStationPlatform(g: Phaser.GameObjects.Graphics, length: number, colour: number): void {
  g.clear();
  g.fillStyle(0x8a8c75).fillRoundedRect(-length / 2, 23, length, 32, 3);
  g.fillStyle(ART.platform).fillRoundedRect(-length / 2 + 1, 23, length - 2, 28, 2);
  g.fillStyle(0xd5ceb7).fillRect(-length / 2 + 2, 23, length - 4, 5);
  g.lineStyle(1.8, ART.warning).lineBetween(-length / 2 + 4, 29, length / 2 - 4, 29);
  g.lineStyle(0.7, 0x8f947c, 0.7);
  for (let x = -length / 2 + 32; x < length / 2 - 8; x += 44) g.lineBetween(x, 31, x, 50);
  g.lineStyle(1, 0xd7d1ba, 0.9).lineBetween(-length / 2 + 3, 50, length / 2 - 3, 50);
  const canopyLength = Math.min(250, length * 0.48);
  for (const x of [-canopyLength * 0.38, 0, canopyLength * 0.38]) {
    g.fillStyle(ART.ink).fillRect(x - 1.5, 32, 3, 18);
    g.fillStyle(colour).fillRoundedRect(x - 4, 47, 8, 4, 1);
  }
  g.fillStyle(ART.slate).fillRoundedRect(-canopyLength / 2, 32, canopyLength, 17, 2);
  g.fillStyle(ART.slateLight).fillRoundedRect(-canopyLength / 2 + 1, 32, canopyLength - 2, 7, 1);
  g.lineStyle(1.2, 0x89938a).lineBetween(-canopyLength / 2 + 2, 32, canopyLength / 2 - 2, 32);
  g.lineStyle(0.7, 0x3e5351, 0.8);
  for (let x = -canopyLength / 2 + 7; x < canopyLength / 2 - 2; x += 10) g.lineBetween(x, 34, x, 47);
  g.fillStyle(0xb4bbab).fillRect(-canopyLength / 2 + 2, 39, canopyLength - 4, 1.3);
  for (const end of [-1, 1]) {
    const x = end * Math.min(length * 0.32, canopyLength / 2 + 55);
    g.fillStyle(0x5d7160).fillRoundedRect(x - 15, 43, 30, 7, 1.5);
    g.fillStyle(0x9b7e53).fillRoundedRect(x - 14, 42, 28, 4, 1);
    g.lineStyle(1, 0xbda47b).lineBetween(x - 12, 43, x + 12, 43);
    g.fillStyle(ART.slate).fillCircle(x + end * 23, 43, 3);
    g.fillStyle(ART.cream).fillCircle(x + end * 23 - 0.5, 42.5, 1.5);
    const planter = x - end * 29;
    g.fillStyle(0x97765b).fillRoundedRect(planter - 6, 42, 12, 9, 1);
    g.fillStyle(0x526d42).fillCircle(planter - 2, 45, 4).fillCircle(planter + 3, 46, 3);
    g.fillStyle(0x79955b).fillCircle(planter - 2.5, 43.5, 2);
  }
  // Small weatherboard booking hut, clear of the safety strip and train envelope.
  const hut = Math.min(length * 0.3, canopyLength / 2 + 110);
  g.fillStyle(0x6b745e).fillRoundedRect(hut - 29, 47, 60, 31, 2);
  g.fillStyle(0xc1b49a).fillRoundedRect(hut - 28, 47, 56, 27, 1);
  g.fillStyle(ART.slate).fillRoundedRect(hut - 31, 48, 62, 25, 2);
  g.fillStyle(ART.slateLight).fillRect(hut - 29, 49, 58, 10);
  g.lineStyle(1, 0x9aa297).lineBetween(hut - 29, 59, hut + 29, 59);
  g.fillStyle(colour).fillRect(hut - 24, 45, 19, 3);
  g.fillStyle(ART.window).fillRect(hut + 4, 45, 15, 3);
  g.fillStyle(ART.warning).fillRect(-length / 2 + 5, 31, 4, 18).fillRect(length / 2 - 9, 31, 4, 18);
}
