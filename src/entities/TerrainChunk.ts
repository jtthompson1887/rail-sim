import Phaser from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { BIOME_PALETTES } from '../config/SceneryConfig';
import type { TerrainGenerator } from '../systems/TerrainGenerator';
import type { BiomeType } from '../config/WorldData';
import type { BandName } from '../config/SceneryConfig';
import { OVERHEAD, artHash, mixArtColour } from '../presentation/OverheadPalette';

const TC  = GameConfig.TERRAIN;
const CHUNK = GameConfig.WORLD.CHUNK_SIZE;
const STEP  = TC.SAMPLE_STEP;

/** Half-extents of the baked heightmap in world-units. */
const HALF_W = TC.WORLD_WIDTH  / 2;
const HALF_H = TC.WORLD_HEIGHT / 2;

/** Band-name order for palette lookups. */
const BAND_ORDER: BandName[] = ['WATER', 'LOWLAND', 'MIDLAND', 'HIGHLAND', 'PEAK'];
const BAND_MAX: number[] = [
  TC.BANDS.WATER.max,
  TC.BANDS.LOWLAND.max,
  TC.BANDS.MIDLAND.max,
  TC.BANDS.HIGHLAND.max,
  TC.BANDS.PEAK.max,
];

/**
 * TerrainChunk
 *
 * Renders a single CHUNK_SIZE × CHUNK_SIZE region of terrain using
 * Phaser.GameObjects.Graphics. Each heightmap cell is drawn as a coloured
 * quad whose colour is derived from the terrain band, blended smoothly at
 * band boundaries, and optionally darkened by an ambient-occlusion factor.
 *
 * Depth is fixed at −100 so terrain appears below all game objects.
 */
export class TerrainChunk extends Phaser.GameObjects.Graphics {
  private readonly chunkX: number;
  private readonly chunkY: number;

  constructor(
    scene: Phaser.Scene,
    chunkX: number,
    chunkY: number,
    terrain: TerrainGenerator,
    biome: BiomeType,
  ) {
    super(scene);
    scene.add.existing(this);
    this.chunkX = chunkX;
    this.chunkY = chunkY;
    this.setDepth(-100);
    this.render(terrain, biome);
  }

