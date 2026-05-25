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
