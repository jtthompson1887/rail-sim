import type { TrackDef } from '../../src/config/WorldData';
import type {
  TrackTopologyNodeRef,
  TrackTopologySnapshot,
} from '../../src/managers/TrackManager';
import {
  queryRailAccessConnectivity,
  type RailAccessRing,
} from '../../src/freight/RailAccessConnectivity';

function track(
  uuid: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  midpoint?: { x: number; y: number },
): TrackDef {
  const p1 = midpoint ?? {
    x: start.x + (end.x - start.x) / 3,
    y: start.y + (end.y - start.y) / 3,
  };
  const p2 = midpoint ?? {
    x: start.x + 2 * (end.x - start.x) / 3,
    y: start.y + 2 * (end.y - start.y) / 3,
  };
  return {
    uuid,
    geometryVersion: 1,
    p0: { ...start },
    p1: { ...p1 },
    p2: { ...p2 },
    p3: { ...end },
    verticalProfile: {
      profileVersion: 1,
      knots: [
        { t: 0, elevation: 0 },
        { t: 1, elevation: 0 },
      ],
    },
    structures: [],
    paidBuildCost: 0,
  };
}

const forestRing: RailAccessRing = {
  facilityId: 'managed-forest',
  x: 0,
  y: 0,
  radius: 10,
};

const sawmillRing: RailAccessRing = {
  facilityId: 'sawmill',
  x: 300,
  y: 0,
  radius: 10,
};

function ref(kind: 'track' | 'junction', uuid: string): TrackTopologyNodeRef {
  return { kind, uuid };
}

function topologyNode(
  kind: 'track' | 'junction',
  uuid: string,
  previous: TrackTopologyNodeRef | null = null,
  next: TrackTopologyNodeRef | null = null,
): TrackTopologySnapshot[number] {
  return { kind, uuid, previous, next };
}

