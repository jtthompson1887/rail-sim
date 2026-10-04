import { TrainManager } from '../../src/managers/TrainManager';
import Phaser from 'phaser';
import RailTrack from '../../src/entities/RailTrack';
import { EventBus } from '../../src/services/EventBus';

describe('TrainManager authoritative service rendering', () => {
  const { makeScene } = require('../../__mocks__/phaser');
  it('renders automatic snapshots without advancing manual dynamics and stops released trains', () => {
    const scene = makeScene();
    const track = new RailTrack(scene, new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(333, 0),
      new Phaser.Math.Vector2(667, 0), new Phaser.Math.Vector2(1000, 0));
    track.setUUID('managed-route');
    const manager = new TrainManager(scene, { tracks: [track], junctions: [], getTrack: () => track } as any, {} as any);
    const train = manager.createFreightTrain('automatic', 'flatbed-freight-set');
    manager.setManagedTrainIds(new Set(['automatic']));
    manager.applyManagedSnapshots([{ trainId: 'automatic', trackUUID: 'managed-route', distance: 400,
      trackT: 0.4, facing: 1, speedMps: 10, x: 400, y: 0, angleRad: 0, serviceId: 'service', stoppedReason: null }]);
    train.enginePower = 50;
    manager.update(1000, 1000);
    expect(train.enginePower).toBe(0);
    expect(train.getMatterBody().x).toBe(400);
    expect(manager.getDynamicsAdapter('consist-automatic')).toBeUndefined();
    expect(train.persistedDynamics).toEqual(expect.objectContaining({ speedMps: 10, distance: 400 }));
    manager.setManagedTrainIds(new Set());
    expect(train.persistedDynamics).toEqual(expect.objectContaining({ speedMps: 0 }));
  });

  it('restores a newer physical cursor instead of replaying an older adapter state', () => {
    const scene=makeScene();
    const track=new RailTrack(scene,new Phaser.Math.Vector2(0,0),new Phaser.Math.Vector2(3333,0),
      new Phaser.Math.Vector2(6667,0),new Phaser.Math.Vector2(10000,0));track.setUUID('restore-route');
    const manager=new TrainManager(scene,{tracks:[track],junctions:[],getTrack:()=>track} as any,{} as any);
    const train=manager.createFreightTrain('restored','flatbed-freight-set');
    const physical={mode:'on-rail' as const,trackUUID:'restore-route',distance:1000,direction:1 as const,speedMps:5,consistId:'consist-restored',consistOrder:0};
    manager.restoreVehicleDynamics(train,physical);manager.update(0,20);
    manager.restoreVehicleDynamics(train,{...physical,distance:7000,speedMps:0});manager.update(20,20);
    expect(train.persistedDynamics).toEqual(expect.objectContaining({distance:7000,speedMps:0}));
    expect(train.getMatterBody().x).toBeCloseTo(7000,1);
  });
});

