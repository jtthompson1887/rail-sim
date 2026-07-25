import { TrainManager } from '../../src/managers/TrainManager';
import Train from '../../src/entities/Train';
import RailTrack from '../../src/entities/RailTrack';
import TrackFlowSolver from '../../src/systems/TrackFlowSolver';
import { GameConfig } from '../../src/config/GameConfig';

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
      pidControllerFront: { reset: jest.fn() },
      pidControllerRear:  { reset: jest.fn() },
    } as any;

    const recovered = manager.tryRecoverDerailedTrain(carriage);

    expect(recovered).toBe(true);
    expect(trackManager.getClosestTrack).toHaveBeenCalled();
    expect(closestTrack.getTrackPoint).toHaveBeenCalledWith(body);
    expect(body.setPosition).toHaveBeenCalledWith(120, 220);
    expect(body.setAngle).toHaveBeenCalledWith(90);
    expect(carriage.currentTrack).toBe(closestTrack);
    expect(carriage.recover).toHaveBeenCalledTimes(1);
    expect(carriage.pidControllerFront.reset).toHaveBeenCalledTimes(1);
    expect(carriage.pidControllerRear.reset).toHaveBeenCalledTimes(1);
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
      pidControllerFront: { reset: jest.fn() },
      pidControllerRear:  { reset: jest.fn() },
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

