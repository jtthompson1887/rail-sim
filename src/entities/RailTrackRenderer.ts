import Phaser from 'phaser';
import type RailTrack from './RailTrack';
import { GameConfig } from '../config/GameConfig';

type Image = Phaser.GameObjects.Image;

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

  constructor(scene: Phaser.Scene, track: RailTrack) {
    this.scene = scene;
    this.track = track;
  }

  /** Recreate all sprites along the track curve. */
  rebuild(): void {
    this.destroySprites();

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

  private createSegment(texture: string, i: number, iterations: number, curve: Phaser.Curves.Path): void {
    const t = i / iterations;
    const point = curve.getPoint(t);
    const nextPoint = curve.getPoint((i + 1) / iterations);
    const angle = Phaser.Math.Angle.BetweenPoints(point, nextPoint);

    const img = this.scene.add.image(point.x, point.y, texture);
    img.setOrigin(0, 0.5);
    img.setScale(this.railTrackScale);
    img.setDepth(0);
    img.rotation = angle;

    if (this.track.isTunnel) {
      img.setAlpha(0.45);
      img.setTint(0x334455);
    }

    this.track.add(img);
    this.tracksImages.push(img);
  }

  /** Destroy all rendered sprites. */
  destroySprites(): void {
    this.track.remove(this.tracksImages, true);
    this.tracksImages.length = 0;
  }

  destroy(): void {
    this.destroySprites();
  }
}