describe('TrainManager.getBounds()', () => {
  let manager: TrainManager;

  beforeEach(() => {
    manager = new TrainManager({} as any, {} as any, {} as any);
  });

  it('returns null when trainBody is falsy', () => {
    expect(manager.getBounds(null as any)).toBeNull();
  });

  it('returns bounding box with min/max/corners for a horizontal train', () => {
    const trainBody: any = {
      displayWidth: 80,
      displayHeight: 40,
      x: 100,
      y: 200,
      angle: 0,
    };
    const bounds = manager.getBounds(trainBody);
    expect(bounds).not.toBeNull();
    expect(bounds!.corners).toHaveLength(4);
    expect(bounds!.min.x).toBeCloseTo(60);
    expect(bounds!.max.x).toBeCloseTo(140);
    expect(bounds!.min.y).toBeCloseTo(180);
    expect(bounds!.max.y).toBeCloseTo(220);
  });

  it('corners span the full width and height for axis-aligned train', () => {
    const trainBody: any = { displayWidth: 100, displayHeight: 50, x: 0, y: 0, angle: 0 };
    const bounds = manager.getBounds(trainBody);
    const width = bounds!.max.x - bounds!.min.x;
    const height = bounds!.max.y - bounds!.min.y;
    expect(width).toBeCloseTo(100);
    expect(height).toBeCloseTo(50);
  });

  it('rotated train has a larger bounding box than its dimensions', () => {
    const trainBody: any = { displayWidth: 100, displayHeight: 50, x: 0, y: 0, angle: 45 };
    const bounds = manager.getBounds(trainBody);
    const width = bounds!.max.x - bounds!.min.x;
    const height = bounds!.max.y - bounds!.min.y;
    expect(width).toBeGreaterThan(50);
    expect(height).toBeGreaterThan(50);
  });

  it('returns 4 corners for any rotation', () => {
    const angles = [0, 30, 45, 90, 135, 180];
    angles.forEach((angle) => {
      const trainBody: any = { displayWidth: 80, displayHeight: 40, x: 0, y: 0, angle };
      const bounds = manager.getBounds(trainBody);
      expect(bounds!.corners).toHaveLength(4);
    });
  });

  it('min is always less than or equal to max', () => {
    const trainBody: any = { displayWidth: 60, displayHeight: 30, x: 50, y: 50, angle: 37 };
    const bounds = manager.getBounds(trainBody);
    expect(bounds!.min.x).toBeLessThanOrEqual(bounds!.max.x);
    expect(bounds!.min.y).toBeLessThanOrEqual(bounds!.max.y);
  });
});

describe('TrainManager.deselectTrain()', () => {
  it('does not throw when no train is selected', () => {
    const manager = new TrainManager({} as any, {} as any, {} as any);
    expect(() => manager.deselectTrain()).not.toThrow();
  });

  it('selectedTrain is null initially', () => {
    const manager = new TrainManager({} as any, {} as any, {} as any);
    expect(manager.selectedTrain).toBeNull();
  });
});

describe('TrainManager.createInitialTrain()', () => {
  const { makeScene } = require('../../__mocks__/phaser');

  it('creates a train with a random UUID when no id is provided', () => {
    const scene = makeScene();
    const manager = new TrainManager(scene, {} as any, {} as any);
    const train = manager.createInitialTrain();
    expect(typeof train.getUUID()).toBe('string');
    expect(train.getUUID().length).toBeGreaterThan(0);
  });

  it('creates a train with the provided UUID', () => {
    const scene = makeScene();
    const manager = new TrainManager(scene, {} as any, {} as any);
    const train = manager.createInitialTrain('my-train-id');
    expect(train.getUUID()).toBe('my-train-id');
  });
});

