import Phaser from 'phaser';
import type RailTrack from './RailTrack';
import { GameConfig } from '../config/GameConfig';
import { WorldManager } from '../managers/WorldManager';
import { isRiverside } from '../region/RiversideRegion';

type Image = Phaser.GameObjects.Image;

/** Compress the source photographs so track reads as a route, not a wide texture strip. */
const CROSS_TRACK_SCALE_RATIO = 0.45;

/**
 * RailTrackRenderer – responsible for the visual representation of a RailTrack.
 *
 * This separates rendering concerns (sprite creation, tinting, alpha) from the
 * data/logic of RailTrack itself, enabling headless testing and potential
 * renderer swaps without touching entity logic.
 */
export class RailTrackRenderer {
  private readonly scene: Phaser.Scene;
  private readonly track: RailTrack;
  private readonly texture1: string = 'ballast';
  private readonly texture2: string = 'rail';
  private readonly railTrackWidth: number = GameConfig.TRACK.RAIL_TRACK_WIDTH;
  private readonly railTrackScale: number = GameConfig.TRACK.SCALE;
  private readonly tracksImages: Image[] = [];
  private illustrated: Phaser.GameObjects.Graphics | null = null;

  constructor(scene: Phaser.Scene, track: RailTrack) {
    this.scene = scene;
    this.track = track;
  }

  /** Recreate all sprites along the track curve. */
  rebuild(): void {
    this.destroySprites();
    if (isRiverside(WorldManager.world)) { this.drawIllustrated(); return; }

    const curve = this.track.getCurvePath();
    const totalDistance = curve.getLength();
    const iterations = Math.max(1, Math.ceil(totalDistance / (this.railTrackWidth * this.railTrackScale)));

    // Ballast layer first, then rail layer on top
    for (let i = 0; i < iterations; i++) {
      this.createSegment(this.texture1, i, iterations, curve);
    }
    for (let i = 0; i < iterations; i++) {
      this.createSegment(this.texture2, i, iterations, curve);
    }
  }

  private createSegment(texture: string, i: number, iterations: number, curve: Phaser.Curves.CubicBezier): void {
    const t = i / iterations;
    const point = curve.getPoint(t);
    const nextPoint = curve.getPoint((i + 1) / iterations);
    const angle = Phaser.Math.Angle.BetweenPoints(point, nextPoint);

    const img = this.scene.add.image(point.x, point.y, texture);
    img.setOrigin(0, 0.5);
    img.setScale(
      this.railTrackScale,
      this.railTrackScale * CROSS_TRACK_SCALE_RATIO,
    );
    img.setDepth(0);
    img.rotation = angle;

    if (this.track.structureTypeAt(t) === 'tunnel') {
      img.setAlpha(0.45);
      img.setTint(0x334455);
    }

    this.track.add(img);
    this.tracksImages.push(img);
  }

  /** Sleepers and continuous steel follow arc distance, with a quiet ballast shoulder. */
  private drawIllustrated(): void {
    const g=this.scene.add.graphics();this.track.add(g);this.illustrated=g;
    const index=this.track.getArcLengthIndex();
    const line=(width:number,colour:number,offset=0,alpha=1)=>{
      g.lineStyle(width,colour,alpha);g.beginPath();
      for(let d=0;d<=index.length+6;d+=6){const p=index.poseAtDistance(Math.min(d,index.length)),nx=-p.tangent.y,ny=p.tangent.x,x=p.point.x+nx*offset,y=p.point.y+ny*offset;if(d===0)g.moveTo(x,y);else g.lineTo(x,y);}g.strokePath();
    };
    line(39,0x77816b,0,.35);line(32,0xaaa391);line(26,0x9a9585);
    for(let d=4;d<index.length;d+=8){const p=index.poseAtDistance(d),nx=-p.tangent.y,ny=p.tangent.x;g.lineStyle(3.5,0x5e655c,.9);g.lineBetween(p.point.x-nx*12,p.point.y-ny*12,p.point.x+nx*12,p.point.y+ny*12);}
    for(const side of [-7.2,7.2]){line(3.5,0x455550,side);line(1.5,0xd4d6be,side-.7);}
  }

  /** Destroy all rendered sprites. */
  destroySprites(): void {
    this.illustrated?.destroy();this.illustrated=null;
    this.track.remove(this.tracksImages, true);
    this.tracksImages.length = 0;
  }

  destroy(): void {
    this.destroySprites();
  }
}
