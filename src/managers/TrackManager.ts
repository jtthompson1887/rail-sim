import Phaser from 'phaser';
type Vector2Like = Phaser.Types.Math.Vector2Like;
import RailTrack from '../entities/RailTrack';
import Junction from '../entities/Junction';
import type { TrackNode } from '../entities/TrackNode';
import { GameConfig } from '../config/GameConfig';

/** Chunk coordinate key for the spatial index. */
type ChunkKey = string;

function chunkKey(x: number, y: number): ChunkKey {
  const cx = Math.floor(x / GameConfig.WORLD.CHUNK_SIZE);
  const cy = Math.floor(y / GameConfig.WORLD.CHUNK_SIZE);
  return `${cx}:${cy}`;
}

export default class TrackManager {
  private trackMap: Map<string, RailTrack>;
  private junctionMap: Map<string, Junction>;
  private scene: Phaser.Scene;
  private visibleTracks: Set<string>;
  /** Spatial index: chunk key → set of track UUIDs whose midpoint is in that chunk. */
  private chunkIndex: Map<ChunkKey, Set<string>>;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.trackMap = new Map<string, RailTrack>();
    this.junctionMap = new Map<string, Junction>();
    this.visibleTracks = new Set<string>();
    this.chunkIndex = new Map<ChunkKey, Set<string>>();
  }

  get tracks(): RailTrack[] {
    return this.getAllTracks();
  }

  get junctions(): Junction[] {
    return Array.from(this.junctionMap.values());
  }

  // ── Chunk helpers ──────────────────────────────────────────────────────────

  private indexTrack(track: RailTrack): void {
    const mid = track.getCurvePath().getPoint(0.5);
    const key = chunkKey(mid.x, mid.y);
    if (!this.chunkIndex.has(key)) this.chunkIndex.set(key, new Set());
    this.chunkIndex.get(key)!.add(track.getUUID());
  }

  private deindexTrack(track: RailTrack): void {
    const mid = track.getCurvePath().getPoint(0.5);
    const key = chunkKey(mid.x, mid.y);
    this.chunkIndex.get(key)?.delete(track.getUUID());
  }

  /**
   * Return all track UUIDs in chunks that overlap the given world-space rectangle,
   * plus one chunk margin in every direction (for smooth loading at chunk boundaries).
   */
  getTracksInChunks(bounds: Phaser.Geom.Rectangle): string[] {
    const margin = 1;
    const cs = GameConfig.WORLD.CHUNK_SIZE;
    const minCX = Math.floor(bounds.left / cs) - margin;
    const maxCX = Math.floor(bounds.right / cs) + margin;
    const minCY = Math.floor(bounds.top / cs) - margin;
    const maxCY = Math.floor(bounds.bottom / cs) + margin;
    const result: string[] = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const set = this.chunkIndex.get(`${cx}:${cy}`);
        if (set) result.push(...set);
      }
    }
    return result;
  }

  private setupTrackConnections(track: RailTrack | Junction): void {
    if (track instanceof RailTrack) {
      const startPoint = track.getCurvePath().getStartPoint();
      const endPoint = track.getCurvePath().getEndPoint();

      const prevNode = this.findClosestNode(startPoint, track);
      if (prevNode) {
        track.setPrevious(prevNode);
        prevNode.setNext(track);
      }

      const nextNode = this.findClosestNode(endPoint, track);
      if (nextNode) {
        track.setNext(nextNode);
        nextNode.setPrevious(track);
      }
    } else {
      const mainTrack = track.getMainTrack();
      const leftTrack = track.getLeftTrack();
      const rightTrack = track.getRightTrack();
      const junctionPos = track.getPosition();
      if (junctionPos < 0.5) {
        track.setPrevious(mainTrack);
        mainTrack.setNext(track);
        leftTrack.setPrevious(track);
        rightTrack.setPrevious(track);
      } else {
        track.setNext(mainTrack);
        mainTrack.setPrevious(track);
        leftTrack.setNext(track);
        rightTrack.setNext(track);
      }
    }
  }

  private findClosestNode(point: Vector2Like, excludeNode: TrackNode, maxDistance: number = 10): TrackNode | undefined {
    let closestNode: TrackNode | undefined;
    let minDistance = maxDistance;

    for (const track of this.trackMap.values()) {
      if (track === excludeNode) continue;
      const startDist = new Phaser.Math.Vector2(track.getCurvePath().getStartPoint()).distance(new Phaser.Math.Vector2(point));
      const endDist = new Phaser.Math.Vector2(track.getCurvePath().getEndPoint()).distance(new Phaser.Math.Vector2(point));
      const minDist = Math.min(startDist, endDist);
      if (minDist < minDistance) {
        minDistance = minDist;
        closestNode = track;
      }
    }

    for (const junction of this.junctionMap.values()) {
      if (junction === excludeNode) continue;
      const dist = new Phaser.Math.Vector2(junction.x, junction.y).distance(new Phaser.Math.Vector2(point));
      if (dist < minDistance) {
        minDistance = dist;
        closestNode = junction;
      }
    }

    return closestNode;
  }

  addTrack(track: RailTrack): string {
    const uuid = track.getUUID();
    this.trackMap.set(uuid, track);
    this.indexTrack(track);
    this.setupTrackConnections(track);
    return uuid;
  }

  addJunction(junction: Junction): string {
    const uuid = junction.getUUID();
    this.junctionMap.set(uuid, junction);
    this.setupTrackConnections(junction);
    return uuid;
  }

  removeTrack(uuid: string): boolean {
    const track = this.trackMap.get(uuid);
    if (!track) return false;
    this.deindexTrack(track);
    track.destroy();
    this.trackMap.delete(uuid);
    this.visibleTracks.delete(uuid);
    return true;
  }

  getTrack(uuid: string): RailTrack | undefined {
    return this.trackMap.get(uuid);
  }

  getAllTracks(): RailTrack[] {
    return Array.from(this.trackMap.values());
  }

  getVisibleTracks(): RailTrack[] {
    return Array.from(this.visibleTracks)
      .map((uuid) => this.trackMap.get(uuid))
      .filter((track): track is RailTrack => track !== undefined);
  }

  createStraightTrack(start: Vector2Like, end: Vector2Like): string {
    const startVec = new Phaser.Math.Vector2(start.x, start.y);
    const endVec = new Phaser.Math.Vector2(end.x, end.y);
    const track = new RailTrack(this.scene, startVec, startVec, endVec, endVec);
    return this.addTrack(track);
  }

  createCurvedTrack(start: Vector2Like, control1: Vector2Like, control2: Vector2Like, end: Vector2Like): string {
    const track = new RailTrack(
      this.scene,
      new Phaser.Math.Vector2(start.x, start.y),
      new Phaser.Math.Vector2(control1.x, control1.y),
      new Phaser.Math.Vector2(control2.x, control2.y),
      new Phaser.Math.Vector2(end.x, end.y)
    );
    return this.addTrack(track);
  }

  createCircularTrack(center: Vector2Like, radius: number, segments: number = 8): string[] {
    const trackUUIDs: string[] = [];
    const angleStep = (Math.PI * 2) / segments;
    const centerVec = new Phaser.Math.Vector2(center.x, center.y);

    for (let i = 0; i < segments; i++) {
      const startAngle = i * angleStep;
      const endAngle = (i + 1) * angleStep;
      const start = new Phaser.Math.Vector2(centerVec.x + Math.cos(startAngle) * radius, centerVec.y + Math.sin(startAngle) * radius);
      const end = new Phaser.Math.Vector2(centerVec.x + Math.cos(endAngle) * radius, centerVec.y + Math.sin(endAngle) * radius);
      const controlRadius = radius * 0.552284749831;
      const control1 = new Phaser.Math.Vector2(start.x - Math.sin(startAngle) * controlRadius, start.y + Math.cos(startAngle) * controlRadius);
      const control2 = new Phaser.Math.Vector2(end.x - Math.sin(endAngle) * controlRadius, end.y + Math.cos(endAngle) * controlRadius);
      const uuid = this.createCurvedTrack(start, control1, control2, end);
      trackUUIDs.push(uuid);
    }

    return trackUUIDs;
  }

  createJunction(trackUUID: string, position: number): Junction | null {
    const track = this.trackMap.get(trackUUID);
    if (!track) return null;

    const mainPath = track.getCurvePath();
    const junctionPoint = mainPath.getPoint(position);
    const mainTangent = mainPath.getTangent(position);
    const mainAngle = Math.atan2(mainTangent.y, mainTangent.x);
    const length = GameConfig.JUNCTION.LENGTH;
    const leftAngle = Phaser.Math.DegToRad(GameConfig.JUNCTION.LEFT_ANGLE_DEG);
    const rightAngle = Phaser.Math.DegToRad(GameConfig.JUNCTION.RIGHT_ANGLE_DEG);

    const leftEnd = new Phaser.Math.Vector2(junctionPoint.x + Math.cos(mainAngle + leftAngle) * length, junctionPoint.y + Math.sin(mainAngle + leftAngle) * length);
    const leftControl1 = new Phaser.Math.Vector2(junctionPoint.x + Math.cos(mainAngle + leftAngle * 0.5) * length * 0.3, junctionPoint.y + Math.sin(mainAngle + leftAngle * 0.5) * length * 0.3);
    const leftControl2 = new Phaser.Math.Vector2(leftEnd.x - Math.cos(mainAngle + leftAngle) * length * 0.3, leftEnd.y - Math.sin(mainAngle + leftAngle) * length * 0.3);
    const leftTrack = new RailTrack(this.scene, junctionPoint, leftControl1, leftControl2, leftEnd);

    const rightEnd = new Phaser.Math.Vector2(junctionPoint.x + Math.cos(mainAngle + rightAngle) * length, junctionPoint.y + Math.sin(mainAngle + rightAngle) * length);
    const rightControl1 = new Phaser.Math.Vector2(junctionPoint.x + Math.cos(mainAngle + rightAngle * 0.5) * length * 0.3, junctionPoint.y + Math.sin(mainAngle + rightAngle * 0.5) * length * 0.3);
    const rightControl2 = new Phaser.Math.Vector2(rightEnd.x - Math.cos(mainAngle + rightAngle) * length * 0.3, rightEnd.y - Math.sin(mainAngle + rightAngle) * length * 0.3);
    const rightTrack = new RailTrack(this.scene, junctionPoint, rightControl1, rightControl2, rightEnd);

    this.addTrack(leftTrack);
    this.addTrack(rightTrack);

    const junction = new Junction(this.scene, track, leftTrack, rightTrack, position);
    this.addJunction(junction);
    return junction;
  }

  getJunctionsForTrack(track: RailTrack): Junction[] {
    return Array.from(this.junctionMap.values()).filter((junction) => junction.getAllTracks().indexOf(track) !== -1);
  }

  getClosestTrack(point: Vector2Like, limit: number = 0, currentTrack?: RailTrack): RailTrack | null {
    let closestTrack: RailTrack | null = null;
    let closestDistance = Infinity;
    const tempTrackable = new Phaser.GameObjects.Sprite(this.scene, point.x, point.y, '');

    for (const track of this.trackMap.values()) {
      const junctions = this.getJunctionsForTrack(track);
      const isBranchTrack = junctions.some((junction) => {
        const activeBranch = junction.getActiveBranchTrack();
        const inactiveBranch = junction.getInactiveBranchTrack();
        return track === activeBranch || track === inactiveBranch;
      });

      if (isBranchTrack) {
        const isActive = junctions.some((junction) => track === junction.getActiveBranchTrack());
        if (!isActive && track !== currentTrack) {
          continue;
        }
      }

      const trackPoint = track.getTrackPoint(tempTrackable);
      const distance = new Phaser.Math.Vector2(trackPoint.x - point.x, trackPoint.y - point.y).length();
      if (distance < closestDistance && (!limit || distance < limit)) {
        closestDistance = distance;
        closestTrack = track;
      }
    }

    tempTrackable.destroy();
    return closestTrack;
  }

  getTracksInRadius(position: Vector2Like, radius: number): RailTrack[] {
    const posVec = new Phaser.Math.Vector2(position.x, position.y);
    return this.getVisibleTracks().filter((track) => posVec.distance(track.getCurvePath().getPoint(0.5)) <= radius);
  }

  updateVisibleTracks(cameraViewBounds: Phaser.Geom.Rectangle): void {
    this.visibleTracks.clear();
    for (const [uuid, track] of this.trackMap) {
      const trackBounds = track.getBounds();
      if (Phaser.Geom.Rectangle.Overlaps(cameraViewBounds, trackBounds)) {
        this.visibleTracks.add(uuid);
      }
    }
  }
}
