import Phaser from 'phaser';
type Image = Phaser.GameObjects.Image;
type Path = Phaser.Curves.Path;
type Transform = Phaser.GameObjects.Components.Transform;
import { GameConfig } from '../config/GameConfig';
import type { TrackNode } from './TrackNode';
import Junction from './Junction';

interface Trackable extends Transform {
  body?: {
    position: {
      x: number;
      y: number;
    };
  };
}

export default class RailTrack extends Phaser.GameObjects.Container implements TrackNode {
  private readonly texture1: string = 'ballast';
  private readonly texture2: string = 'rail';
  private readonly railTrackWidth: number = GameConfig.TRACK.RAIL_TRACK_WIDTH;
  private readonly railTrackScale: number = GameConfig.TRACK.SCALE;
  private iterations: number = 0;
  private totalDistance: number = 0;
  private p0!: Phaser.Math.Vector2;
  private p1!: Phaser.Math.Vector2;
  private p2!: Phaser.Math.Vector2;
  private readonly tracksImages: Image[] = [];
  private curve!: Path;
  private readonly uuid: string;
  /** When true the track runs through a tunnel and renders with a darker tint. */
  isTunnel: boolean = false;
  /** Average terrain elevation at the time of placement. */
  elevation: number = 0;
  protected trackConnections: {
    next?: TrackNode;
    previous?: TrackNode;
  } = {};

  constructor(scene: Phaser.Scene, p0: Phaser.Math.Vector2, p1: Phaser.Math.Vector2, p2: Phaser.Math.Vector2, p3: Phaser.Math.Vector2) {
    super(scene);
    scene.add.existing(this);
    this.uuid = crypto.randomUUID();
    this.setDepth(0);
    this.updateTrackVectors(p0, p1, p2, p3);
  }

  createTracks(): void {
    this.remove(this.tracksImages, true);
    this.tracksImages.length = 0;

    for (let i = 0; i < this.iterations; i++) {
      this.createTrackSegment(this.texture1, i);
    }

    for (let i = 0; i < this.iterations; i++) {
      this.createTrackSegment(this.texture2, i);
    }
  }

  createTrackSegment(texture: string, i: number): void {
    const t = i / this.iterations;
    const point = this.curve.getPoint(t);
    const nextPoint = this.curve.getPoint((i + 1) / this.iterations);
    const angle = Phaser.Math.Angle.BetweenPoints(point, nextPoint);

    const railTrack = this.scene.add.image(point.x, point.y, texture);
    railTrack.setOrigin(0, 0.5);
    railTrack.setScale(this.railTrackScale);
    railTrack.setDepth(0);
    railTrack.rotation = angle;

    // Tunnel segments render darker to indicate underground passage
    if (this.isTunnel) {
      railTrack.setAlpha(0.45);
      railTrack.setTint(0x334455);
    }

    this.add(railTrack);
    this.tracksImages.push(railTrack);
  }

  updateTrackVectors(p0: Phaser.Math.Vector2, p1: Phaser.Math.Vector2, p2: Phaser.Math.Vector2, p3: Phaser.Math.Vector2): void {
    this.curve = new Phaser.Curves.Path(p0.x, p0.y).splineTo([p1, p2, p3]);
    this.p0 = p0;
    this.p1 = p1;
    this.p2 = p2;
    this.totalDistance = this.curve.getLength();
    this.iterations = Math.max(1, Math.ceil(this.totalDistance / (this.railTrackWidth * this.railTrackScale)));

    this.createTracks();
  }

  getTrackAngle(object: Trackable): number {
    const t = this.getTrackPosition(object);
    const tangent = this.curve.getTangent(t);
    return Phaser.Math.RadToDeg(Math.atan2(tangent.y, tangent.x));
  }

  getTrackPoint(object: Trackable): Phaser.Math.Vector2 {
    const t = this.getTrackPosition(object);
    return this.curve.getPoint(t);
  }

  getTrackPosition(object: Trackable): number {
    const numSamples = 1000;
    let closestDistance = Infinity;
    let closestT = 0;
    const objectX = object.body ? object.body.position.x : object.x;
    const objectY = object.body ? object.body.position.y : object.y;

    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const point = this.curve.getPoint(t);
      const distance = Phaser.Math.Distance.Between(objectX, objectY, point.x, point.y);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestT = t;
      }
    }

    return closestT;
  }

  getCurvePath(): Path {
    return this.curve;
  }

  /** The stored second knot (p1) of the spline curve, as a copy. */
  getP1(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(this.p1.x, this.p1.y);
  }

  /** The stored third knot (p2) of the spline curve, as a copy. */
  getP2(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(this.p2.x, this.p2.y);
  }

  /** Return all four Bézier control points (p0..p3) as world-space vectors. */
  getControlPoints(): { p0: Phaser.Math.Vector2; p1: Phaser.Math.Vector2; p2: Phaser.Math.Vector2; p3: Phaser.Math.Vector2 } {
    return {
      p0: this.curve.getStartPoint() as Phaser.Math.Vector2,
      p1: this.curve.getPoint(0.33) as Phaser.Math.Vector2,
      p2: this.curve.getPoint(0.67) as Phaser.Math.Vector2,
      p3: this.curve.getEndPoint() as Phaser.Math.Vector2,
    };
  }

  /** Convenience: world-space midpoint of this track segment. */
  getMidPoint(): Phaser.Math.Vector2 {
    return this.curve.getPoint(0.5) as Phaser.Math.Vector2;
  }

  getUUID(): string {
    return this.uuid;
  }

  hasNext(): boolean {
    return this.trackConnections.next !== undefined;
  }

  hasPrevious(): boolean {
    return this.trackConnections.previous !== undefined;
  }

  getNext(): TrackNode | undefined {
    return this.trackConnections.next;
  }

  getPrevious(): TrackNode | undefined {
    return this.trackConnections.previous;
  }

  setNext(node: TrackNode | undefined): void {
    this.trackConnections.next = node;
  }

  setPrevious(node: TrackNode | undefined): void {
    this.trackConnections.previous = node;
  }

  isJunction(): this is Junction {
    return false;
  }

  isTrack(): this is RailTrack {
    return true;
  }
}