describe('queryRailAccessConnectivity', () => {
  it('connects two access rings through one direct track', () => {
    const tracks = [track('direct', { x: 0, y: 0 }, { x: 300, y: 0 })];
    const topology = [topologyNode('track', 'direct')];

    expect(queryRailAccessConnectivity(
      tracks,
      topology,
      forestRing,
      sawmillRing,
    )).toEqual({
      connected: true,
      sourceEndpointTrackUUIDs: ['direct'],
      destinationEndpointTrackUUIDs: ['direct'],
      connectedTrackUUIDs: ['direct'],
    });
  });

  it('traverses a multi-track chain in either topology direction', () => {
    const tracks = [
      track('first', { x: 0, y: 0 }, { x: 100, y: 0 }),
      track('second', { x: 100, y: 0 }, { x: 200, y: 0 }),
      track('third', { x: 200, y: 0 }, { x: 300, y: 0 }),
    ];
    const topology = [
      topologyNode('track', 'third', ref('track', 'second')),
      topologyNode('track', 'first', null, ref('track', 'second')),
      topologyNode('track', 'second', ref('track', 'first'), ref('track', 'third')),
    ];

    expect(queryRailAccessConnectivity(
      tracks,
      topology,
      forestRing,
      sawmillRing,
    )).toEqual({
      connected: true,
      sourceEndpointTrackUUIDs: ['first'],
      destinationEndpointTrackUUIDs: ['third'],
      connectedTrackUUIDs: ['first', 'second', 'third'],
    });
  });

  it('traverses track and junction topology nodes', () => {
    const tracks = [
      track('forest-branch', { x: 0, y: 0 }, { x: 100, y: 0 }),
      track('sawmill-branch', { x: 200, y: 0 }, { x: 300, y: 0 }),
    ];
    const topology = [
      topologyNode('track', 'forest-branch', null, ref('junction', 'split')),
      topologyNode(
        'junction',
        'split',
        ref('track', 'forest-branch'),
        ref('track', 'sawmill-branch'),
      ),
      topologyNode('track', 'sawmill-branch', ref('junction', 'split')),
    ];

    expect(queryRailAccessConnectivity(
      tracks,
      topology,
      forestRing,
      sawmillRing,
    )).toEqual({
      connected: true,
      sourceEndpointTrackUUIDs: ['forest-branch'],
      destinationEndpointTrackUUIDs: ['sawmill-branch'],
      connectedTrackUUIDs: ['forest-branch', 'sawmill-branch'],
    });
  });

  it('does not connect two disconnected endpoint stubs', () => {
    const tracks = [
      track('forest-stub', { x: 0, y: 0 }, { x: 80, y: 0 }),
      track('sawmill-stub', { x: 220, y: 0 }, { x: 300, y: 0 }),
    ];
    const disconnectedTopology = [
      topologyNode('track', 'forest-stub'),
      topologyNode('track', 'sawmill-stub'),
    ];

    expect(queryRailAccessConnectivity(
      tracks,
      disconnectedTopology,
      forestRing,
      sawmillRing,
    )).toEqual({
      connected: false,
      sourceEndpointTrackUUIDs: ['forest-stub'],
      destinationEndpointTrackUUIDs: ['sawmill-stub'],
      connectedTrackUUIDs: [],
    });
  });

  it('excludes an orphan source-ring component beside a valid route', () => {
    const tracks = [
      track('orphan', { x: 0, y: 5 }, { x: 50, y: 5 }),
      track('route-a', { x: 0, y: 0 }, { x: 150, y: 0 }),
      track('route-b', { x: 150, y: 0 }, { x: 300, y: 0 }),
    ];
    const topology = [
      topologyNode('track', 'orphan'),
      topologyNode('track', 'route-b', ref('track', 'route-a')),
      topologyNode('track', 'route-a', null, ref('track', 'route-b')),
    ];

    expect(queryRailAccessConnectivity(
      tracks,
      topology,
      forestRing,
      sawmillRing,
    )).toEqual({
      connected: true,
      sourceEndpointTrackUUIDs: ['orphan', 'route-a'],
      destinationEndpointTrackUUIDs: ['route-b'],
      connectedTrackUUIDs: ['route-a', 'route-b'],
    });
  });

  it('does not treat midpoint-only access-ring overlap as an endpoint', () => {
    const tracks = [
      track(
        'midpoint-only',
        { x: -100, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 0 },
      ),
      track('destination', { x: 100, y: 0 }, { x: 300, y: 0 }),
    ];
    const topology = [
      topologyNode('track', 'midpoint-only', null, ref('track', 'destination')),
      topologyNode('track', 'destination', ref('track', 'midpoint-only')),
    ];

    expect(queryRailAccessConnectivity(
      tracks,
      topology,
      forestRing,
      sawmillRing,
    )).toEqual({
      connected: false,
      sourceEndpointTrackUUIDs: [],
      destinationEndpointTrackUUIDs: ['destination'],
      connectedTrackUUIDs: [],
    });
  });

  it('includes an endpoint exactly on the access radius boundary', () => {
    const boundaryTrack = track(
      'boundary',
      { x: forestRing.x + forestRing.radius, y: forestRing.y },
      { x: 300, y: 0 },
    );

    expect(queryRailAccessConnectivity(
      [boundaryTrack],
      [topologyNode('track', 'boundary')],
      forestRing,
      sawmillRing,
    )).toEqual({
      connected: true,
      sourceEndpointTrackUUIDs: ['boundary'],
      destinationEndpointTrackUUIDs: ['boundary'],
      connectedTrackUUIDs: ['boundary'],
    });
  });

  it('does not connect through a referenced topology node that is missing', () => {
    const tracks = [
      track('source', { x: 0, y: 0 }, { x: 100, y: 0 }),
      track('missing', { x: 100, y: 0 }, { x: 200, y: 0 }),
      track('destination', { x: 200, y: 0 }, { x: 300, y: 0 }),
    ];
    const topology = [
      topologyNode('track', 'source', null, ref('track', 'missing')),
      topologyNode('track', 'destination', ref('track', 'missing')),
    ];

    expect(queryRailAccessConnectivity(
      tracks,
      topology,
      forestRing,
      sawmillRing,
    )).toEqual({
      connected: false,
      sourceEndpointTrackUUIDs: ['source'],
      destinationEndpointTrackUUIDs: ['destination'],
      connectedTrackUUIDs: [],
    });
  });

  it('returns stable sorted endpoint and connected track UUIDs', () => {
    const tracks = [
      track('z-source', { x: 0, y: 1 }, { x: 100, y: 1 }),
      track('a-destination', { x: 200, y: 1 }, { x: 300, y: 1 }),
      track('m-middle', { x: 100, y: 1 }, { x: 200, y: 1 }),
      track('a-source', { x: 0, y: -1 }, { x: 100, y: -1 }),
      track('z-destination', { x: 200, y: -1 }, { x: 300, y: -1 }),
    ];
    const topology = [
      topologyNode('track', 'z-destination', ref('track', 'a-destination')),
      topologyNode('track', 'z-source', null, ref('track', 'a-source')),
      topologyNode(
        'track',
        'm-middle',
        ref('track', 'a-source'),
        ref('track', 'a-destination'),
      ),
      topologyNode(
        'track',
        'a-destination',
        ref('track', 'm-middle'),
        ref('track', 'z-destination'),
      ),
      topologyNode(
        'track',
        'a-source',
        ref('track', 'z-source'),
        ref('track', 'm-middle'),
      ),
    ];

    expect(queryRailAccessConnectivity(
      tracks,
      topology,
      forestRing,
      sawmillRing,
    )).toEqual({
      connected: true,
      sourceEndpointTrackUUIDs: ['a-source', 'z-source'],
      destinationEndpointTrackUUIDs: ['a-destination', 'z-destination'],
      connectedTrackUUIDs: [
        'a-destination',
        'a-source',
        'm-middle',
        'z-destination',
        'z-source',
      ],
    });
  });
});
