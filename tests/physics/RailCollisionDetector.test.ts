import { createDerailmentHazardState } from '../../src/physics/DerailmentEvaluator';
import {
  detectRailCollisions,
  type RailCollisionVehicle,
} from '../../src/physics/RailCollisionDetector';
import type { RailVehiclePose } from '../../src/physics/RailVehicleModel';

const definition = {
  id: 'car',
  massKg: 50_000,
  bodyLength: 20,
  wheelbase: 14,
  frontCouplerOffset: 11,
  rearCouplerOffset: 11,
  maxTractiveEffortN: 0,
  maxBrakeForceN: 100_000,
};

function vehicle(
  vehicleId: string,
  trackUUID: string,
  distance: number,
  speedMps: number,
  direction: 1 | -1 = 1,
): RailCollisionVehicle {
  return {
    vehicleId,
    definition,
    state: {
      mode: 'on-rail',
      vehicleId,
      centre: { trackUUID, distance, direction },
      speedMps,
      hazard: createDerailmentHazardState(vehicleId),
    },
  };
}

function pose(x: number, y: number, angleRad = 0): RailVehiclePose {
  return {
    centre: { x, y },
    angleRad,
    frontBogie: { x: x + Math.cos(angleRad) * 7, y: y + Math.sin(angleRad) * 7 },
    rearBogie: { x: x - Math.cos(angleRad) * 7, y: y - Math.sin(angleRad) * 7 },
    frontCoupler: { x: x + Math.cos(angleRad) * 10, y: y + Math.sin(angleRad) * 10 },
    rearCoupler: { x: x - Math.cos(angleRad) * 10, y: y - Math.sin(angleRad) * 10 },
    curvature: 0,
  };
}

describe('detectRailCollisions', () => {
  it('reports same-route buffer contact without inventing an impulse at rest', () => {
    const vehicles = [
      vehicle('a', 'main', 100, 0),
      vehicle('b', 'main', 120, 0),
    ];
    const poses = new Map([['a', pose(100, 0)], ['b', pose(120, 0)]]);

    const collisions = detectRailCollisions(vehicles, poses, poses, 1 / 120);

    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({ closingSpeedMps: 0, impulseNs: 0 });
  });

  it('calculates rear-end closing speed and effective-mass impulse', () => {
    const vehicles = [
      vehicle('rear', 'main', 100, 10),
      vehicle('front', 'main', 118, 2),
    ];
    const previous = new Map([['rear', pose(99, 0)], ['front', pose(117.8, 0)]]);
    const current = new Map([['rear', pose(100, 0)], ['front', pose(118, 0)]]);

    const [collision] = detectRailCollisions(vehicles, previous, current, 0.1);

    expect(collision.closingSpeedMps).toBeCloseTo(8, 9);
    expect(collision.impulseNs).toBeCloseTo(200_000, 6);
  });

  it('detects opposing head-on rail traffic', () => {
    const vehicles = [
      vehicle('eastbound', 'main', 100, 10, 1),
      vehicle('westbound', 'main', 119, 10, -1),
    ];
    const poses = new Map([
      ['eastbound', pose(100, 0)],
      ['westbound', pose(119, 0, Math.PI)],
    ]);

    const [collision] = detectRailCollisions(vehicles, poses, poses, 1 / 120);

    expect(collision.closingSpeedMps).toBeCloseTo(20, 9);
    expect(collision.impulseNs).toBeCloseTo(500_000, 6);
  });

  it('detects swept crossing paths on different tracks', () => {
    const vehicles = [
      vehicle('horizontal', 'horizontal-track', 10, 10),
      vehicle('vertical', 'vertical-track', 10, 10),
    ];
    const previous = new Map([
      ['horizontal', pose(-10, 0)],
      ['vertical', pose(0, -10, Math.PI / 2)],
    ]);
    const current = new Map([
      ['horizontal', pose(10, 0)],
      ['vertical', pose(0, 10, Math.PI / 2)],
    ]);

    expect(detectRailCollisions(vehicles, previous, current, 1)).toHaveLength(1);
  });

  it('does not collide vehicles on spatially separated tracks', () => {
    const vehicles = [
      vehicle('a', 'track-a', 10, 10),
      vehicle('b', 'track-b', 10, 10),
    ];
    const previous = new Map([['a', pose(0, 0)], ['b', pose(0, 100)]]);
    const current = new Map([['a', pose(10, 0)], ['b', pose(10, 100)]]);

    expect(detectRailCollisions(vehicles, previous, current, 1)).toEqual([]);
  });
});
