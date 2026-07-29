import type { VerticalProfileDef } from '../config/WorldData';
import {
  LOCOMOTIVE_PHYSICS,
  PASSENGER_CARRIAGE_PHYSICS,
} from '../config/VehicleTypes';
import type { ConsistControl, ConsistState } from './ConsistDynamicsSolver';
import type { CouplerState } from './CouplerModel';
import type {
  OnRailVehicleState,
  RailVehicleDefinition,
} from './RailVehicleModel';
import {
  type RouteResolver,
  type RouteTrack,
  type TravelDirection,
} from './RouteCursor';
import { TrackArcLengthIndex } from './TrackArcLengthIndex';
import type { TrackGeometryDef } from '../systems/TrackGeometry';
import type {
  TrainPhysicsMetrics,
  TrainPhysicsScenario,
  TrainPhysicsScenarioState,
} from './TrainPhysicsHarness';

type Exit = 'start' | 'end';

class HarnessTrack implements RouteTrack {
  private readonly index: TrackArcLengthIndex;

  constructor(
    private readonly uuid: string,
    geometry: TrackGeometryDef,
    readonly verticalProfile: VerticalProfileDef | null = null,
  ) {
    this.index = new TrackArcLengthIndex(geometry, 4);
  }

  getUUID(): string {
    return this.uuid;
  }

  getArcLengthIndex(): TrackArcLengthIndex {
    return this.index;
  }
}

class HarnessRouteResolver implements RouteResolver {
  private readonly tracks = new Map<string, HarnessTrack>();
  private readonly routes = new Map<string, Array<{
    track: HarnessTrack;
    direction: TravelDirection;
  }>>();

  constructor(tracks: readonly HarnessTrack[]) {
    tracks.forEach((track) => this.tracks.set(track.getUUID(), track));
  }

  connect(
    fromTrackUUID: string,
    exit: Exit,
    toTrackUUID: string,
    direction: TravelDirection,
    active = false,
  ): void {
    const key = `${fromTrackUUID}:${exit}`;
    const route = {
      track: this.tracks.get(toTrackUUID)!,
      direction,
    };
    const existing = this.routes.get(key) ?? [];
    if (active) existing.unshift(route);
    else existing.push(route);
    this.routes.set(key, existing);
  }

  trackByUUID(uuid: string): RouteTrack | null {
    return this.tracks.get(uuid) ?? null;
  }

  continuation(
    track: RouteTrack,
    exit: Exit,
    preferredTrackUUID?: string,
  ): { track: RouteTrack; direction: TravelDirection } | null {
    const candidates = this.routes.get(`${track.getUUID()}:${exit}`) ?? [];
    return candidates.find((candidate) => candidate.track.getUUID() === preferredTrackUUID)
      ?? candidates[0]
      ?? null;
  }
}

function straight(id: string, startX: number, endX: number, elevation?: VerticalProfileDef) {
  const third = (endX - startX) / 3;
  return new HarnessTrack(id, {
    geometryVersion: 1,
    p0: { x: startX, y: 0 },
    p1: { x: startX + third, y: 0 },
    p2: { x: startX + 2 * third, y: 0 },
    p3: { x: endX, y: 0 },
  }, elevation ?? null);
}

function curve(id: string, geometry: TrackGeometryDef): HarnessTrack {
  return new HarnessTrack(id, geometry);
}

function makeVehicle(
  id: string,
  trackUUID: string,
  distance: number,
  speedMps = 0,
): OnRailVehicleState {
  return {
    mode: 'on-rail',
    vehicleId: id,
    centre: { trackUUID, distance, direction: 1 },
    speedMps,
  };
}

function makeCoupler(
  index: number,
  leadingVehicleId: string,
  trailingVehicleId: string,
): CouplerState {
  return {
    id: `coupler-${index}`,
    leadingVehicleId,
    trailingVehicleId,
    extension: 0,
    relativeSpeed: 0,
    forceN: 0,
    broken: false,
  };
}