  /** World-space X coordinate of the chunk origin (top-left corner). */
  get originX(): number { return this.chunkX; }
  /** World-space Y coordinate of the chunk origin (top-left corner). */
  get originY(): number { return this.chunkY; }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private render(terrain: TerrainGenerator, biome: BiomeType): void {
    this.clear();

    const samplesPerChunk = Math.ceil(CHUNK / STEP) + 1;

    for (let yi = 0; yi < samplesPerChunk - 1; yi++) {
      for (let xi = 0; xi < samplesPerChunk - 1; xi++) {
        // World coordinates of the top-left corner of this quad
        const wx = this.chunkX + xi * STEP;
        const wy = this.chunkY + yi * STEP;

        // Outside the world bounds: render as deep ocean to avoid stripe artifacts
        // caused by heightmap clamp-to-edge repeating edge values across whole rows/columns.
        if (wx < -HALF_W || wx >= HALF_W || wy < -HALF_H || wy >= HALF_H) {
          this.fillStyle(0x153d5f, 1);
          this.fillRect(wx, wy, STEP, STEP);
          continue;
        }

        // Shared corner colours interpolate through each cell instead of revealing
        // the heightmap's sample grid. Water is filled only by the clipped pass below.
        const topLeft = this.groundColour(terrain, wx, wy, biome);
        if (typeof this.fillGradientStyle === 'function') {
          this.fillGradientStyle(topLeft,
            this.groundColour(terrain, wx + STEP, wy, biome),
            this.groundColour(terrain, wx, wy + STEP, biome),
            this.groundColour(terrain, wx + STEP, wy + STEP, biome), 1);
        } else this.fillStyle(topLeft, 1);
        this.fillRect(wx, wy, STEP, STEP);
      }
    }

    this.drawGrassTexture(terrain, biome);

    // The heightfield's zero contour defines the water. Clipped triangles replace
    // square blue cells, keeping coastlines continuous across streamed chunks.
    const shores: Array<[{x:number;y:number},{x:number;y:number}]> = [];
    for (let yi = 0; yi < samplesPerChunk - 1; yi++) {
      for (let xi = 0; xi < samplesPerChunk - 1; xi++) {
        const wx = this.chunkX + xi * STEP;
        const wy = this.chunkY + yi * STEP;
        // Skip out-of-bounds quads (already filled with ocean colour above)
        if (wx < -HALF_W || wx >= HALF_W || wy < -HALF_H || wy >= HALF_H) continue;
        const vertices = [
          {x:wx,y:wy,h:this.sampleHeight(terrain,wx,wy)},
          {x:wx+STEP,y:wy,h:this.sampleHeight(terrain,wx+STEP,wy)},
          {x:wx+STEP,y:wy+STEP,h:this.sampleHeight(terrain,wx+STEP,wy+STEP)},
          {x:wx,y:wy+STEP,h:this.sampleHeight(terrain,wx,wy+STEP)},
        ];
        this.drawWaterTriangle([vertices[0],vertices[1],vertices[2]],shores);
        this.drawWaterTriangle([vertices[0],vertices[2],vertices[3]],shores);
        if(vertices.every(v=>v.h < -8) && artHash(wx,wy,4)>.62){
          const cy=wy+STEP*(.25+artHash(wx,wy,5)*.5);
          this.lineStyle(2,OVERHEAD.waterLight,.20);this.beginPath();
          this.moveTo(wx+24,cy);this.lineTo(wx+STEP-24,cy-3);this.strokePath();
        }
      }
    }

    for(const [a,b] of shores){
      this.lineStyle(26,OVERHEAD.yardShade,.45);this.beginPath();this.moveTo(a.x,a.y);this.lineTo(b.x,b.y);this.strokePath();
      this.lineStyle(12,OVERHEAD.sand,.85);this.beginPath();this.moveTo(a.x,a.y);this.lineTo(b.x,b.y);this.strokePath();
      this.lineStyle(3,OVERHEAD.waterLight,.5);this.beginPath();this.moveTo(a.x,a.y);this.lineTo(b.x,b.y);this.strokePath();
    }

    // Cliff-edge shadow strips
    for (let yi = 0; yi < samplesPerChunk - 1; yi++) {
      for (let xi = 0; xi < samplesPerChunk - 1; xi++) {
        const wx = this.chunkX + xi * STEP;
        const wy = this.chunkY + yi * STEP;
        // Skip out-of-bounds quads
        if (wx < -HALF_W || wx >= HALF_W || wy < -HALF_H || wy >= HALF_H) continue;
        const slope = terrain.slopeAt(wx, wy);
        if (slope > TC.CLIFF_SLOPE_DEG) {
          this.lineStyle(3, 0x776f59, 0.25);
          this.beginPath();this.moveTo(wx,wy+STEP*.65);this.lineTo(wx+STEP,wy+STEP*.45);this.strokePath();
        }
      }
    }
  }

  private sampleHeight(terrain: TerrainGenerator, x: number, y: number): number {
    return terrain.getHeightAt(Math.max(-HALF_W,Math.min(HALF_W-.001,x)),Math.max(-HALF_H,Math.min(HALF_H-.001,y)));
  }

  private groundColour(terrain: TerrainGenerator, x: number, y: number, biome: BiomeType): number {
    const height = Math.max(18, this.sampleHeight(terrain, x, y));
    const colour = mixArtColour(this.bandColor(height, biome), this.illustratedColour(height, biome), .88);
    // Lowland shade is uniform; mountain gradients retain useful terrain relief.
    return this.applyAO(colour, height < 110 ? .86 : this.computeAO(terrain, x, y));
  }

  private illustratedColour(h:number,biome:BiomeType):number{
    if(h<0)return mixArtColour(OVERHEAD.water,OVERHEAD.waterDeep,Math.min(1,-h/180));
    if(biome==='arid')return mixArtColour(0xbca582,0x978974,Math.min(1,h/340));
    if(h>340)return biome==='alpine'?0xe0dfd1:0xb9b59d;
    if(h>220)return mixArtColour(0x939780,0xaaa590,(h-220)/120);
    return mixArtColour(OVERHEAD.grass,OVERHEAD.meadow,Math.min(1,h/240));
  }

