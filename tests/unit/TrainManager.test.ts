import { TrainManager } from '../../src/managers/TrainManager';

describe('TrainManager.getBounds()', () => {
  let manager: TrainManager;

  beforeEach(() => {
    // TrainManager only needs scene/trackManager/cameraController for construction
    // We test getBounds() which is pure geometry math
    manager = new TrainManager({} as any, {} as any, {} as any);
  });

  it('returns null when trainBody is falsy', () => {
    expect(manager.getBounds(null as any)).toBeNull();
  });

  it('returns bounding box with min/max/corners for a horizontal train', () => {
    // Axis-aligned (angle=0) train at (100, 200) with 80x40 display size
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
    // 45-degree rotation → bounding box is larger
    const trainBody: any = { displayWidth: 100, displayHeight: 50, x: 0, y: 0, angle: 45 };
    const bounds = manager.getBounds(trainBody);
    const width = bounds!.max.x - bounds!.min.x;
    const height = bounds!.max.y - bounds!.min.y;
    // At 45 degrees, bounding box should exceed the smaller dimension
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
