import Phaser from 'phaser';
type CubicBezier = Phaser.Curves.CubicBezier;
import { GameConfig } from '../config/GameConfig';
import type { TrackNode } from './TrackNode';
import Junction from './Junction';
import { RailTrackRenderer } from './RailTrackRenderer';
import { createPort, type TrackPort } from './TrackPort';
import type {
  StructureInterval,
  StructureType,
  VerticalProfileDef,
} from '../config/WorldData';

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
  private curve!: CubicBezier;
  private uuid: string;
  private renderer: RailTrackRenderer;
  /** Port-based connection model. */
  private _startPort!: TrackPort;
  private _endPort!: TrackPort;
  private _verticalProfile: VerticalProfileDef | null = null;
  private _structures: StructureInterval[] | null = null;
  private _paidBuildCost: number | null = null;
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
    const copiedP0 = new Phaser.Math.Vector2(p0.x, p0.y);
    const copiedP1 = new Phaser.Math.Vector2(p1.x, p1.y);
    const copiedP2 = new Phaser.Math.Vector2(p2.x, p2.y);
    const copiedP3 = new Phaser.Math.Vector2(p3.x, p3.y);
    this.curve = new Phaser.Curves.CubicBezier(copiedP0, copiedP1, copiedP2, copiedP3);
    this.p0 = copiedP0;
    this.p1 = copiedP1;
    this.p2 = copiedP2;
    this.totalDistance = this.curve.getLength();
    this.iterations = Math.max(1, Math.ceil(this.totalDistance / (this.railTrackWidth * this.railTrackScale)));
    // Update port positions
    this._startPort.position = { x: p0.x, y: p0.y };
    this._endPort.position = { x: copiedP3.x, y: copiedP3.y };
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

    // Phase 2: Refine with ternary search in the neighborhood of closestT
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

  getCurvePath(): CubicBezier {
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

  /** Return all four Bézier control points (p0..p3) as world-space vectors.
   * Returns the true stored control points (p1, p2), not sampled points.
   */
  getControlPoints(): { p0: Phaser.Math.Vector2; p1: Phaser.Math.Vector2; p2: Phaser.Math.Vector2; p3: Phaser.Math.Vector2 } {
    return {
      p0: new Phaser.Math.Vector2(this.p0.x, this.p0.y),
      p1: new Phaser.Math.Vector2(this.p1.x, this.p1.y),
      p2: new Phaser.Math.Vector2(this.p2.x, this.p2.y),
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

  setConstructionData(
    verticalProfile: VerticalProfileDef,
    structures: StructureInterval[],
    paidBuildCost: number,
  ): void {
    this._verticalProfile = {
      profileVersion: 1,
      knots: verticalProfile.knots.map((knot) => ({ ...knot })),
    };
    this._structures = structures.map((interval) => ({ ...interval }));
    this._paidBuildCost = paidBuildCost;
    this.renderer.rebuild();
  }

  get verticalProfile(): VerticalProfileDef | null {
    if (!this._verticalProfile) return null;
    return {
      profileVersion: 1,
      knots: this._verticalProfile.knots.map((knot) => ({ ...knot })),
    };
  }

  get structures(): StructureInterval[] | null {
    return this._structures?.map((interval) => ({ ...interval })) ?? null;
  }

  get paidBuildCost(): number | null {
    return this._paidBuildCost;
  }

  structureTypeAt(rawT: number): StructureType {
    if (!this._structures) return 'surface';
    const t = Math.max(0, Math.min(1, rawT));
    const match = this._structures.find((interval, index) => (
      t >= interval.startT
      && (t < interval.endT || index === this._structures!.length - 1)
    ));
    return match?.type ?? 'surface';
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
