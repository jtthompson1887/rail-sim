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
import { TrackGraphRouteResolver } from '../../src/physics/adapters/TrackGraphRouteResolver';
import type {
  FreeBodyInitialState,
  TrainIncidentRecord,
} from '../../src/physics/CrashTransition';
import { EventBus } from '../../src/services/EventBus';
import { TrainDynamicsAdapter } from '../../src/systems/TrainDynamicsAdapter';
import { connectPorts } from '../../src/entities/TrackPort';
import { captureTrainRuntime } from '../../src/freight/TrainRuntime';
import { deriveAutomaticCubic } from '../../src/systems/TrackGeometry';

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
  it.each([40,-40])('holds newly placed and explicitly stopped consists on a %s-unit grade until throttle releases the brake', (elevation) => {
    const {adapter,train,resolver}=setup();
    const track=resolver.trackByUUID('main') as RailTrack;
    track.setConstructionData({profileVersion:1,knots:[{t:0,elevation:0},{t:1,elevation}]},
      [{type:'surface',startT:0,endT:1,startElevation:0,endElevation:elevation}],0);
    const initial=adapter.getConsistState();adapter.fixedUpdate(3);
    expect(adapter.getConsistState().vehicles.map(vehicle=>vehicle.speedMps)).toEqual([0,0]);
    expect(adapter.getConsistState().vehicles.map(vehicle=>vehicle.centre)).toEqual(initial.vehicles.map(vehicle=>vehicle.centre));
    train.enginePower=GameConfig.TRAIN.ENGINE_POWER;adapter.fixedUpdate(.5);
    expect(adapter.getOnRailState('loco')!.speedMps).toBeGreaterThan(0);
    adapter.stopImmediately();adapter.fixedUpdate(3);
    expect(adapter.getConsistState().vehicles.map(vehicle=>vehicle.speedMps)).toEqual([0,0]);
  });

  it('releases actual motion at an unconnected rail end instead of accelerating a frozen on-rail body', () => {
    const {train,resolver}=setup();
    const restored=new TrainDynamicsAdapter({consistId:'terminal-consist',resolver,bindings:[{vehicle:train,
      definition:LOCOMOTIVE_PHYSICS,order:0,state:{mode:'on-rail',vehicleId:train.getUUID(),
        centre:{trackUUID:'main',distance:999,direction:1},speedMps:3.4,hazard:createDerailmentHazardState(train.getUUID())}}]});
    const events:TrainIncidentRecord[]=[];const listener=(event:TrainIncidentRecord)=>events.push(event);EventBus.on('train:incident',listener);
    try{
      restored.fixedUpdate(.2);restored.render(1);
      expect(train.derailed).toBe(true);expect(restored.getOnRailState(train.getUUID())).toBeNull();
      expect((train.getMatterBody().body as any).isStatic).toBe(false);
      expect(captureTrainRuntime(train).speedWorldUnitsPerSecond).toBeCloseTo(3.4*10,0);
      expect(events).toHaveLength(1);expect(events[0].cause).toBe('route-discontinuity');
    }finally{EventBus.off('train:incident',listener);}
  });

  it.each([[3.4,false],[13,true]])('crosses a curved join at %s m/s with genuine overspeed derailment=%s', (speedMps,derails) => {
    const scene=makeScene();
    const start={x:7350,y:-5900},join={x:5856.165293824076,y:-4924.71395446039},end={x:5400,y:-3200};
    const firstGeometry=deriveAutomaticCubic({start,end:join});
    const length=Math.hypot(join.x-start.x,join.y-start.y);
    const secondGeometry=deriveAutomaticCubic({start:join,end,startOutward:{x:(join.x-start.x)/length,y:(join.y-start.y)/length}});
    const makeTrack=(id:string,g:typeof firstGeometry)=>{
      const points=[g.p0,g.p1,g.p2,g.p3].map(p=>new Phaser.Math.Vector2(p.x,p.y));
      const track=new RailTrack(scene,points[0],points[1],points[2],points[3]);track.setUUID(id);return track;
    };
    const first=makeTrack('entry',firstGeometry),second=makeTrack('curve',secondGeometry);connectPorts(first.endPort,second.startPort);
    const train=new Train(scene,join.x,join.y,'curve-train');train.currentTrack=first;
    const adapter=new TrainDynamicsAdapter({consistId:'curve-consist',resolver:new TrackGraphRouteResolver([first,second]),bindings:[{
      vehicle:train,definition:LOCOMOTIVE_PHYSICS,order:0,state:{mode:'on-rail',vehicleId:train.getUUID(),
        centre:{trackUUID:'entry',distance:first.getArcLengthIndex().length-1,direction:1},speedMps,
        hazard:createDerailmentHazardState(train.getUUID())},
    }]});
    adapter.fixedUpdate(.2);adapter.render(1);
    expect(train.derailed).toBe(derails);
    if(!derails){expect(train.currentTrack).toBe(second);expect(captureTrainRuntime(train).speedWorldUnitsPerSecond).toBeCloseTo(adapter.getOnRailState(train.getUUID())!.speedMps*10);}
  });

  it('keeps runtime track and speed authoritative across a connected endpoint', () => {
    const scene = makeScene();
    const makeTrack = (id: string, start: number, end: number) => {
      const track = new RailTrack(scene,new Phaser.Math.Vector2(start,0),new Phaser.Math.Vector2(start+(end-start)/3,0),
        new Phaser.Math.Vector2(start+2*(end-start)/3,0),new Phaser.Math.Vector2(end,0));
      track.setUUID(id);return track;
    };
    const first=makeTrack('first',0,1000),second=makeTrack('second',1000,2000);
    connectPorts(first.endPort,second.startPort);
    const train=new Train(scene,990,0,'through-train');train.currentTrack=first;
    const adapter=new TrainDynamicsAdapter({consistId:'through-consist',resolver:new TrackGraphRouteResolver([first,second]),bindings:[{
      vehicle:train,definition:LOCOMOTIVE_PHYSICS,order:0,state:{mode:'on-rail',vehicleId:train.getUUID(),
        centre:{trackUUID:'first',distance:990,direction:1},speedMps:10,hazard:createDerailmentHazardState(train.getUUID())},
    }]});
    adapter.fixedUpdate(.2);adapter.render(1);
    const runtime=captureTrainRuntime(train);
    expect(runtime.trackUUID).toBe('second');expect(runtime.trackT).toBeGreaterThan(0);
    expect(runtime.speedWorldUnitsPerSecond).toBeCloseTo(adapter.getOnRailState(train.getUUID())!.speedMps*10);
    expect(runtime.speedWorldUnitsPerSecond).toBeGreaterThan(2);expect(runtime.derailed).toBe(false);
    expect((train.getMatterBody().body as any).velocity).toEqual({x:0,y:0});
  });

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
    expect((body.body as any).velocity.x).toBeCloseTo(4 * 10 / 60);
    expect((body.body as any).velocity.y).toBeCloseTo(5 * 10 / 60);
    expect((body.body as any).angularVelocity).toBeCloseTo(0.6 / 60);
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