describe('TrainManager.tryRecoverDerailedTrain()', () => {
  it('returns false when train is not derailed', () => {
    const trackManager = { getClosestTrack: jest.fn() } as any;
    const manager = new TrainManager({} as any, trackManager, {} as any);
    const train = {
      derailed: false,
      currentTrack: null,
      getMatterBody: jest.fn(),
      recover: jest.fn(),
      enginePower: 10,
    } as any;

    const recovered = manager.tryRecoverDerailedTrain(train);

    expect(recovered).toBe(false);
    expect(trackManager.getClosestTrack).not.toHaveBeenCalled();
  });

  it('snaps to the nearest track and recovers a derailed carriage', () => {
    const body = {
      x: 100,
      y: 200,
      setPosition: jest.fn(),
      setAngle: jest.fn(),
    };
    const closestTrack = {
      getTrackPoint: jest.fn().mockReturnValue({ x: 120, y: 220 }),
      getTrackAngle: jest.fn().mockReturnValue(90),
    };
    const trackManager = {
      getClosestTrack: jest.fn().mockReturnValue(closestTrack),
    } as any;
    const manager = new TrainManager({} as any, trackManager, {} as any);
    const carriage = {
      derailed: true,
      currentTrack: null,
      getMatterBody: jest.fn().mockReturnValue(body),
      recover: jest.fn(),
      enginePower: 0,
    } as any;

    const recovered = manager.tryRecoverDerailedTrain(carriage);

    expect(recovered).toBe(true);
    expect(trackManager.getClosestTrack).toHaveBeenCalled();
    expect(closestTrack.getTrackPoint).toHaveBeenCalledWith(body);
    expect(body.setPosition).toHaveBeenCalledWith(120, 220);
    expect(body.setAngle).toHaveBeenCalledWith(90);
    expect(carriage.currentTrack).toBe(closestTrack);
    expect(carriage.recover).toHaveBeenCalledTimes(1);
  });

  it('snaps to the nearest track and recovers a derailed train', () => {
    const body = {
      x: 100,
      y: 200,
      setPosition: jest.fn(),
      setAngle: jest.fn(),
    };
    const closestTrack = {
      getTrackPoint: jest.fn().mockReturnValue({ x: 120, y: 220 }),
      getTrackAngle: jest.fn().mockReturnValue(90),
    };
    const trackManager = {
      getClosestTrack: jest.fn().mockReturnValue(closestTrack),
    } as any;
    const manager = new TrainManager({} as any, trackManager, {} as any);
    const train = {
      derailed: true,
      currentTrack: null,
      getMatterBody: jest.fn().mockReturnValue(body),
      recover: jest.fn(),
      enginePower: 10,
    } as any;

    const recovered = manager.tryRecoverDerailedTrain(train);

    expect(recovered).toBe(true);
    expect(trackManager.getClosestTrack).toHaveBeenCalled();
    expect(closestTrack.getTrackPoint).toHaveBeenCalledWith(body);
    expect(body.setPosition).toHaveBeenCalledWith(120, 220);
    expect(body.setAngle).toHaveBeenCalledWith(90);
    expect(train.currentTrack).toBe(closestTrack);
    expect(train.recover).toHaveBeenCalledTimes(1);
    expect(train.enginePower).toBe(0);
  });
});

describe('TrainManager rail collision dispatch', () => {
  const { makeScene } = require('../../__mocks__/phaser');

  it('releases opposing vehicles into free-body physics and emits one incident', () => {
    const scene = makeScene();
    const track = new RailTrack(
      scene,
      new Phaser.Math.Vector2(0, 0),
      new Phaser.Math.Vector2(333, 0),
      new Phaser.Math.Vector2(667, 0),
      new Phaser.Math.Vector2(1_000, 0),
    );
    track.setUUID('main');
    const trackManager = {
      tracks: [track],
      junctions: [],
      getTrack: (uuid: string) => uuid === 'main' ? track : null,
    };
    const manager = new TrainManager(scene, trackManager as any, {} as any);
    const eastbound = manager.createInitialTrain('eastbound');
    const westbound = manager.createInitialTrain('westbound');
    manager.restoreVehicleDynamics(eastbound, {
      mode: 'on-rail',
      trackUUID: 'main',
      distance: 400,
      direction: 1,
      speedMps: 10,
      consistId: 'east',
      consistOrder: 0,
    });
    manager.restoreVehicleDynamics(westbound, {
      mode: 'on-rail',
      trackUUID: 'main',
      distance: 590,
      direction: -1,
      speedMps: 10,
      consistId: 'west',
      consistOrder: 0,
    });
    const incidents: unknown[] = [];
    const listener = (incident: unknown) => incidents.push(incident);
    EventBus.on('train:incident', listener as any);

    manager.update(0, 9);

    EventBus.off('train:incident', listener as any);
    expect(eastbound.derailed).toBe(true);
    expect(westbound.derailed).toBe(true);
    expect((eastbound.getMatterBody().body as any).isStatic).toBe(false);
    expect((westbound.getMatterBody().body as any).isStatic).toBe(false);
    expect(incidents).toHaveLength(1);
  });
});