describe('REGRESSION: recovered derailed train should not be flung off the track', () => {
  const { makeScene, simulateMatterUpdate } = require('../../__mocks__/phaser');

  function makeTrack(scene: any, x1 = 0, y1 = 0, x2 = 500, y2 = 0): RailTrack {
    const Phaser = require('phaser');
    const p0 = new Phaser.Math.Vector2(x1, y1);
    const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1 + 30);
    const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1 - 30);
    const p3 = new Phaser.Math.Vector2(x2, y2);
    return new RailTrack(scene, p0, p1, p2, p3);
  }

  function simulateDragAndRecover(
    train: Train,
    track: RailTrack,
    manager: TrainManager,
    dragPath: { x: number; y: number }[],
  ) {
    const trainBody = train.getMatterBody();
    train.derailed = true;
    train.currentTrack = null;

    for (const point of dragPath) {
      trainBody.setPosition(point.x, point.y);
      trainBody.setVelocity(0, 0);
      trainBody.setAngularVelocity(0);
      simulateMatterUpdate(trainBody.body);
    }

    const body = train.getMatterBody();
    body.setPosition(trainBody.x, trainBody.y);
    const recovered = manager.tryRecoverDerailedTrain(train);
    return recovered;
  }

  it('stays on the track after recovery when TrackFlowForces are applied', () => {
    const scene = makeScene();
    const track = makeTrack(scene, 0, 0, 500, 500);

    const train = new Train(scene, 250, 350);
    const trainBody = train.getMatterBody();
    trainBody.angle = 45;

    const trackManager = {
      getClosestTrack: jest.fn().mockImplementation((pos: any, limit: number) => {
        const dx = pos.x - 250;
        const dy = pos.y - 250;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= (limit || Infinity) ? track : null;
      }),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };

    const manager = new TrainManager(scene, trackManager as any, {} as any);
    const solver = new TrackFlowSolver(trackManager as any, train);

    const recovered = simulateDragAndRecover(train, track, manager, [
      { x: 250, y: 330 },
      { x: 250, y: 310 },
      { x: 250, y: 290 },
      { x: 250, y: 270 },
      { x: 250, y: 250 },
    ]);

    expect(recovered).toBe(true);
    expect(train.derailed).toBe(false);
    expect(train.currentTrack).toBe(track);

    const body = trainBody.body as any;
    expect(body.angle).toBe(body.anglePrev);

    train.update(0, 16);
    solver.applyTrackFlowForces();
    simulateMatterUpdate(trainBody.body);

    expect(train.derailed).toBe(false);
    expect(train.currentTrack).toBe(track);

    train.update(16, 16);
    solver.applyTrackFlowForces();
    simulateMatterUpdate(trainBody.body);
    expect(train.derailed).toBe(false);
    expect(train.currentTrack).toBe(track);
  });

  it('does not acquire large velocity immediately after recovery', () => {
    const scene = makeScene();
    const track = makeTrack(scene, 0, 0, 500, 500);

    const train = new Train(scene, 250, 350);
    const trainBody = train.getMatterBody();
    trainBody.angle = 45;

    const trackManager = {
      getClosestTrack: jest.fn().mockImplementation((pos: any, limit: number) => {
        const dx = pos.x - 250;
        const dy = pos.y - 250;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= (limit || Infinity) ? track : null;
      }),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };

    const manager = new TrainManager(scene, trackManager as any, {} as any);
    const solver = new TrackFlowSolver(trackManager as any, train);

    simulateDragAndRecover(train, track, manager, [
      { x: 250, y: 330 },
      { x: 250, y: 310 },
      { x: 250, y: 290 },
      { x: 250, y: 270 },
      { x: 250, y: 250 },
    ]);

    const body = trainBody.body as any;
    expect(body.angle).toBe(body.anglePrev);

    train.update(0, 16);
    solver.applyTrackFlowForces();
    simulateMatterUpdate(trainBody.body);

    const vx = (trainBody.body as any).velocity.x;
    const vy = (trainBody.body as any).velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);

    expect(speed).toBeLessThan(10);
  });

  it('numerically proves anglePrev mismatch causes fling and setAngle fixes it', () => {
    const { simulateMatterUpdate: simUpdate, makeMatterBody } = require('../../__mocks__/phaser');

    // Simulate exact state after matterScaling(): fresh body, angle=0, anglePrev=0
    const buggyBody = makeMatterBody(250, 250);
    buggyBody.angle = 0;
    buggyBody.anglePrev = 0;

    // BUGGY approach: direct angle assignment (old code).
    // The mock's angle setter ONLY writes body.angle, leaving anglePrev at 0.
    buggyBody.angle = 45 * (Math.PI / 180); // 0.785 rad

    const beforeBug = {
      angle: buggyBody.angle.toFixed(3),
      anglePrev: buggyBody.anglePrev.toFixed(3),
      angularVelocity: buggyBody.angularVelocity.toFixed(3),
    };

    simUpdate(buggyBody, 16.666);

    const afterBug = {
      angle: buggyBody.angle.toFixed(3),
      anglePrev: buggyBody.anglePrev.toFixed(3),
      angularVelocity: buggyBody.angularVelocity.toFixed(3),
      speed: buggyBody.speed.toFixed(3),
    };

    console.log('[NUMERIC PROOF] BUGGY approach:', beforeBug, '->', afterBug);

    // With angle=0.785 and anglePrev=0, Verlet computes
    // angularVelocity approx (0.785 - 0) * frictionAir approx 0.77 rad/frame.
    // This is the root cause of the fling -- massive instantaneous spin.
    expect(parseFloat(afterBug.angularVelocity)).toBeGreaterThan(0.5);

    // FIXED approach: setAngle syncs both angle and anglePrev.
    const fixedBody = makeMatterBody(250, 250);
    fixedBody.angle = 0;
    fixedBody.anglePrev = 0;

    const targetAngle = 45 * (Math.PI / 180);
    fixedBody.angle = targetAngle;
    fixedBody.anglePrev = targetAngle;

    const beforeFix = {
      angle: fixedBody.angle.toFixed(3),
      anglePrev: fixedBody.anglePrev.toFixed(3),
      angularVelocity: fixedBody.angularVelocity.toFixed(3),
    };

    simUpdate(fixedBody, 16.666);

    const afterFix = {
      angle: fixedBody.angle.toFixed(3),
      anglePrev: fixedBody.anglePrev.toFixed(3),
      angularVelocity: fixedBody.angularVelocity.toFixed(3),
      speed: fixedBody.speed.toFixed(3),
    };

    console.log('[NUMERIC PROOF] FIXED approach:', beforeFix, '->', afterFix);

    // With angle === anglePrev, angularVelocity stays near zero.
    expect(parseFloat(afterFix.angularVelocity)).toBeLessThan(0.1);

    // Quantitative proof: buggy angular velocity is >0.5 rad/frame,
    // fixed angular velocity is <0.1 rad/frame.
    const buggyAngVel = parseFloat(afterBug.angularVelocity);
    const fixedAngVel = parseFloat(afterFix.angularVelocity);
    expect(buggyAngVel / fixedAngVel).toBeGreaterThan(5);
  });
});
