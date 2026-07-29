import type { TrackDef } from '../config/WorldData';
import type { TrackTopologySnapshot } from '../managers/TrackManager';

export interface RailAccessRing {
  readonly facilityId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface RailAccessConnectivityResult {
  readonly connected: boolean;
  readonly sourceEndpointTrackUUIDs: readonly string[];
  readonly destinationEndpointTrackUUIDs: readonly string[];
  readonly connectedTrackUUIDs: readonly string[];
}

function nodeKey(kind: 'track' | 'junction', uuid: string): string {
  return `${kind}:${uuid}`;
}

function endpointTrackUUIDs(
  tracks: readonly TrackDef[],
  ring: RailAccessRing,
): string[] {
  return tracks
    .filter((track) => [track.p0, track.p3].some((endpoint) => (
      Math.hypot(endpoint.x - ring.x, endpoint.y - ring.y) <= ring.radius
    )))
    .map((track) => track.uuid)
    .sort((left, right) => left.localeCompare(right));
}

export function queryRailAccessConnectivity(
  tracks: readonly TrackDef[],
  topology: TrackTopologySnapshot,
  source: RailAccessRing,
  destination: RailAccessRing,
): RailAccessConnectivityResult {
  const sourceEndpointTrackUUIDs = endpointTrackUUIDs(tracks, source);
  const destinationEndpointTrackUUIDs = endpointTrackUUIDs(tracks, destination);
  const destinationKeys = new Set(
    destinationEndpointTrackUUIDs.map((uuid) => nodeKey('track', uuid)),
  );
  const adjacency = new Map<string, Set<string>>();

  for (const node of topology) {
    adjacency.set(nodeKey(node.kind, node.uuid), new Set());
  }
  for (const node of topology) {
    const key = nodeKey(node.kind, node.uuid);
    for (const reference of [node.previous, node.next]) {
      if (!reference) continue;
      const referenceKey = nodeKey(reference.kind, reference.uuid);
      if (!adjacency.has(referenceKey)) continue;
      adjacency.get(key)!.add(referenceKey);
      adjacency.get(referenceKey)!.add(key);
    }
  }

  const completedComponents = new Set<string>();
  const connectedTrackUUIDs = new Set<string>();
  let connected = false;

  for (const sourceUUID of sourceEndpointTrackUUIDs) {
    const sourceKey = nodeKey('track', sourceUUID);
    if (!adjacency.has(sourceKey) || completedComponents.has(sourceKey)) continue;

    const component = new Set<string>([sourceKey]);
    const queue = [sourceKey];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const neighbour of adjacency.get(current)!) {
        if (component.has(neighbour)) continue;
        component.add(neighbour);
        queue.push(neighbour);
      }
    }
    for (const key of component) completedComponents.add(key);

    if (![...component].some((key) => destinationKeys.has(key))) continue;
    connected = true;
    for (const key of component) {
      if (key.startsWith('track:')) {
        connectedTrackUUIDs.add(key.slice('track:'.length));
      }
    }
  }

  return {
    connected,
    sourceEndpointTrackUUIDs,
    destinationEndpointTrackUUIDs,
    connectedTrackUUIDs: [...connectedTrackUUIDs]
      .sort((left, right) => left.localeCompare(right)),
  };
}