  private drawWaterTriangle(vertices:Array<{x:number;y:number;h:number}>,shores:Array<[{x:number;y:number},{x:number;y:number}]>):void{
    const polygon:Array<{x:number;y:number}>=[],crossings:Array<{x:number;y:number}>=[];
    for(let i=0;i<vertices.length;i++){
      const a=vertices[i],b=vertices[(i+1)%vertices.length],wetA=a.h<0,wetB=b.h<0;
      if(wetA)polygon.push(a);
      if(wetA!==wetB){const t=a.h/(a.h-b.h),p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};polygon.push(p);crossings.push(p);}
    }
    if(polygon.length>=3){
      const depth=vertices.reduce((n,v)=>n+Math.min(0,v.h),0)/3;
      this.fillStyle(mixArtColour(OVERHEAD.water,OVERHEAD.waterDeep,Math.min(.75,-depth/180)),1);
      this.beginPath();this.moveTo(polygon[0].x,polygon[0].y);for(const p of polygon.slice(1))this.lineTo(p.x,p.y);this.closePath();this.fillPath();
    }
    if(crossings.length===2)shores.push([crossings[0],crossings[1]]);
  }

  private drawGrassTexture(terrain:TerrainGenerator,biome:BiomeType):void{
    if(biome==='arid'||biome==='alpine')return;
    // Sparse, broad brush marks give grass a material without a high-frequency noise veil.
    for(let y=this.chunkY+48;y<this.chunkY+CHUNK;y+=96)for(let x=this.chunkX+32;x<this.chunkX+CHUNK;x+=96){
      if(x < -HALF_W || x>=HALF_W || y < -HALF_H || y>=HALF_H)continue;
      const h=terrain.getHeightAt(x,y);if(h<8||h>240)continue;
      const j=artHash(x,y,20);if(j<.45)continue;
      this.lineStyle(2,j>.75?0xc0c8a2:0x536f4a,.17);
      this.beginPath();this.moveTo(x,y);this.lineTo(x+14+j*17,y-2);this.strokePath();
    }
  }

  // ── Colour helpers ──────────────────────────────────────────────────────────

  /**
   * Return the colour for a height value within the given biome, blending
   * smoothly within BAND_BLEND_RANGE of a band boundary.
   */
  private bandColor(height: number, biome: BiomeType): number {
    const palette = BIOME_PALETTES[biome];
    const blend   = TC.BAND_BLEND_RANGE;

    for (let i = 0; i < BAND_MAX.length - 1; i++) {
      const threshold = BAND_MAX[i];
      if (threshold === Infinity) break;
      if (height < threshold + blend) {
        const bandName = BAND_ORDER[i];
        const nextName = BAND_ORDER[i + 1];
        if (height > threshold - blend) {
          // Blend between this band and the next
          const t = (height - (threshold - blend)) / (2 * blend);
          return this.lerpColor(palette[bandName], palette[nextName], Math.max(0, Math.min(1, t)));
        }
        return palette[bandName];
      }
    }

    return palette['PEAK'];
  }

  /** Linearly interpolate two 24-bit RGB colours. */
  private lerpColor(c0: number, c1: number, t: number): number {
    const r0 = (c0 >> 16) & 0xff; const g0 = (c0 >> 8) & 0xff; const b0 = c0 & 0xff;
    const r1 = (c1 >> 16) & 0xff; const g1 = (c1 >> 8) & 0xff; const b1 = c1 & 0xff;
    const r  = Math.round(r0 + (r1 - r0) * t);
    const g  = Math.round(g0 + (g1 - g0) * t);
    const b  = Math.round(b0 + (b1 - b0) * t);
    return (r << 16) | (g << 8) | b;
  }

  // ── Ambient occlusion ───────────────────────────────────────────────────────

  /**
   * Simple dot-product ambient occlusion. Computes the surface normal from
   * central-difference gradients then dots with the sun direction.
   * Returns a value in [0, 1] where 0 is fully in shadow and 1 is fully lit.
   */
  private computeAO(terrain: TerrainGenerator, wx: number, wy: number): number {
    const dx = (this.sampleHeight(terrain,wx + STEP, wy) - this.sampleHeight(terrain,wx - STEP, wy)) / (2 * STEP);
    const dy = (this.sampleHeight(terrain,wx, wy + STEP) - this.sampleHeight(terrain,wx, wy - STEP)) / (2 * STEP);

    // Surface normal (unnormalised, z = 1)
    const nx = -dx;
    const ny = -dy;
    const nz = 1;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

    // Sun direction (normalised) – from GameConfig
    const sl = Math.sqrt(TC.SUN_DIR_X ** 2 + TC.SUN_DIR_Y ** 2 + 1);
    const dot = (nx * TC.SUN_DIR_X + ny * TC.SUN_DIR_Y + nz) / (len * sl);

    return Math.max(0, Math.min(1, dot));
  }

  /**
   * Apply ambient occlusion factor to a 24-bit RGB colour.
   * AO = 1 → fully lit; AO = 0 → darkened by AO_STRENGTH.
   */
  private applyAO(color: number, ao: number): number {
    const factor = 1 - TC.AO_STRENGTH * (1 - ao);
    const r = Math.round(((color >> 16) & 0xff) * factor);
    const g = Math.round(((color >>  8) & 0xff) * factor);
    const b = Math.round(( color        & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
  }
}
