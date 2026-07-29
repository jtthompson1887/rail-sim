import type { TrackNode } from './TrackNode';

/**
 * TrackPort – represents a connection endpoint on a track segment.
 *
 * Each track has a `startPort` and `endPort`. Ports hold references to their
 * connected counterparts, making the track graph deterministic and eliminating
 * the need for proximity-based heuristics during connection setup.
 */
export interface TrackPort {
  /** The owning TrackNode (RailTrack or Junction). */
  readonly owner: TrackNode;
  /** World-space position of this port (mutable for track reshape updates). */
  position: { x: number; y: number };
  /** Identifier for this port ('start' | 'end' | 'branch-left' | 'branch-right'). */
  readonly id: string;
  /** Ports that are connected to this one. */
  readonly connections: TrackPort[];
}

export type TrackEndpointSide = 'start' | 'end';

export function trackEndpointSide(port: TrackPort): TrackEndpointSide | null {
  if (port.id === 'start' || port.id === 'end') return port.id;
  return null;
}

/**
 * Create a new TrackPort with the given owner, position, and id.
 */
export function createPort(owner: TrackNode, position: { x: number; y: number }, id: string): TrackPort {
  return {
    owner,
    position: { x: position.x, y: position.y },
    id,
    connections: [],
  };
}

/**
 * Connect two ports bidirectionally.
 */
export function connectPorts(a: TrackPort, b: TrackPort): void {
  if (a.connections.indexOf(b) === -1) a.connections.push(b);
  if (b.connections.indexOf(a) === -1) b.connections.push(a);
}

/**
 * Disconnect two ports bidirectionally.
 */
export function disconnectPorts(a: TrackPort, b: TrackPort): void {
  const ai = a.connections.indexOf(b);
  if (ai !== -1) a.connections.splice(ai, 1);
  const bi = b.connections.indexOf(a);
  if (bi !== -1) b.connections.splice(bi, 1);
}
