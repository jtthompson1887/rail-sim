import Junction from '../../entities/Junction';
import RailTrack from '../../entities/RailTrack';
import { trackEndpointSide, type TrackPort } from '../../entities/TrackPort';
import type { RouteResolver, RouteTrack, TrackEndpointSide, TravelDirection } from '../RouteCursor';

interface ConnectedTrack { track: RailTrack; port: TrackPort }

/** Concrete Phaser topology lives at the presentation boundary. */
export class TrackGraphRouteResolver implements RouteResolver {
  private readonly tracksByUUID = new Map<string, RailTrack>();

  constructor(tracks: readonly RailTrack[], private readonly junctions: readonly Junction[] = []) {
    tracks.forEach((track) => this.tracksByUUID.set(track.getUUID(), track));
  }

  trackByUUID(uuid: string): RailTrack | null { return this.tracksByUUID.get(uuid) ?? null; }

  continuation(track: RouteTrack, exit: TrackEndpointSide, preferredTrackUUID?: string): { track: RailTrack; direction: TravelDirection } | null {
    const graphTrack = this.tracksByUUID.get(track.getUUID());
    if (!graphTrack) return null;
    const connected = this.connectedTracks(graphTrack.getPort(exit)).filter((candidate) => candidate.track !== graphTrack);
    if (connected.length === 0) return null;
    let chosen = preferredTrackUUID ? connected.find((candidate) => candidate.track.getUUID() === preferredTrackUUID) : undefined;
    if (!chosen && connected.length === 1) [chosen] = connected;
    if (!chosen) {
      for (const junction of this.junctions) {
        if (junction.getAllTracks().indexOf(graphTrack) === -1) continue;
        chosen = connected.find((candidate) => candidate.track === junction.getRoutedContinuation(graphTrack));
        if (chosen) break;
      }
    }
    if (!chosen) return null;
    const side = trackEndpointSide(chosen.port);
    return side ? { track: chosen.track, direction: side === 'start' ? 1 : -1 } : null;
  }

  private connectedTracks(port: TrackPort): ConnectedTrack[] {
    return [...port.connections].filter((candidate) => candidate.owner.isTrack() && trackEndpointSide(candidate))
      .map((candidate) => ({ track: candidate.owner as RailTrack, port: candidate }));
  }
}