function makeConsist(
  ids: readonly string[],
  trackUUID: string,
  leadingDistance: number,
  spacing: number,
  speedMps = 0,
): ConsistState {
  return {
    id: `consist-${ids[0]}`,
    vehicles: ids.map((id, index) => (
      makeVehicle(id, trackUUID, leadingDistance - spacing * index, speedMps)
    )),
    couplers: ids.slice(1).map((id, index) => makeCoupler(index, ids[index], id)),
  };
}

function definitionsFor(
  ids: readonly string[],
  poweredIndices: ReadonlySet<number>,
): ReadonlyMap<string, RailVehicleDefinition> {
  return new Map(ids.map((id, index) => [
    id,
    poweredIndices.has(index) ? LOCOMOTIVE_PHYSICS : PASSENGER_CARRIAGE_PHYSICS,
  ]));
}

function assertCommon(metrics: TrainPhysicsMetrics): void {
  const finite = [
    metrics.maxFrontBogieError,
    metrics.maxRearBogieError,
    metrics.maxWheelbaseError,
    metrics.maxTransitionJump,
    metrics.maxCouplerForceN,
    metrics.maxAccelerationMps2,
    metrics.maxJerkMps3,
  ].every(Number.isFinite);
  if (!finite) throw new Error('Scenario produced non-finite train physics metrics');
  if (metrics.maxFrontBogieError >= 0.01 || metrics.maxRearBogieError >= 0.01) {
    throw new Error('Bogie adherence exceeded 0.01 world units');
  }
  if (metrics.maxWheelbaseError >= 0.01) {
    throw new Error('Route wheelbase replay exceeded 0.01 world units');
  }
  if (metrics.maxTransitionJump >= 0.1) {
    throw new Error('Route transition jump exceeded 0.1 world units');
  }
}

function fixedControl(
  throttle: number,
  brake = 0,
  emergencyBrake = false,
): ConsistControl {
  return { throttle, brake, emergencyBrake };
}

