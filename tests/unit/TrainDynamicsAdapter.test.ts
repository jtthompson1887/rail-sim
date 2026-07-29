import Phaser from 'phaser';
import Carriage from '../../src/entities/Carriage';
import RailTrack from '../../src/entities/RailTrack';
import Train from '../../src/entities/Train';
import {
  LOCOMOTIVE_PHYSICS,
  PASSENGER_CARRIAGE_PHYSICS,
} from '../../src/config/VehicleTypes';
import { GameConfig } from '../../src/config/GameConfig';
import { createDerailmentHazardState } from '../../src/physics/DerailmentEvaluator';
import { deriveRailVehiclePose } from '../../src/physics/RailVehicleModel';
import { TrackGraphRouteResolver } from '../../src/physics/RouteCursor';
import type {
  FreeBodyInitialState,
  TrainIncidentRecord,
} from '../../src/physics/CrashTransition';
import { EventBus } from '../../src/services/EventBus';
import { TrainDynamicsAdapter } from '../../src/systems/TrainDynamicsAdapter';

const { makeScene } = require('../../__mocks__/phaser');

function setup() {
  const scene = makeScene();
  const track = new RailTrack(
    scene,
    new Phaser.Math.Vector2(0, 0),
    new Phaser.Math.Vector2(333, 0),
    new Phaser.Math.Vector2(667, 0),
    new Phaser.Math.Vector2(1_000, 0),
  );
  track.setUUID('main');
  const resolver = new TrackGraphRouteResolver([track]);
  const train = new Train(scene, 500, 0, 'loco');
  const carriage = new Carriage(scene, 250, 0, 'car');
  train.currentTrack = track;
  carriage.currentTrack = track;
  const adapter = new TrainDynamicsAdapter({
    consistId: 'consist-1',
    resolver,
    bindings: [
      {
        vehicle: train,
        definition: LOCOMOTIVE_PHYSICS,
        order: 0,
        state: {
          mode: 'on-rail',
          vehicleId: 'loco',
          centre: { trackUUID: 'main', distance: 500, direction: 1 },
          speedMps: 0,
          hazard: createDerailmentHazardState('loco'),
        },
      },
      {
        vehicle: carriage,
        definition: PASSENGER_CARRIAGE_PHYSICS,
        order: 1,
        state: {
          mode: 'on-rail',
          vehicleId: 'car',
          centre: { trackUUID: 'main', distance: 250, direction: 1 },
          speedMps: 0,
          hazard: createDerailmentHazardState('car'),
        },
      },
    ],
  });
  return { adapter, train, carriage, resolver };
}

function incident(): TrainIncidentRecord {
  return {
    incidentId: 'incident-1',
    fixedTick: 10,
    cause: 'collision',
    involvedVehicleIds: ['loco'],
    derailmentSpeedMps: 12,
    lateralAccelerationMps2: 4,
    collisionImpulseNs: 50_000,
    deltaVelocityMps: 2,
    absorbedEnergyJ: 100_000,
    angularImpulseNms: 20_000,
    rolloverSeverity: 0.2,
    peakCouplerForceN: 30_000,
    brokenCouplerIds: [],
    secondaryImpacts: [],
    durationSeconds: 0,
  };
}

describe('TrainDynamicsAdapter', () => {
  it('renders on-rail body position and angle from its authoritative bogies', () => {
    const { adapter, train, resolver } = setup();
    train.enginePower = GameConfig.TRAIN.ENGINE_POWER;

    adapter.fixedUpdate(1 / 120);
    adapter.render(1);

    const state = adapter.getOnRailState('loco')!;
    const expected = deriveRailVehiclePose(LOCOMOTIVE_PHYSICS, state, resolver);
    const body = train.getMatterBody();
    expect(body.x).toBeCloseTo(expected.centre.x, 8);
    expect(body.y).toBeCloseTo(expected.centre.y, 8);
    expect(body.rotation).toBeCloseTo(expected.angleRad, 8);
    expect((body.body as any).isStatic).toBe(true);
    expect(train.persistedDynamics).toEqual({
      mode: 'on-rail',
      trackUUID: state.centre.trackUUID,
      distance: state.centre.distance,
      direction: state.centre.direction,
      speedMps: state.speedMps,
      consistId: 'consist-1',
      consistOrder: 0,
    });
  });

  it('render interpolation never mutates fixed physics state', () => {
    const { adapter, train } = setup();
    train.enginePower = GameConfig.TRAIN.ENGINE_POWER;
    adapter.fixedUpdate(1 / 120);
    const before = JSON.stringify(adapter.getConsistState());

    adapter.render(0.25);
    adapter.render(0.75);

    expect(JSON.stringify(adapter.getConsistState())).toBe(before);
  });

  it('releases a vehicle with exact velocity and angular velocity and no rail force', () => {
    const { adapter, train } = setup();
    const freeBody: FreeBodyInitialState = {
      mode: 'free-body',
      vehicleId: 'loco',
      x: 20,
      y: 30,
      angleRad: Math.PI / 3,
      velocity: { x: 4, y: 5 },
      angularVelocityRadPerSec: 0.6,
      initiatingImpulse: { x: 1_000, y: -500 },
    };

    adapter.transitionToFreeBody(freeBody, incident());
    const body = train.getMatterBody();
    expect((body.body as any).isStatic).toBe(false);
    expect(body.x).toBe(20);
    expect(body.y).toBe(30);
    expect((body.body as any).velocity).toEqual({ x: 4, y: 5 });
    expect((body.body as any).angularVelocity).toBe(0.6);
    expect(train.persistedDynamics).toEqual({
      mode: 'free-body',
      x: 20,
      y: 30,
      angleRad: Math.PI / 3,
      velocityX: 4,
      velocityY: 5,
      angularVelocityRadPerSec: 0.6,
    });

    (body.body as any).force = { x: 0, y: 0 };
    adapter.fixedUpdate(1 / 120);
    expect((body.body as any).force).toEqual({ x: 0, y: 0 });
    expect(adapter.getOnRailState('loco')).toBeNull();
  });

  it('keeps powered and unpowered vehicles in the same ordered consist', () => {
    const { adapter } = setup();
    const state = adapter.getConsistState();

    expect(state.vehicles.map((vehicle) => vehicle.vehicleId)).toEqual(['loco', 'car']);
    expect(state.couplers).toHaveLength(1);
    expect(state.couplers[0]).toMatchObject({
      leadingVehicleId: 'loco',
      trailingVehicleId: 'car',
    });
  });

  it('emits an incident exactly once when transition is replayed', () => {
    const { adapter } = setup();
    const received: TrainIncidentRecord[] = [];
    const listener = (record: TrainIncidentRecord) => received.push(record);
    EventBus.on('train:incident', listener);
    const freeBody: FreeBodyInitialState = {
      mode: 'free-body',
      vehicleId: 'loco',
      x: 0,
      y: 0,
      angleRad: 0,
      velocity: { x: 0, y: 0 },
      angularVelocityRadPerSec: 0,
      initiatingImpulse: { x: 0, y: 0 },
    };

    adapter.transitionToFreeBody(freeBody, incident());
    adapter.transitionToFreeBody(freeBody, incident());

    EventBus.off('train:incident', listener);
    expect(received).toHaveLength(1);
  });
});
