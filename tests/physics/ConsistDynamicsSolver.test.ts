import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import type { CouplerState } from '../../src/physics/CouplerModel';
import {
  ConsistDynamicsSolver,
  type ConsistControl,
  type ConsistState,
} from '../../src/physics/ConsistDynamicsSolver';
import type {
  OnRailVehicleState,
  RailVehicleDefinition,
} from '../../src/physics/RailVehicleModel';
import { TrackGraphRouteResolver } from '../../src/physics/RouteCursor';
import { createDerailmentHazardState } from '../../src/physics/DerailmentEvaluator';

const { makeScene } = require('../../__mocks__/phaser');

const powered: RailVehicleDefinition = {
  id: 'powered',
  massKg: 100_000,
  bodyLength: 20,
  wheelbase: 14,
  frontCouplerOffset: 11,
  rearCouplerOffset: 11,
  maxTractiveEffortN: 200_000,
  maxBrakeForceN: 300_000,
};

const unpowered: RailVehicleDefinition = {
  id: 'unpowered',
  massKg: 50_000,
  bodyLength: 24,
  wheelbase: 18,
  frontCouplerOffset: 13,
  rearCouplerOffset: 13,
  maxTractiveEffortN: 0,
  maxBrakeForceN: 100_000,
};

const coast: ConsistControl = { throttle: 0, brake: 0, emergencyBrake: false };
const power: ConsistControl = { throttle: 1, brake: 0, emergencyBrake: false };

function environment() {
  const scene = makeScene();
  const track = new RailTrack(
    scene,
    new Phaser.Math.Vector2(0, 0),
    new Phaser.Math.Vector2(33_333, 0),
    new Phaser.Math.Vector2(66_667, 0),
    new Phaser.Math.Vector2(100_000, 0),
  );
  track.setUUID('main');
  return { resolver: new TrackGraphRouteResolver([track]) };
}

function vehicle(vehicleId: string, distance: number, speedMps = 0): OnRailVehicleState {
  return {
    mode: 'on-rail',
    vehicleId,
    centre: { trackUUID: 'main', distance, direction: 1 },
    speedMps,
    hazard: createDerailmentHazardState(vehicleId),
  };
}

function coupler(
  id: string,
  leadingVehicleId: string,
  trailingVehicleId: string,
): CouplerState {
  return {
    id,
    leadingVehicleId,
    trailingVehicleId,
    extension: 0,
    relativeSpeed: 0,
    forceN: 0,
    broken: false,
  };
}

function consist(ids: readonly string[], initialSpeed = 0): ConsistState {
  return {
    id: 'consist',
    vehicles: ids.map((id, index) => vehicle(id, 50_000 - index * 30, initialSpeed)),
    couplers: ids.slice(1).map((id, index) => coupler(`c${index}`, ids[index], id)),
  };
}

function definitions(entries: Readonly<Record<string, RailVehicleDefinition>>) {
  return new Map(Object.entries(entries));
}

function runFor(
  solver: ConsistDynamicsSolver,
  initial: ConsistState,
  defs: ReadonlyMap<string, RailVehicleDefinition>,
  control: ConsistControl,
  seconds: number,
  dt = 1 / 60,
): ConsistState {
  const { resolver } = environment();
  let current = initial;
  const steps = Math.round(seconds / dt);
  for (let index = 0; index < steps; index++) {
    current = solver.step(current, defs, control, resolver, dt).state;
  }
  return current;
}

function speeds(state: ConsistState): number[] {
  return state.vehicles.map((item) => item.speedMps);
}

