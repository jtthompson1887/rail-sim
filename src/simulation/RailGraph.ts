import type { TrackDef, JunctionDef, WorldStationDef } from '../config/WorldData';
import type { FacilityEconomyDef } from '../economy/EconomyData';
import type { RouteResolver, RouteTrack, TrackEndpointSide, TravelDirection } from '../physics/RouteCursor';
import { TrackArcLengthIndex } from '../physics/TrackArcLengthIndex';

export interface RailLocation { trackUUID: string; distance: number }
export interface RailRouteLeg extends RailLocation { endDistance: number; direction: TravelDirection }
export interface RailRoute { legs: RailRouteLeg[]; length: number; junctionIds: string[]; occupiedTrackUUIDs: string[] }
interface GraphEdge { to: string; length: number; leg?: RailRouteLeg; junctionId?: string }

class RouteFrontier {
  private readonly entries: Array<{ id: string; distance: number }> = [];
  private before(a: { id: string; distance: number }, b: { id: string; distance: number }): boolean {
    return a.distance < b.distance || (a.distance === b.distance && a.id < b.id);
  }
  push(entry: { id: string; distance: number }): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.before(this.entries[index], this.entries[parent])) break;
      [this.entries[index], this.entries[parent]] = [this.entries[parent], this.entries[index]];
      index = parent;
    }
  }
  pop(): { id: string; distance: number } | null {
    if (!this.entries.length) return null;
    const first = this.entries[0];
    const last = this.entries.pop();
    if (this.entries.length) {
      this.entries[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1, right = left + 1;
        let best = index;
        if (left < this.entries.length && this.before(this.entries[left], this.entries[best])) best = left;
        if (right < this.entries.length && this.before(this.entries[right], this.entries[best])) best = right;
        if (best === index) break;
        [this.entries[index], this.entries[best]] = [this.entries[best], this.entries[index]];
        index = best;
      }
    }
    return first;
  }
}

class DataTrack implements RouteTrack {
  readonly index: TrackArcLengthIndex;
  readonly verticalProfile: TrackDef['verticalProfile'];
  private readonly bounds: {minX:number;minY:number;maxX:number;maxY:number};
  constructor(readonly definition: TrackDef) {
    this.index = new TrackArcLengthIndex(definition, 4);
    this.verticalProfile = definition.verticalProfile;
    const points=[definition.p0,definition.p1,definition.p2,definition.p3];
    this.bounds={minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),
      maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y))};
  }
  getUUID(): string { return this.definition.uuid; }
  getArcLengthIndex(): TrackArcLengthIndex { return this.index; }
  minimumDistanceTo(point:{x:number;y:number}):number{
    const x=Math.max(this.bounds.minX,Math.min(this.bounds.maxX,point.x));
    const y=Math.max(this.bounds.minY,Math.min(this.bounds.maxY,point.y));
    return Math.hypot(point.x-x,point.y-y);
  }
}

/** A deterministic, renderer-independent graph. Crossing rails connect only at ports. */
export class RailGraph implements RouteResolver {
  private readonly tracks = new Map<string, DataTrack>();
  private readonly anchors = new Map<string, Array<{ id: string; distance: number }>>();
  private readonly edges = new Map<string, GraphEdge[]>();
  private readonly endpointConnections = new Map<string, Array<{ track: DataTrack; direction: TravelDirection }>>();