function basicScenario(
  id: string,
  durationSeconds: number,
  build: () => TrainPhysicsScenarioState,
  controlAt: (tick: number) => ConsistControl,
): TrainPhysicsScenario {
  return {
    id,
    durationSeconds,
    build,
    controlAt,
    assert(metrics) {
      try {
        assertCommon(metrics);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${id}: ${message}`);
      }
    },
  };
}

export const STRAIGHT_ACCELERATION_BRAKING_SCENARIO = basicScenario(
  'straight-acceleration-braking',
  2,
  () => {
    const rail = straight('straight', 0, 4_000);
    const resolver = new HarnessRouteResolver([rail]);
    const ids = ['loco', 'car'];
    return {
      consist: makeConsist(ids, 'straight', 2_000, 250),
      definitions: definitionsFor(ids, new Set([0])),
      resolver,
    };
  },
  (tick) => (tick < 120 ? fixedControl(1) : fixedControl(0, 0.7)),
);

export const SAFE_CURVE_SCENARIO = basicScenario(
  'safe-constant-radius-curve',
  1,
  () => {
    const rail = curve('curve', {
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 600 },
      p2: { x: 600, y: 600 },
      p3: { x: 600, y: 0 },
    });
    const resolver = new HarnessRouteResolver([rail]);
    const ids = ['loco'];
    return {
      consist: makeConsist(ids, 'curve', rail.getArcLengthIndex().length / 2, 250, 8),
      definitions: definitionsFor(ids, new Set([0])),
      resolver,
    };
  },
  () => fixedControl(0.2),
);

export const S_CURVE_SCENARIO = basicScenario(
  's-curve',
  1,
  () => {
    const rail = curve('s-curve', {
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 400, y: 600 },
      p2: { x: 800, y: -600 },
      p3: { x: 1_200, y: 0 },
    });
    const resolver = new HarnessRouteResolver([rail]);
    const ids = ['loco', 'car'];
    return {
      consist: makeConsist(ids, 's-curve', rail.getArcLengthIndex().length / 2, 250, 6),
      definitions: definitionsFor(ids, new Set([0])),
      resolver,
    };
  },
  () => fixedControl(0.2),
);

export const CONNECTED_SEGMENTS_SCENARIO = basicScenario(
  'connected-segments',
  1,
  () => {
    const first = straight('first', 0, 800);
    const second = straight('second', 800, 1_600);
    const resolver = new HarnessRouteResolver([first, second]);
    resolver.connect('first', 'end', 'second', 1);
    resolver.connect('second', 'start', 'first', -1);
    const ids = ['loco'];
    return {
      consist: makeConsist(ids, 'first', 750, 250, 10),
      definitions: definitionsFor(ids, new Set([0])),
      resolver,
    };
  },
  () => fixedControl(0),
);

export const ACTIVE_JUNCTION_SCENARIO = basicScenario(
  'active-junction',
  1,
  () => {
    const main = straight('main', 0, 800);
    const left = curve('left', {
      geometryVersion: 1,
      p0: { x: 800, y: 0 },
      p1: { x: 1_000, y: 0 },
      p2: { x: 1_200, y: -100 },
      p3: { x: 1_400, y: -150 },
    });
    const right = curve('right', {
      geometryVersion: 1,
      p0: { x: 800, y: 0 },
      p1: { x: 1_000, y: 0 },
      p2: { x: 1_200, y: 100 },
      p3: { x: 1_400, y: 150 },
    });
    const resolver = new HarnessRouteResolver([main, left, right]);
    resolver.connect('main', 'end', 'right', 1);
    resolver.connect('main', 'end', 'left', 1, true);
    resolver.connect('left', 'start', 'main', -1);
    resolver.connect('right', 'start', 'main', -1);
    const ids = ['loco'];
    return {
      consist: makeConsist(ids, 'main', 750, 250, 10),
      definitions: definitionsFor(ids, new Set([0])),
      resolver,
    };
  },
  () => fixedControl(0),
);

export const GRADIENT_TRANSITION_SCENARIO = basicScenario(
  'gradient-transition',
  1,
  () => {
    const rail = straight('grade', 0, 2_000, {
      profileVersion: 1,
      knots: [
        { t: 0, elevation: 0 },
        { t: 0.5, elevation: 0 },
        { t: 1, elevation: 20 },
      ],
    });
    const resolver = new HarnessRouteResolver([rail]);
    const ids = ['loco'];
    return {
      consist: makeConsist(ids, 'grade', 950, 250, 10),
      definitions: definitionsFor(ids, new Set([0])),
      resolver,
    };
  },
  () => fixedControl(0),
);

export const MIXED_POWER_SCENARIO = basicScenario(
  'mixed-power-consist',
  1.5,
  () => {
    const rail = straight('mixed', 0, 8_000);
    const resolver = new HarnessRouteResolver([rail]);
    const ids = ['front-car', 'middle-loco', 'rear-car', 'rear-loco'];
    return {
      consist: makeConsist(ids, 'mixed', 5_000, 250),
      definitions: definitionsFor(ids, new Set([1, 3])),
      resolver,
    };
  },
  () => fixedControl(0.8),
);

function longConsistScenario(
  id: string,
  vehicleCount: number,
  durationSeconds: number,
): TrainPhysicsScenario {
  return basicScenario(id, durationSeconds, () => {
    const rail = straight('long', 0, 30_000);
    const resolver = new HarnessRouteResolver([rail]);
    const ids = Array.from({ length: vehicleCount }, (_, index) => `vehicle-${index}`);
    return {
      consist: makeConsist(ids, 'long', 27_000, 250),
      definitions: definitionsFor(ids, new Set([0, Math.floor(vehicleCount / 2)])),
      resolver,
    };
  }, () => fixedControl(0.7));
}

export const FORTY_CAR_SCENARIO = longConsistScenario('40-car-acceptance', 40, 1.5);

export const TRAIN_PHYSICS_STRESS_SCENARIO = longConsistScenario(
  '100-car-stress',
  100,
  1,
);

export const TRAIN_PHYSICS_SCENARIOS: readonly TrainPhysicsScenario[] = [
  STRAIGHT_ACCELERATION_BRAKING_SCENARIO,
  SAFE_CURVE_SCENARIO,
  S_CURVE_SCENARIO,
  CONNECTED_SEGMENTS_SCENARIO,
  ACTIVE_JUNCTION_SCENARIO,
  GRADIENT_TRANSITION_SCENARIO,
  MIXED_POWER_SCENARIO,
  FORTY_CAR_SCENARIO,
];