describe('ConsistDynamicsSolver', () => {
  it('accelerates one powered locomotive and one unpowered car through the coupler', () => {
    const solver = new ConsistDynamicsSolver();
    const result = runFor(
      solver,
      consist(['loco', 'car']),
      definitions({ loco: powered, car: unpowered }),
      power,
      5,
    );

    expect(result.vehicles[0].speedMps).toBeGreaterThan(5);
    expect(result.vehicles[1].speedMps).toBeGreaterThan(5);
    expect(Math.abs(result.vehicles[0].speedMps - result.vehicles[1].speedMps)).toBeLessThan(0.25);
  });

  it.each([
    ['locomotive in the middle', ['front-car', 'loco', 'rear-car'], {
      'front-car': unpowered,
      loco: powered,
      'rear-car': unpowered,
    }],
    ['powered cars at both ends', ['front-loco', 'car', 'rear-loco'], {
      'front-loco': powered,
      car: unpowered,
      'rear-loco': powered,
    }],
  ] as const)('supports %s', (_label, ids, definitionRecord) => {
    const result = runFor(
      new ConsistDynamicsSolver(),
      consist(ids),
      definitions(definitionRecord),
      power,
      5,
    );

    expect(Math.min(...speeds(result))).toBeGreaterThan(3);
    expect(Math.max(...speeds(result)) - Math.min(...speeds(result))).toBeLessThan(0.5);
  });

  it('does not invent propulsion for an unpowered consist', () => {
    const result = runFor(
      new ConsistDynamicsSolver(),
      consist(['a', 'b']),
      definitions({ a: unpowered, b: unpowered }),
      power,
      2,
    );

    expect(speeds(result)).toEqual([0, 0]);
  });

  it('makes emergency braking stronger than service braking without reversing cars', () => {
    const initial = consist(['loco'], 10);
    const defs = definitions({ loco: powered });
    const service = runFor(
      new ConsistDynamicsSolver(),
      initial,
      defs,
      { throttle: 0, brake: 0.5, emergencyBrake: false },
      1,
    );
    const emergency = runFor(
      new ConsistDynamicsSolver(),
      initial,
      defs,
      { throttle: 0, brake: 0, emergencyBrake: true },
      1,
    );

    expect(service.vehicles[0].speedMps).toBeLessThan(10);
    expect(emergency.vehicles[0].speedMps).toBeLessThan(service.vehicles[0].speedMps);
    expect(emergency.vehicles[0].speedMps).toBeGreaterThanOrEqual(0);
  });

  it('applies track gradient force downhill and uphill in route direction', () => {
    const runOnGrade = (startElevation: number, endElevation: number): number => {
      const scene = makeScene();
      const rail = new RailTrack(
        scene,
        new Phaser.Math.Vector2(0, 0),
        new Phaser.Math.Vector2(33_333, 0),
        new Phaser.Math.Vector2(66_667, 0),
        new Phaser.Math.Vector2(100_000, 0),
      );
      rail.setUUID('main');
      rail.setConstructionData({
        profileVersion: 1,
        knots: [
          { t: 0, elevation: startElevation },
          { t: 1, elevation: endElevation },
        ],
      }, [{
        type: 'surface',
        startT: 0,
        endT: 1,
        startElevation,
        endElevation,
      }], 0);
      const resolver = new TrackGraphRouteResolver([rail]);
      const solver = new ConsistDynamicsSolver();
      const defs = definitions({ car: unpowered });
      let current = consist(['car'], 10);
      for (let index = 0; index < 120; index++) {
        current = solver.step(current, defs, coast, resolver, 1 / 120).state;
      }
      return current.vehicles[0].speedMps;
    };

    const uphill = runOnGrade(0, 1_000);
    const flat = runOnGrade(0, 0);
    const downhill = runOnGrade(1_000, 0);
    expect(uphill).toBeLessThan(flat);
    expect(downhill).toBeGreaterThan(flat);
  });

  it('allows slack run-out before transmitting force', () => {
    const solver = new ConsistDynamicsSolver();
    const { resolver } = environment();
    const initial = consist(['leading', 'trailing']);
    initial.vehicles[0].speedMps = 2;
    const defs = definitions({ leading: unpowered, trailing: unpowered });

    const early = solver.step(initial, defs, coast, resolver, 1 / 120);
    expect(early.state.couplers[0].extension).toBeGreaterThan(0);
    expect(early.state.couplers[0].forceN).toBe(0);

    let current = early.state;
    for (let index = 0; index < 12; index++) {
      current = solver.step(current, defs, coast, resolver, 1 / 120).state;
    }
    expect(current.couplers[0].forceN).toBeGreaterThan(0);
  });

  it('keeps a 40-car consist finite and coupled under power', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `vehicle-${index}`);
    const defs = definitions(Object.fromEntries(
      ids.map((id, index) => [id, index === 0 ? powered : unpowered]),
    ));
    const result = runFor(
      new ConsistDynamicsSolver(),
      consist(ids),
      defs,
      power,
      2,
    );

    expect(result.vehicles).toHaveLength(40);
    expect(result.vehicles.every((item) => Number.isFinite(item.speedMps))).toBe(true);
    expect(result.couplers.every((item) => Number.isFinite(item.extension))).toBe(true);
    expect(result.couplers.every((item) => !item.broken)).toBe(true);
  });

  it('produces the same fixed-step state under 60 Hz and 120 Hz render schedules', () => {
    const defs = definitions({ loco: powered, car: unpowered });
    const initial = consist(['loco', 'car']);
    const at60 = runFor(new ConsistDynamicsSolver(), initial, defs, power, 1, 1 / 60);
    const at120 = runFor(new ConsistDynamicsSolver(), initial, defs, power, 1, 1 / 120);

    expect(JSON.stringify(at60)).toBe(JSON.stringify(at120));
  });
});