  constructor(trackDefs: readonly TrackDef[], junctions: readonly JunctionDef[] = []) {
    [...trackDefs].sort((a, b) => a.uuid.localeCompare(b.uuid)).forEach((definition) => {
      const track = new DataTrack(definition);
      this.tracks.set(definition.uuid, track);
      this.addAnchor(definition.uuid, 0);
      this.addAnchor(definition.uuid, track.index.length);
    });
    const endpoints = [...this.tracks.values()].flatMap((track) => [
      { track, distance: 0, point: track.definition.p0, side: 'start' as const },
      { track, distance: track.index.length, point: track.definition.p3, side: 'end' as const },
    ]);
    for (let index = 0; index < endpoints.length; index += 1) {
      const left = endpoints[index];
      for (let next = index + 1; next < endpoints.length; next += 1) {
        const right = endpoints[next];
        if (left.track === right.track || Math.hypot(left.point.x - right.point.x, left.point.y - right.point.y) > 0.1) continue;
        if (Math.abs(this.elevationAt(left.track, left.distance) - this.elevationAt(right.track, right.distance)) > 0.1) continue;
        const declaredTurnout = junctions.some((junction) => {
          const members = [junction.mainTrackUUID, junction.leftTrackUUID, junction.rightTrackUUID];
          const main = this.tracks.get(junction.mainTrackUUID);
          if (!main || !members.includes(left.track.getUUID()) || !members.includes(right.track.getUUID())) return false;
          const point = main.index.poseAtDistance(main.index.distanceAtParameter(junction.position)).point;
          return Math.hypot(point.x - left.point.x, point.y - left.point.y) <= 0.1;
        });
        if (declaredTurnout) continue;
        this.connectAnchors(left.track, left.distance, right.track, right.distance);
        this.addEndpointConnection(left.track, left.side, right.track, right.side);
        this.addEndpointConnection(right.track, right.side, left.track, left.side);
      }
    }
    [...junctions].sort((a, b) => a.uuid.localeCompare(b.uuid)).forEach((junction) => {
      const main = this.tracks.get(junction.mainTrackUUID);
      if (!main) return;
      const mainDistance = main.index.distanceAtParameter(junction.position);
      const point = main.index.poseAtDistance(mainDistance).point;
      for (const branchId of [junction.leftTrackUUID, junction.rightTrackUUID]) {
        const branch = this.tracks.get(branchId);
        if (!branch) continue;
        const branchDistance = Math.hypot(point.x - branch.definition.p0.x, point.y - branch.definition.p0.y)
          <= Math.hypot(point.x - branch.definition.p3.x, point.y - branch.definition.p3.y) ? 0 : branch.index.length;
        const branchPoint = branch.index.poseAtDistance(branchDistance).point;
        // Serialized junctions must never authorize a teleport between disconnected rails.
        if (Math.hypot(point.x - branchPoint.x, point.y - branchPoint.y) > 0.1) continue;
        this.connectAnchors(main, mainDistance, branch, branchDistance, junction.uuid);
        const mainSide = mainDistance <= 0.1 ? 'start' : main.index.length - mainDistance <= 0.1 ? 'end' : null;
        if (mainSide) {
          const branchSide = branchDistance === 0 ? 'start' : 'end';
          this.addEndpointConnection(main, mainSide, branch, branchSide);
          this.addEndpointConnection(branch, branchSide, main, mainSide);
        }
      }
    });
    this.anchors.forEach((anchors, trackUUID) => {
      anchors.sort((a, b) => a.distance - b.distance);
      for (let index = 1; index < anchors.length; index += 1) {
        this.connectAlongTrack(trackUUID, anchors[index - 1], anchors[index]);
      }
    });
  }

  trackByUUID(uuid: string): DataTrack | null { return this.tracks.get(uuid) ?? null; }

  continuation(track: RouteTrack, exit: TrackEndpointSide, preferredTrackUUID?: string): { track: DataTrack; direction: TravelDirection } | null {
    const options = this.endpointConnections.get(`${track.getUUID()}:${exit}`) ?? [];
    return options.find((option) => option.track.getUUID() === preferredTrackUUID)
      ?? (options.length === 1 ? options[0] : null);
  }

  stationLocation(station: WorldStationDef): RailLocation | null {
    const track = this.tracks.get(station.trackUUID);
    return track ? { trackUUID: station.trackUUID, distance: track.index.distanceAtParameter(station.trackT) } : null;
  }

  facilityLocation(facility: FacilityEconomyDef): RailLocation | null {
    return this.nearestLocation(facility.railAccess, facility.railAccess.radius);
  }

  nearestLocation(point: { x: number; y: number }, maximumDistance = Infinity): RailLocation | null {
    let nearest: RailLocation = null;
    let best = maximumDistance;
    this.tracks.forEach((track) => {
      // A cubic is contained by its control-point bounds; distant rails need no arc projection.
      if(track.minimumDistanceTo(point)>best)return;
      const distance = track.index.distanceForPoint(point);
      const pose = track.index.poseAtDistance(distance);
      const offset = Math.hypot(point.x - pose.point.x, point.y - pose.point.y);
      if (offset <= best) { best = offset; nearest = { trackUUID: track.getUUID(), distance }; }
    });
    return nearest;
  }

  parameterAt(location: RailLocation): number {
    const track = this.tracks.get(location.trackUUID);
    if (!track) return 0;
    let low = 0;
    let high = 1;
    for (let index = 0; index < 24; index += 1) {
      const mid = (low + high) / 2;
      if (track.index.distanceAtParameter(mid) < location.distance) low = mid;
      else high = mid;
    }
    return location.distance <= 0 ? 0 : location.distance >= track.index.length ? 1 : (low + high) / 2;
  }

