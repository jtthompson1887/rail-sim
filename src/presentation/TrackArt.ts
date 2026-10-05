import type Phaser from 'phaser';
import type { TrackArcLengthIndex } from '../physics/TrackArcLengthIndex';

/** The illustrated track artwork shared by the playable railway and title scene. */
export function drawIllustratedTrack(g: Phaser.GameObjects.Graphics, index: TrackArcLengthIndex): void {
  const line = (width: number, colour: number, offset = 0, alpha = 1) => {
    g.lineStyle(width, colour, alpha).beginPath();
    for (let d = 0; d <= index.length + 6; d += 6) {
      const p = index.poseAtDistance(Math.min(d, index.length));
      const x = p.point.x - p.tangent.y * offset, y = p.point.y + p.tangent.x * offset;
      if (d === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokePath();
  };
  line(39, 0x77816b, 0, .35); line(32, 0xaaa391); line(26, 0x9a9585);
  for (let d = 4; d < index.length; d += 8) {
    const p = index.poseAtDistance(d), nx = -p.tangent.y, ny = p.tangent.x;
    g.lineStyle(3.5, 0x5e655c, .9).lineBetween(p.point.x - nx * 12, p.point.y - ny * 12, p.point.x + nx * 12, p.point.y + ny * 12);
  }
  for (const side of [-7.2, 7.2]) { line(3.5, 0x455550, side); line(1.5, 0xd4d6be, side - .7); }
}
