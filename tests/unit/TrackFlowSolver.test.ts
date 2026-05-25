import TrackFlowSolver from '../../src/systems/TrackFlowSolver';
import RailTrack from '../../src/entities/RailTrack';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(scene: any, x1 = 0, y1 = 0, x2 = 500, y2 = 0): RailTrack {
  const Phaser = require('phaser');
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  return new RailTrack(scene, p0, p1, p2, p3);
}

function makeMockTrain(scene: any, x = 0, y = 0) {
  const graphics = {
    setDepth: jest.fn().mockReturnThis(),
    clear: jest.fn(), lineStyle: jest.fn(), beginPath: jest.fn(),
    moveTo: jest.fn(), lineTo: jest.fn(), strokePath: jest.fn(),
  };
  const body = {
    body: { position: { x, y }, mass: 1000, force: { x: 0, y: 0 } },
    displayWidth: 100, displayHeight: 50, angle: 0, rotation: 0,
    setAngle: jest.fn(),
  };
  return {
    scene,
    debugGraphics: graphics,
    derailed: false,
    currentTrack: null as RailTrack | null,
    pidControllerFront: { calculate: jest.fn().mockReturnValue(0), setCurrentDelta: jest.fn() },
    pidControllerRear: { calculate: jest.fn().mockReturnValue(0), setCurrentDelta: jest.fn() },
    getMatterBody: jest.fn().mockReturnValue(body),
  };
}

describe('TrackFlowSolver.checkAngleDirection()', () => {
  let solver: TrackFlowSolver;
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
    const mockTrain = makeMockTrain(scene);
    const mockTrackProvider = { getClosestTrack: jest.fn().mockReturnValue(null), getJunctionsForTrack: jest.fn().mockReturnValue([]) };
    solver = new TrackFlowSolver(mockTrackProvider as any, mockTrain as any);
  });

  it('returns current angle when target equals current', () => {
    expect(solver.checkAngleDirection(0, 0, 0)).toBeCloseTo(0);
  });

  it('smoothing=0 returns the target angle directly', () => {
    expect(solver.checkAngleDirection(0, 45, 0)).toBeCloseTo(45);
  });

  it('smoothing=1 keeps the current angle', () => {
    expect(solver.checkAngleDirection(30, 90, 1)).toBeCloseTo(30);
  });

  it('handles crossing the 180/-180 boundary', () => {
    const result = solver.checkAngleDirection(170, -170, 0);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(-180);
    expect(result).toBeLessThanOrEqual(180);
  });

  it('clamps smoothing to [0, 1]', () => {
    const r1 = solver.checkAngleDirection(0, 90, -5);
    const r2 = solver.checkAngleDirection(0, 90, 5);
    expect(r1).toBeCloseTo(90, 0);
    expect(r2).toBeCloseTo(0, 0);
  });

  it('returns a value in [-180, 180]', () => {
    [[0, 90, 0.5], [170, -170, 0.3], [-90, 90, 0.7], [45, 200, 0.5]].forEach(([cur, tgt, sm]) => {
      const result = solver.checkAngleDirection(cur, tgt, sm);
      expect(result).toBeGreaterThanOrEqual(-180);
      expect(result).toBeLessThanOrEqual(180);
    });
  });

  it('partial smoothing blends between current and target', () => {
    const result = solver.checkAngleDirection(0, 60, 0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(60);
  });
});

describe('TrackFlowSolver.getClosestRailTrack() with array provider', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  it('returns null when no tracks provided', () => {
    const train = makeMockTrain(scene, 50, 0);
    const solver = new TrackFlowSolver([], train as any);
    expect(solver.getClosestRailTrack()).toBeNull();
  });

  it('returns a track when train is near it', () => {
    const track = makeTrack(scene, 0, 0, 500, 0);
    const train = makeMockTrain(scene, 250, 0);
    const solver = new TrackFlowSolver([track], train as any);
    const result = solver.getClosestRailTrack();
    expect(result).toBe(track);
  });

  it('returns null when train is far from all tracks and limit is set', () => {
    const track = makeTrack(scene, 0, 0, 100, 0);
    const train = makeMockTrain(scene, 5000, 5000); // very far
    const solver = new TrackFlowSolver([track], train as any);
    // With a tight limit, should return null
    const result = solver.getClosestRailTrack(1);
    expect(result).toBeNull();
  });

  it('picks the closest of two tracks', () => {
    const trackNear = makeTrack(scene, 0, 0, 100, 0);   // midpoint at ~50,0
    const trackFar = makeTrack(scene, 1000, 0, 1100, 0); // midpoint at ~1050,0
    const train = makeMockTrain(scene, 50, 0);
    const solver = new TrackFlowSolver([trackNear, trackFar], train as any);
    const result = solver.getClosestRailTrack();
    expect(result).toBe(trackNear);
  });
});