  gradeAt(location: RailLocation, direction: TravelDirection): number {
    const track = this.tracks.get(location.trackUUID);
    if (!track) return 0;
    const a = Math.max(0, location.distance - 2);
    const b = Math.min(track.index.length, location.distance + 2);
    return b > a ? direction * (this.elevationAt(track, b) - this.elevationAt(track, a)) / (b - a) : 0;
  }

  /** Conservative body occupancy includes adjoining sections at points and sharp junctions. */
  tracksOccupiedByBody(location: RailLocation, lengthWorldUnits: number): ReadonlySet<string> {
    const occupied = new Set<string>([location.trackUUID]);
    const queue: Array<{ trackUUID: string; side: TrackEndpointSide; distance: number }> = [];
    const current = this.tracks.get(location.trackUUID);
    if (!current || lengthWorldUnits <= 0) return occupied;
    const half = lengthWorldUnits / 2;
    if (location.distance < half) queue.push({ trackUUID: location.trackUUID, side: 'start', distance: half - location.distance });
    if (current.index.length - location.distance < half) queue.push({ trackUUID: location.trackUUID, side: 'end', distance: half - (current.index.length - location.distance) });
    const visited = new Set<string>();
    for (let index = 0; index < queue.length && index < 200; index += 1) {
      const section = queue[index];
      const key = `${section.trackUUID}:${section.side}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const connection of this.endpointConnections.get(key) ?? []) {
        const trackUUID = connection.track.getUUID();
        occupied.add(trackUUID);
        const remaining = section.distance - connection.track.index.length;
        if (remaining > 0) queue.push({ trackUUID, side: connection.direction === 1 ? 'end' : 'start', distance: remaining });
      }
    }
    return occupied;
  }

  shortestRoute(from: RailLocation, to: RailLocation, initialDirection?: TravelDirection, unavailableTracks: ReadonlySet<string> = new Set()): RailRoute | null {
    if (!this.tracks.has(from.trackUUID) || !this.tracks.has(to.trackUUID)) return null;
    const extra = new Map<string, GraphEdge[]>();
    const attach = (id: string, location: RailLocation) => {
      for (const anchor of this.anchors.get(location.trackUUID) ?? []) {
        const length = Math.abs(anchor.distance - location.distance);
        const leg: RailRouteLeg = { ...location, endDistance: anchor.distance, direction: anchor.distance >= location.distance ? 1 : -1 };
        extra.set(id, [...(extra.get(id) ?? []), { to: anchor.id, length, leg }]);
        const reverse: RailRouteLeg = { trackUUID: location.trackUUID, distance: anchor.distance, endDistance: location.distance, direction: leg.direction === 1 ? -1 : 1 };
        extra.set(anchor.id, [...(extra.get(anchor.id) ?? []), { to: id, length, leg: reverse }]);
      }
    };
    attach('@source', from);
    attach('@target', to);
    if (from.trackUUID === to.trackUUID) {
      const leg: RailRouteLeg = { ...from, endDistance: to.distance, direction: to.distance >= from.distance ? 1 : -1 };
      extra.set('@source', [...(extra.get('@source') ?? []), { to: '@target', length: Math.abs(to.distance - from.distance), leg }]);
    }
    interface TraversalState { node: string; lastTrack: string | null; direction: TravelDirection | null; lastJunction: string | null }
    const stateKey = (state: TraversalState) => JSON.stringify([state.node, state.lastTrack, state.direction, state.lastJunction]);
    const initialState: TraversalState = { node: '@source', lastTrack: initialDirection ? from.trackUUID : null,
      direction: initialDirection ?? null, lastJunction: null };
    const initialKey = stateKey(initialState);
    const traversalStates = new Map<string, TraversalState>([[initialKey, initialState]]);
    const distances = new Map<string, number>([[initialKey, 0]]);
    const previous = new Map<string, { from: string; edge: GraphEdge }>();
    const visited = new Set<string>();
    const frontier = new RouteFrontier();
    frontier.push({ id: initialKey, distance: 0 });
    let targetKey: string = null;
    while (true) {
      const next = frontier.pop();
      if (!next) return null;
      const current = next.id, nearest = next.distance;
      if (visited.has(current) || nearest !== distances.get(current)) continue;
      const traversal = traversalStates.get(current);
      if (traversal.node === '@target') { targetKey = current; break; }
      visited.add(current);
      for (const edge of [...(this.edges.get(traversal.node) ?? []), ...(extra.get(traversal.node) ?? [])]) {
        if (edge.leg && edge.length > 1e-7 && unavailableTracks.has(edge.leg.trackUUID)) continue;
        if (edge.junctionId && edge.junctionId === traversal.lastJunction) continue;
        if (edge.leg && edge.length > 1e-7 && edge.leg.trackUUID === traversal.lastTrack && edge.leg.direction !== traversal.direction) continue;
        const moves = edge.leg && edge.length > 1e-7;
        const nextTraversal: TraversalState = { node: edge.to,
          lastTrack: moves ? edge.leg.trackUUID : traversal.lastTrack,
          direction: moves ? edge.leg.direction : traversal.direction,
          lastJunction: moves ? null : edge.junctionId ?? traversal.lastJunction };
        const nextKey = stateKey(nextTraversal);
        const candidate = nearest + edge.length;
        if (candidate < (distances.get(nextKey) ?? Infinity)) {
          distances.set(nextKey, candidate); previous.set(nextKey, { from: current, edge }); traversalStates.set(nextKey, nextTraversal);
          frontier.push({ id: nextKey, distance: candidate });
        }
      }
    }
    const routeEdges: GraphEdge[] = [];
    let cursor = targetKey;
    while (cursor !== initialKey) {
      const prior = previous.get(cursor);
      if (!prior) return null;
      routeEdges.unshift(prior.edge); cursor = prior.from;
    }
    return { legs: routeEdges.filter((edge) => edge.leg && edge.length > 1e-7).map((edge) => ({ ...edge.leg })),
      occupiedTrackUUIDs: [...new Set([from.trackUUID, to.trackUUID, ...routeEdges.filter((edge) => edge.leg).map((edge) => edge.leg.trackUUID)])],
      length: distances.get(targetKey), junctionIds: [...new Set(routeEdges.map((edge) => edge.junctionId).filter(Boolean))] };
  }

  private addAnchor(trackUUID: string, distance: number): { id: string; distance: number } {
    const anchors = this.anchors.get(trackUUID) ?? [];
    const existing = anchors.find((anchor) => Math.abs(anchor.distance - distance) < 1e-6);
    if (existing) return existing;
    const anchor = { id: `${trackUUID}@${distance.toFixed(6)}`, distance };
    anchors.push(anchor); this.anchors.set(trackUUID, anchors); this.edges.set(anchor.id, []);
    return anchor;
  }

  private connectAnchors(a: DataTrack, aDistance: number, b: DataTrack, bDistance: number, junctionId?: string): void {
    const left = this.addAnchor(a.getUUID(), aDistance);
    const right = this.addAnchor(b.getUUID(), bDistance);
    this.edges.get(left.id).push({ to: right.id, length: 0, junctionId });
    this.edges.get(right.id).push({ to: left.id, length: 0, junctionId });
  }

  private connectAlongTrack(trackUUID: string, left: { id: string; distance: number }, right: { id: string; distance: number }): void {
    const length = right.distance - left.distance;
    this.edges.get(left.id).push({ to: right.id, length, leg: { trackUUID, distance: left.distance, endDistance: right.distance, direction: 1 } });
    this.edges.get(right.id).push({ to: left.id, length, leg: { trackUUID, distance: right.distance, endDistance: left.distance, direction: -1 } });
  }

  private addEndpointConnection(track: DataTrack, exit: TrackEndpointSide, next: DataTrack, entry: TrackEndpointSide): void {
    const key = `${track.getUUID()}:${exit}`;
    const list = this.endpointConnections.get(key) ?? [];
    if (!list.some((candidate) => candidate.track === next)) list.push({ track: next, direction: entry === 'start' ? 1 : -1 });
    this.endpointConnections.set(key, list);
  }

  private elevationAt(track: DataTrack, distance: number): number {
    const knots = track.verticalProfile.knots;
    const index = track.index;
    for (let knot = 1; knot < knots.length; knot += 1) {
      const end = knots[knot];
      const start = knots[knot - 1];
      const startDistance = index.distanceAtParameter(start.t);
      const endDistance = index.distanceAtParameter(end.t);
      if (distance <= endDistance) return start.elevation + (end.elevation - start.elevation)
        * Math.max(0, Math.min(1, (distance - startDistance) / Math.max(1e-9, endDistance - startDistance)));
    }
    return knots[knots.length - 1].elevation;
  }
}
