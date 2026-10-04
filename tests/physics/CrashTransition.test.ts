import {
  createCrashTransition,
  type CrashTransitionVehicle,
} from '../../src/physics/CrashTransition';
import { createDerailmentHazardState } from '../../src/physics/DerailmentEvaluator';
import type { RailCollision } from '../../src/physics/RailCollisionDetector';

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
  x: number,
  angleRad: number,
  speedMps: number,
  curvaturePerMetre: number,
): CrashTransitionVehicle {
  return {
    vehicleId,
    definition,
    state: {
      mode: 'on-rail',
      vehicleId,
      centre: { trackUUID: 'main', distance: x, direction: 1 },
      speedMps,
      hazard: createDerailmentHazardState(vehicleId),
    },
    pose: {
      centre: { x, y: 4 },
      angleRad,
      frontBogie: { x, y: 4 },
      rearBogie: { x, y: 4 },
      frontCoupler: { x, y: 4 },
      rearCoupler: { x, y: 4 },
      curvature: curvaturePerMetre / 10,
    },
    curvaturePerMetre,
    peakCouplerForceN: 100,
    brokenCouplerIds: [],
  };
}

function collision(impulseNs: number, closingSpeedMps: number): RailCollision {
  return {
    vehicleAId: 'a',
    vehicleBId: 'b',
    point: { x: 10, y: 4 },
    normal: { x: 1, y: 0 },
    closingSpeedMps,
    impulseNs,
  };
}

describe('createCrashTransition', () => {
  it('preserves bogie pose, chord velocity, and curvature angular velocity', () => {
    const item = vehicle('a', 3, Math.PI / 2, 10, 0.02);
    const trigger = {
      kind: 'derail' as const,
      hazard: item.state.hazard,
      cause: 'lateral-acceleration' as const,
    };

    const result = createCrashTransition([item], trigger, 42);

    expect(result.freeBodies[0].x).toBe(3);
    expect(result.freeBodies[0].y).toBe(4);
    expect(result.freeBodies[0].angleRad).toBe(Math.PI / 2);
    expect(result.freeBodies[0].velocity.x).toBeCloseTo(0, 9);
    expect(result.freeBodies[0].velocity.y).toBeCloseTo(10, 9);
    expect(result.freeBodies[0].angularVelocityRadPerSec).toBeCloseTo(0.2, 9);
  });

  it('assigns equal and opposite collision impulses', () => {
    const result = createCrashTransition([
      vehicle('a', 0, 0, 10, 0),
      vehicle('b', 20, Math.PI, 10, 0),
    ], collision(500_000, 20), 10);

    expect(result.freeBodies[0].initiatingImpulse).toEqual({ x: -500_000, y: 0 });
    expect(result.freeBodies[1].initiatingImpulse).toEqual({ x: 500_000, y: 0 });
    expect(result.freeBodies[0].initiatingImpulse.x
      + result.freeBodies[1].initiatingImpulse.x).toBe(0);
  });

  it('orders low- and high-energy incident severity', () => {
    const vehicles = [
      vehicle('a', 0, 0, 10, 0),
      vehicle('b', 20, Math.PI, 10, 0),
    ];
    const low = createCrashTransition(vehicles, collision(50_000, 2), 10).incident;
    const high = createCrashTransition(vehicles, collision(500_000, 20), 10).incident;

    expect(high.deltaVelocityMps).toBeGreaterThan(low.deltaVelocityMps);
    expect(high.absorbedEnergyJ).toBeGreaterThan(low.absorbedEnergyJ);
    expect(high.rolloverSeverity).toBeGreaterThan(low.rolloverSeverity);
  });

  it('creates stable incident IDs from the fixed tick and involved vehicles', () => {
    const vehicles = [
      vehicle('a', 0, 0, 10, 0),
      vehicle('b', 20, Math.PI, 10, 0),
    ];

    const first = createCrashTransition(vehicles, collision(500_000, 20), 77);
    const replay = createCrashTransition(vehicles, collision(500_000, 20), 77);
    const later = createCrashTransition(vehicles, collision(500_000, 20), 78);

    expect(first.incident.incidentId).toBe(replay.incident.incidentId);
    expect(later.incident.incidentId).not.toBe(first.incident.incidentId);
  });
});
