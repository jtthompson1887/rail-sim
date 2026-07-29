import Junction from '../entities/Junction';
import RailTrack from '../entities/RailTrack';
import {
  trackEndpointSide,
  type TrackEndpointSide,
  type TrackPort,
} from '../entities/TrackPort';
import type { VerticalProfileDef } from '../config/WorldData';
import type { TrackPose } from './TrackArcLengthIndex';
import type { TrackArcLengthIndex } from './TrackArcLengthIndex';

export type TravelDirection = 1 | -1;

export interface RouteCursorState {
  trackUUID: string;
  distance: number;
  direction: TravelDirection;
}

export interface RouteTrack {
  getUUID(): string;
  getArcLengthIndex(): TrackArcLengthIndex;
  readonly verticalProfile: VerticalProfileDef | null;
}

export interface RouteResolver {
  trackByUUID(uuid: string): RouteTrack | null;
  continuation(
    track: RouteTrack,
    exit: TrackEndpointSide,
    preferredTrackUUID?: string,
  ): { track: RouteTrack; direction: TravelDirection } | null;
}

export type RouteTraversalErrorCode = 'route-cycle' | 'route-missing-track';

export class RouteTraversalError extends Error {
  constructor(readonly code: RouteTraversalErrorCode, message: string) {
    super(message);
    this.name = 'RouteTraversalError';
  }
}

function opposite(direction: TravelDirection): TravelDirection {
  return direction === 1 ? -1 : 1;
}

function clampDistance(track: RouteTrack, distance: number): number {
  return Math.max(0, Math.min(track.getArcLengthIndex().length, distance));
}

export class RouteCursor {
  private readonly currentState: RouteCursorState;

  constructor(
    state: RouteCursorState,
    private readonly resolver: RouteResolver,
  ) {
    const track = resolver.trackByUUID(state.trackUUID);
    if (!track) {
      throw new RouteTraversalError(
        'route-missing-track',
        `Route track "${state.trackUUID}" does not exist`,
      );
    }
    if (!Number.isFinite(state.distance)) {
      throw new Error('Route cursor distance must be finite');
    }
    this.currentState = {
      trackUUID: state.trackUUID,
      distance: clampDistance(track, state.distance),
      direction: state.direction,
    };
  }

  get state(): Readonly<RouteCursorState> {
    return { ...this.currentState };
  }

  pose(): TrackPose {
    const track = this.requireTrack(this.currentState.trackUUID);
    const pose = track.getArcLengthIndex().poseAtDistance(this.currentState.distance);
    if (this.currentState.direction === 1) return pose;
    return {
      point: pose.point,
      tangent: { x: -pose.tangent.x, y: -pose.tangent.y },
      curvature: -pose.curvature,
    };
  }

  movedBy(deltaDistance: number, preferredTrackUUID?: string): RouteCursor {
    if (!Number.isFinite(deltaDistance)) {
      throw new Error('Route movement distance must be finite');
    }
    if (deltaDistance === 0) {
      return new RouteCursor(this.currentState, this.resolver);
    }

    const followsCursorDirection = deltaDistance > 0;
    let travelDirection = followsCursorDirection
      ? this.currentState.direction
      : opposite(this.currentState.direction);
    let remaining = Math.abs(deltaDistance);
    let track = this.requireTrack(this.currentState.trackUUID);
    let distance = this.currentState.distance;
    let portTraversals = 0;

    while (remaining > 0) {
      const trackLength = track.getArcLengthIndex().length;
      const available = travelDirection === 1 ? trackLength - distance : distance;
      if (remaining <= available) {
        distance += travelDirection * remaining;
        remaining = 0;
        break;
      }

      remaining -= available;
      distance = travelDirection === 1 ? trackLength : 0;
      const exit: TrackEndpointSide = travelDirection === 1 ? 'end' : 'start';
      const continuation = this.resolver.continuation(track, exit, preferredTrackUUID);
      if (!continuation) {
        remaining = 0;
        break;
      }

      portTraversals += 1;
      if (portTraversals > 64) {
        throw new RouteTraversalError(
          'route-cycle',
          'Route movement crossed more than 64 ports in one step',
        );
      }
      track = continuation.track;
      travelDirection = continuation.direction;
      distance = travelDirection === 1 ? 0 : track.getArcLengthIndex().length;
    }

    const direction = followsCursorDirection
      ? travelDirection
      : opposite(travelDirection);
    return new RouteCursor({
      trackUUID: track.getUUID(),
      distance,
      direction,
    }, this.resolver);
  }

  private requireTrack(uuid: string): RouteTrack {
    const track = this.resolver.trackByUUID(uuid);
    if (!track) {
      throw new RouteTraversalError('route-missing-track', `Route track "${uuid}" does not exist`);
    }
    return track;
  }
}

interface ConnectedTrack {
  track: RailTrack;
  port: TrackPort;
}

export class TrackGraphRouteResolver implements RouteResolver {
  private readonly tracksByUUID = new Map<string, RailTrack>();

  constructor(
    tracks: readonly RailTrack[],
    private readonly junctions: readonly Junction[] = [],
  ) {
    tracks.forEach((track) => this.tracksByUUID.set(track.getUUID(), track));
  }

  trackByUUID(uuid: string): RailTrack | null {
    return this.tracksByUUID.get(uuid) ?? null;
  }

  continuation(
    track: RouteTrack,
    exit: TrackEndpointSide,
    preferredTrackUUID?: string,
  ): { track: RailTrack; direction: TravelDirection } | null {
    const graphTrack = this.tracksByUUID.get(track.getUUID());
    if (!graphTrack) return null;
    const connected = this.connectedTracks(graphTrack.getPort(exit))
      .filter((candidate) => candidate.track !== graphTrack);
    if (connected.length === 0) return null;

    let chosen = preferredTrackUUID
      ? connected.find((candidate) => candidate.track.getUUID() === preferredTrackUUID)
      : undefined;
    if (!chosen && connected.length === 1) {
      [chosen] = connected;
    }
    if (!chosen) {
      for (const junction of this.junctions) {
        if (junction.getAllTracks().indexOf(graphTrack) === -1) continue;
        const routedTrack = junction.getRoutedContinuation(graphTrack);
        chosen = connected.find((candidate) => candidate.track === routedTrack);
        if (chosen) break;
      }
    }
    if (!chosen) return null;

    const side = trackEndpointSide(chosen.port);
    if (!side) return null;
    return {
      track: chosen.track,
      direction: side === 'start' ? 1 : -1,
    };
  }

  private connectedTracks(port: TrackPort): ConnectedTrack[] {
    const connected: ConnectedTrack[] = [];
    for (const candidatePort of port.connections) {
      if (!candidatePort.owner.isTrack()) continue;
      if (!trackEndpointSide(candidatePort)) continue;
      connected.push({ track: candidatePort.owner, port: candidatePort });
    }
    return connected;
  }
}
