import Phaser from 'phaser';
type Path = Phaser.Curves.Path;
import { GameConfig } from '../config/GameConfig';
import type { TrackNode } from './TrackNode';
import Junction from './Junction';
import { RailTrackRenderer } from './RailTrackRenderer';
import { createPort, type TrackPort } from './TrackPort';

/**
 * Minimal interface for objects whose position can be projected onto a track.
 * Accepts both Phaser GameObjects (with Transform) and plain {x, y} objects.
 */
export interface Trackable {
  x: number;
  y: number;
  body?: {
    position: {
      x: number;
      y: number;
    };
  };
}

export default class RailTrack extends Phaser.GameObjects.Container implements TrackNode {
  private readonly railTrackWidth: number = GameConfig.TRACK.RAIL_TRACK_WIDTH;
  private readonly railTrackScale: number = GameConfig.TRACK.SCALE;
  private iterations: number = 0;
  private totalDistance: number = 0;
  private p0!: Phaser.Math.Vector2;
  private p1!: Phaser.Math.Vector2;
  private p2!: Phaser.Math.Vector2;
  private curve!: Path;
  private uuid: string;
  private renderer: RailTrackRenderer;
  /** Port-based connection model. */
  private _startPort!: TrackPort;
  private _endPort!: TrackPort;
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
    this.renderer = new RailTrackRenderer(scene, this);
    this._startPort = createPort(this, p0, 'start');
    this._endPort = createPort(this, p3, 'end');
    this.updateTrackVectors(p0, p1, p2, p3);
  }

  updateTrackVectors(p0: Phaser.Math.Vector2, p1: Phaser.Math.Vector2, p2: Phaser.Math.Vector2, p3: Phaser.Math.Vector2): void {
    this.curve = new Phaser.Curves.Path(p0.x, p0.y).splineTo([p1, p2, p3]);
    this.p0 = p0;
    this.p1 = p1;
    this.p2 = p2;
    this.totalDistance = this.curve.getLength();
    this.iterations = Math.max(1, Math.ceil(this.totalDistance / (this.railTrackWidth * this.railTrackScale)));
    // Update port positions
    this._startPort.position = { x: p0.x, y: p0.y };
    this._endPort.position = { x: p3.x, y: p3.y };
    this.renderer.rebuild();
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
    const objectX = object.body ? object.body.position.x : object.x;
    const objectY = object.body ? object.body.position.y : object.y;

    // Phase 1: Coarse search with fewer samples
    const coarseSamples = 50;
    let closestDistance = Infinity;
    let closestT = 0;

    for (let i = 0; i <= coarseSamples; i++) {
      const t = i / coarseSamples;
      const point = this.curve.getPoint(t);
      const dx = objectX - point.x;
      const dy = objectY - point.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < closestDistance) {
        closestDistance = distSq;
        closestT = t;
      }
    }

    // Phase 2: Refine with bisection in the neighborhood of closestT
    const step = 1 / coarseSamples;
    let lo = Math.max(0, closestT - step);
    let hi = Math.min(1, closestT + step);

    for (let iter = 0; iter < 10; iter++) {
      const mid1 = lo + (hi - lo) / 3;
      const mid2 = hi - (hi - lo) / 3;
      const p1 = this.curve.getPoint(mid1);
      const p2 = this.curve.getPoint(mid2);
      const d1 = (objectX - p1.x) ** 2 + (objectY - p1.y) ** 2;
      const d2 = (objectX - p2.x) ** 2 + (objectY - p2.y) ** 2;
      if (d1 < d2) {
        hi = mid2;
      } else {
        lo = mid1;
      }
    }

    return (lo + hi) / 2;
  }

  getCurvePath(): Path {
    return this.curve;
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

  /** Override the auto-generated UUID (used when restoring from saved state). */
  setUUID(uuid: string): void {
    this.uuid = uuid;
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

  /** Return the start port of this track. */
  get startPort(): TrackPort { return this._startPort; }
  /** Return the end port of this track. */
  get endPort(): TrackPort { return this._endPort; }
  /** Return all ports for graph traversal. */
  getPorts(): TrackPort[] { return [this._startPort, this._endPort]; }
}
