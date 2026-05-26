import Phaser from 'phaser';
import type { SceneryObjectDef, SceneryType } from '../config/WorldData';

/**
 * SceneryObject
 *
 * A lightweight Phaser.GameObjects.Container that draws a single scenery
 * asset procedurally using Phaser.GameObjects.Graphics. No external sprites
 * are needed — everything is drawn via the Graphics API so the system works
 * without any art assets loaded.
 *
 * Depth is set to `y * 0.1` to achieve painter's-order layering: objects
 * lower on screen naturally appear in front of those higher up.
 */
export class SceneryObject extends Phaser.GameObjects.Container {
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, def: SceneryObjectDef) {
    super(scene, def.x, def.y);
    scene.add.existing(this);

    this.gfx = scene.add.graphics();
    this.add(this.gfx);

    this.setRotation(def.rotation);
    this.setScale(def.scale);
    this.setDepth(def.y * 0.1);

    this.draw(def.type, def.variant);
  }

  // ── Drawing dispatch ────────────────────────────────────────────────────────

  private draw(type: SceneryType, variant: number): void {
    switch (type) {
      case 'tree_oak':   this.drawOak(variant);   break;
      case 'tree_pine':  this.drawPine(variant);  break;
      case 'tree_birch': this.drawBirch(variant); break;
      case 'tree_dead':  this.drawDeadTree(variant); break;
      case 'rock_boulder':  this.drawBoulder(variant); break;
      case 'rock_outcrop':  this.drawOutcrop(variant); break;
      case 'rock_cluster':  this.drawRockCluster(variant); break;
      case 'terrain_pond':  this.drawPond(variant);  break;
      case 'terrain_cliff': this.drawCliff(variant); break;
      case 'terrain_mound': this.drawMound(variant); break;
    }
  }

  // ── Trees ───────────────────────────────────────────────────────────────────

  private drawOak(variant: number): void {
    const trunkH   = 60 + variant * 10;
    const trunkW   = 14;
    const canopyR  = 50 + variant * 8;
    const canopyX  = 0;
    const canopyY  = -(trunkH + canopyR * 0.6);

    // Trunk
    this.gfx.fillStyle(0x5c3a1e, 1);
    this.gfx.fillRect(-trunkW / 2, -trunkH, trunkW, trunkH);

    // Multi-layer canopy
    this.gfx.fillStyle(0x2d6a1e, 1);
    this.gfx.fillEllipse(canopyX, canopyY, canopyR * 2, canopyR * 1.6);
    this.gfx.fillStyle(0x3a8a28, 0.85);
    this.gfx.fillEllipse(canopyX - 12, canopyY - 10, canopyR * 1.5, canopyR * 1.2);
    this.gfx.fillStyle(0x4aaa34, 0.6);
    this.gfx.fillEllipse(canopyX + 10, canopyY - 8, canopyR * 1.2, canopyR);
  }

  private drawPine(variant: number): void {
    const trunkH  = 50 + variant * 8;
    const trunkW  = 10;
    const tiers   = 3 + variant;
    const baseW   = 55 + variant * 5;

    // Trunk
    this.gfx.fillStyle(0x5c3a1e, 1);
    this.gfx.fillRect(-trunkW / 2, -trunkH * 0.5, trunkW, trunkH * 0.5);

    // Stacked triangular tiers from bottom to top
    for (let t = 0; t < tiers; t++) {
      const frac = t / tiers;
      const w    = baseW * (1 - frac * 0.65);
      const y    = -(trunkH * 0.4 + t * (trunkH * 0.7 / tiers));
      const green = 0x1a5c14 + t * 0x001a00;
      this.gfx.fillStyle(Math.min(green, 0x3aaa2a), 1);
      this.gfx.fillTriangle(-w / 2, y, w / 2, y, 0, y - trunkH * 0.45 / tiers);
    }
  }

  private drawBirch(variant: number): void {
    const trunkH  = 70 + variant * 8;
    const trunkW  = 10;
    const canopyR = 38 + variant * 6;

    // Pale trunk with dark marks
    this.gfx.fillStyle(0xe8e0d0, 1);
    this.gfx.fillRect(-trunkW / 2, -trunkH, trunkW, trunkH);
    for (let i = 1; i <= 3; i++) {
      this.gfx.fillStyle(0x5c5040, 0.5);
      this.gfx.fillRect(-trunkW / 2, -trunkH * (i / 4), trunkW, 4);
    }

    // Light-green canopy
    this.gfx.fillStyle(0x5aaa38, 1);
    this.gfx.fillEllipse(0, -(trunkH + canopyR * 0.5), canopyR * 2, canopyR * 1.4);
    this.gfx.fillStyle(0x70cc4a, 0.7);
    this.gfx.fillEllipse(-8, -(trunkH + canopyR * 0.7), canopyR * 1.3, canopyR);
  }

  private drawDeadTree(variant: number): void {
    const trunkH = 55 + variant * 10;
    const trunkW = 12;

    // Dark bare trunk
    this.gfx.fillStyle(0x3a2a1a, 1);
    this.gfx.fillRect(-trunkW / 2, -trunkH, trunkW, trunkH);

    // Angular bare branches
    this.gfx.lineStyle(5, 0x3a2a1a, 1);
    const branchCount = 3 + variant;
    for (let i = 0; i < branchCount; i++) {
      const by  = -(trunkH * (0.4 + i * 0.18));
      const bx  = (i % 2 === 0 ? 1 : -1) * (20 + i * 5);
      this.gfx.beginPath();
      this.gfx.moveTo(0, by);
      this.gfx.lineTo(bx, by - 18 - i * 4);
      this.gfx.strokePath();
    }
  }

  // ── Rocks ───────────────────────────────────────────────────────────────────

  private drawBoulder(variant: number): void {
    const r     = 28 + variant * 8;
    const sides = 6 + variant;
    const points: number[] = [];

    for (let i = 0; i < sides; i++) {
      const angle  = (i / sides) * Math.PI * 2;
      // Slight random-like radius variation seeded by variant + index
      const jitter = 0.7 + 0.3 * ((Math.sin(i * 7.3 + variant * 2.1) + 1) / 2);
      points.push(Math.cos(angle) * r * jitter, Math.sin(angle) * r * jitter * 0.65);
    }

    this.gfx.fillStyle(0x6a6860, 1);
    this.gfx.fillPoints(this.pairToVec(points), true);
    // Highlight
    this.gfx.fillStyle(0x9a9890, 0.5);
    this.gfx.fillEllipse(-r * 0.2, -r * 0.2, r * 0.6, r * 0.4);
  }

  private drawOutcrop(variant: number): void {
    const count = 2 + variant;
    for (let i = 0; i < count; i++) {
      const ox = (i - count / 2) * 30;
      const oy = (i % 2 === 0 ? 0 : -12);
      const w  = 22 + variant * 4 + i * 4;
      const h  = 30 + i * 8;
      this.gfx.fillStyle(0x5a5850, 1);
      this.gfx.fillRect(ox - w / 2, oy - h, w, h);
      // Highlight edge
      this.gfx.fillStyle(0x8a8880, 0.5);
      this.gfx.fillRect(ox - w / 2, oy - h, 4, h);
    }
  }

  private drawRockCluster(variant: number): void {
    const count = 3 + variant;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + variant;
      const dist  = 15 + i * 10;
      const rx    = Math.cos(angle) * dist;
      const ry    = Math.sin(angle) * dist * 0.6;
      const r     = 10 + ((i + variant) % 3) * 6;
      this.gfx.fillStyle(0x6a6860, 1);
      this.gfx.fillEllipse(rx, ry, r * 2, r * 1.3);
    }
  }

  // ── Terrain variations ──────────────────────────────────────────────────────

  private drawPond(variant: number): void {
    const rx = 55 + variant * 10;
    const ry = 35 + variant * 5;

    this.gfx.fillStyle(0x2a6aaa, 0.75);
    this.gfx.fillEllipse(0, 0, rx * 2, ry * 2);

    // Shoreline ripples
    this.gfx.lineStyle(1, 0x5aaadd, 0.4);
    this.gfx.strokeEllipse(0, 0, rx * 1.6, ry * 1.6);
  }

  private drawCliff(variant: number): void {
    const h = 45 + variant * 15;
    const w = 70 + variant * 20;

    // Main cliff face
    this.gfx.fillStyle(0x6a6050, 1);
    this.gfx.fillRect(-w / 2, -h, w, h);

    // Striated hatching
    this.gfx.lineStyle(2, 0x4a4038, 0.6);
    for (let s = 1; s <= 4; s++) {
      const y = -h * s / 5;
      this.gfx.beginPath();
      this.gfx.moveTo(-w / 2, y);
      this.gfx.lineTo(w / 2, y);
      this.gfx.strokePath();
    }
    // Top edge highlight
    this.gfx.lineStyle(3, 0x9a9080, 0.7);
    this.gfx.beginPath();
    this.gfx.moveTo(-w / 2, -h);
    this.gfx.lineTo(w / 2, -h);
    this.gfx.strokePath();
  }

  private drawMound(variant: number): void {
    const rx = 60 + variant * 15;
    const ry = 25 + variant * 8;

    // Base shadow
    this.gfx.fillStyle(0x2a3820, 0.3);
    this.gfx.fillEllipse(4, 4, rx * 2, ry * 2);

    // Mound body
    this.gfx.fillStyle(0x4a6a2a, 1);
    this.gfx.fillEllipse(0, 0, rx * 2, ry * 2);

    // Highlight
    this.gfx.fillStyle(0x6a9a3a, 0.5);
    this.gfx.fillEllipse(-rx * 0.2, -ry * 0.2, rx, ry);
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  private pairToVec(pairs: number[]): Phaser.Math.Vector2[] {
    const vecs: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < pairs.length; i += 2) {
      vecs.push(new Phaser.Math.Vector2(pairs[i], pairs[i + 1]));
    }
    return vecs;
  }
}