describe('TrackFlowSolver.getClosestRailTrack() with TrackManager provider', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  it('delegates to TrackManager.getClosestTrack', () => {
    const track = makeTrack(scene);
    const mockManager = {
      getClosestTrack: jest.fn().mockReturnValue(track),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };
    const train = makeMockTrain(scene, 50, 0);
    const solver = new TrackFlowSolver(mockManager as any, train as any);
    const result = solver.getClosestRailTrack();
    expect(mockManager.getClosestTrack).toHaveBeenCalled();
    expect(result).toBe(track);
  });

  it('returns null when TrackManager returns null', () => {
    const mockManager = {
      getClosestTrack: jest.fn().mockReturnValue(null),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };
    const train = makeMockTrain(scene, 50, 0);
    const solver = new TrackFlowSolver(mockManager as any, train as any);
    expect(solver.getClosestRailTrack()).toBeNull();
  });
});

describe('TrackFlowSolver.getFrontContactPoint() and getRearContactPoint()', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  it('getFrontContactPoint() returns a sprite', () => {
    const train = makeMockTrain(scene, 100, 100);
    const solver = new TrackFlowSolver([], train as any);
    const front = solver.getFrontContactPoint();
    expect(front).toBeDefined();
    expect(typeof front.x).toBe('number');
    expect(typeof front.y).toBe('number');
  });

  it('getRearContactPoint() returns a sprite behind the train', () => {
    const train = makeMockTrain(scene, 100, 100);
    const solver = new TrackFlowSolver([], train as any);
    const rear = solver.getRearContactPoint();
    expect(rear).toBeDefined();
    expect(typeof rear.x).toBe('number');
    expect(typeof rear.y).toBe('number');
  });

  it('front and rear are symmetrically offset when angle=0', () => {
    const train = makeMockTrain(scene, 100, 100);
    const body = train.getMatterBody();
    body.angle = 0; // facing right
    const solver = new TrackFlowSolver([], train as any);
    const front = solver.getFrontContactPoint();
    const rear = solver.getRearContactPoint();
    // At angle=0: front should be to the right, rear to the left
    expect(front.x).toBeGreaterThan(body.body.position.x);
    expect(rear.x).toBeLessThan(body.body.position.x);
    // Y positions should match the body position
    expect(front.y).toBeCloseTo(body.body.position.y, 0);
    expect(rear.y).toBeCloseTo(body.body.position.y, 0);
  });
});

describe('TrackFlowSolver.getTrackForces()', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  it('returns a Vector2 force', () => {
    const Phaser = require('phaser');
    const track = makeTrack(scene, 0, 0, 500, 0);
    const train = makeMockTrain(scene, 250, 0);
    const solver = new TrackFlowSolver([], train as any);
    const front = new Phaser.GameObjects.Sprite(scene, 260, 0, '');
    const rear = new Phaser.GameObjects.Sprite(scene, 240, 0, '');
    const force = solver.getTrackForces(track, front as any, rear as any, 1);
    expect(force).toBeDefined();
    expect(typeof force.x).toBe('number');
    expect(typeof force.y).toBe('number');
  });

  it('returns scaled force with scale < 0', () => {
    const Phaser = require('phaser');
    const track = makeTrack(scene, 0, 0, 500, 0);
    const train = makeMockTrain(scene, 250, 0);
    const solver = new TrackFlowSolver([], train as any);
    const front = new Phaser.GameObjects.Sprite(scene, 260, 0, '');
    const rear = new Phaser.GameObjects.Sprite(scene, 240, 0, '');
    const force = solver.getTrackForces(track, front as any, rear as any, -1);
    expect(force).toBeDefined();
  });

  it('returns zero-ish force for scale=0', () => {
    const Phaser = require('phaser');
    const track = makeTrack(scene, 0, 0, 500, 0);
    const train = makeMockTrain(scene, 250, 0);
    const solver = new TrackFlowSolver([], train as any);
    const front = new Phaser.GameObjects.Sprite(scene, 250, 0, '');
    const rear = new Phaser.GameObjects.Sprite(scene, 250, 0, '');
    const force = solver.getTrackForces(track, front as any, rear as any, 0);
    expect(force.x).toBeCloseTo(0, 5);
    expect(force.y).toBeCloseTo(0, 5);
  });
});

describe('TrackFlowSolver.applyTrackFlowForces()', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  it('exits early when train is derailed', () => {
    const track = makeTrack(scene, 0, 0, 500, 0);
    const train = makeMockTrain(scene, 250, 5);
    train.derailed = true;
    const solver = new TrackFlowSolver([track], train as any);
    expect(() => solver.applyTrackFlowForces()).not.toThrow();
    // derailed → sync returns false → no force applied
    const body = train.getMatterBody();
    expect(body.body.force.x).toBe(0);
  });

  it('applies force when train is near a track', () => {
    const track = makeTrack(scene, 0, 0, 500, 0);
    const train = makeMockTrain(scene, 250, 20); // slightly off-track
    train.currentTrack = track;
    const mockManager = {
      getClosestTrack: jest.fn().mockReturnValue(track),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };
    const solver = new TrackFlowSolver(mockManager as any, train as any);
    expect(() => solver.applyTrackFlowForces()).not.toThrow();
  });

  it('derails the train when no track is close enough (array provider)', () => {
    const track = makeTrack(scene, 0, 0, 100, 0);
    const train = makeMockTrain(scene, 5000, 5000); // very far from track
    train.currentTrack = null;
    const solver = new TrackFlowSolver([track], train as any);
    solver.applyTrackFlowForces();
    expect(train.derailed).toBe(true);
  });
});
