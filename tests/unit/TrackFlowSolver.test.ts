import TrackFlowSolver from '../../src/systems/TrackFlowSolver';
import RailTrack from '../../src/entities/RailTrack';
import Train from '../../src/entities/Train';
import TrackManager from '../../src/managers/TrackManager';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import { WorldOpportunityGenerator } from '../../src/systems/WorldOpportunityGenerator';
import { GameConfig } from '../../src/config/GameConfig';

const {
  makeScene,
  makeMatterBody,
  simulateMatterUpdate,
} = require('../../__mocks__/phaser');

const REAL_TRAIN_DISPLAY_WIDTH = 2_305 * GameConfig.TRAIN.SCALE_X;

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
  const matterBody = makeMatterBody(x, y);
  matterBody.mass = 1000;
  const body = {
    body: matterBody,
    displayWidth: REAL_TRAIN_DISPLAY_WIDTH, displayHeight: 50, angle: 0, rotation: 0,
    setAngle: jest.fn(),
  };
  return {
    scene,
    debugGraphics: graphics,
    derailed: false,
    currentTrack: null as RailTrack | null,
  pidControllerFront: { calculate: jest.fn().mockReturnValue(0), setCurrentDelta: jest.fn(), reset: jest.fn(), resetToError: jest.fn() },
  pidControllerRear: { calculate: jest.fn().mockReturnValue(0), setCurrentDelta: jest.fn(), reset: jest.fn(), resetToError: jest.fn() },
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

  afterEach(() => {
    jest.restoreAllMocks();
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
    (solver as any)._handoffGuidanceLimited = true;
    (solver as any)._handoffPreviousTrack = track;
    (solver as any)._handoffFrontTrack = track;
    (solver as any)._handoffRearTrack = track;
    (solver as any)._handoffSettledFrames = 3;
    solver.applyTrackFlowForces();
    expect(train.derailed).toBe(true);
    expect((solver as any)._handoffGuidanceLimited).toBe(false);
    expect((solver as any)._handoffPreviousTrack).toBeNull();
    expect((solver as any)._handoffFrontTrack).toBeNull();
    expect((solver as any)._handoffRearTrack).toBeNull();
    expect((solver as any)._handoffFrontRoute).toEqual([]);
    expect((solver as any)._handoffRearRoute).toEqual([]);
    expect((solver as any)._handoffSettledFrames).toBe(0);
  });

  it('preserves coasting momentum across a connected production-curve handoff', () => {
    const seed = 'task15-manual-ash-dry';
    const generated = new WorldOpportunityGenerator(
      new TerrainGenerator(seed),
    ).generate({
      generationConfigVersion: 1,
      seed,
      biome: 'temperate',
      constructionDifficultyId: 'standard',
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const detour = generated.opportunity.corridors.find(
      ({ id }) => id === 'detour',
    )!;
    const [firstDef, secondDef] = detour.feasibilityWitness.segments;
    const Phaser = require('phaser');
    const fromDef = (def: typeof firstDef): RailTrack => new RailTrack(
      scene,
      new Phaser.Math.Vector2(def.geometry.p0.x, def.geometry.p0.y),
      new Phaser.Math.Vector2(def.geometry.p1.x, def.geometry.p1.y),
      new Phaser.Math.Vector2(def.geometry.p2.x, def.geometry.p2.y),
      new Phaser.Math.Vector2(def.geometry.p3.x, def.geometry.p3.y),
    );
    const first = fromDef(firstDef);
    const second = fromDef(secondDef);
    first.setUUID('handoff-first');
    second.setUUID('handoff-second');
    const manager = new TrackManager(scene);
    manager.addTrack(first);
    manager.addTrack(second);
    expect(first.getNext()).toBe(second);

    const start = first.getCurvePath().getPoint(1);
    const tangent = first.getCurvePath().getTangent(1);
    const train = new Train(scene, start.x, start.y);
    const body = train.getMatterBody();
    body.displayWidth = REAL_TRAIN_DISPLAY_WIDTH;
    expect(body.displayWidth).toBe(345.75);
    train.currentTrack = first;
    train.enginePower = 0;
    body.setAngle(Math.atan2(tangent.y, tangent.x) * 180 / Math.PI);
    body.setVelocity(tangent.x * 0.75, tangent.y * 0.75);
    let now = 10_000;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const solver = new TrackFlowSolver(manager, train);

    let speedBeforeHandoff: number | null = null;
    const postHandoffSpeeds: number[] = [];
    const postHandoffContactErrors: number[] = [];
    for (let frame = 0; frame < 480; frame++) {
      train.update(frame * 16.667, 16.667);
      const before = Math.hypot(
        body.body.velocity.x,
        body.body.velocity.y,
      ) * 60;
      solver.applyTrackFlowForces();
      const switched = train.currentTrack === second;
      simulateMatterUpdate(body.body, 16.667);
      now += 16.667;
      if (switched) {
        speedBeforeHandoff ??= before;
        postHandoffSpeeds.push(Math.hypot(
          body.body.velocity.x,
          body.body.velocity.y,
        ) * 60);
        const frontContact = solver.getFrontContactPoint();
        const rearContact = solver.getRearContactPoint();
        const frontTrack = (solver as any)._handoffFrontTrack ?? second;
        const rearTrack = (solver as any)._handoffRearTrack ?? second;
        postHandoffContactErrors.push(Math.max(
          frontTrack.getTrackPoint(frontContact).distance(
            new Phaser.Math.Vector2(frontContact.x, frontContact.y),
          ),
          rearTrack.getTrackPoint(rearContact).distance(
            new Phaser.Math.Vector2(rearContact.x, rearContact.y),
          ),
        ));
        if (postHandoffSpeeds.length === 180) break;
      }
    }

    expect(speedBeforeHandoff).not.toBeNull();
    expect(postHandoffSpeeds).toHaveLength(180);
    expect(train.derailed).toBe(false);
    expect(Math.max(...postHandoffSpeeds)).toBeLessThan(
      speedBeforeHandoff! * 1.5,
    );
    expect(Math.min(...postHandoffSpeeds.slice(0, 24))).toBeGreaterThan(
      speedBeforeHandoff! * 0.5,
    );
    expect(Math.max(...postHandoffContactErrors.slice(-24))).toBeLessThanOrEqual(
      GameConfig.TRACK.RAIL_TRACK_WIDTH * GameConfig.TRACK.SCALE * 0.5,
    );
    expect((solver as any)._handoffFrontTrack).toBe(second);
    expect((solver as any)._handoffRearTrack).toBe(first);
    expect((solver as any)._handoffGuidanceLimited).toBe(true);
  });

  it('migrates a real-width trailing contact naturally under power and releases durably', () => {
    const first = makeTrack(scene, -500, 0, 0, 0);
    const second = makeTrack(scene, 0, 0, 500, 0);
    const train = makeMockTrain(scene, 0, 0);
    train.currentTrack = first;
    train.pidControllerFront.calculate.mockImplementation((error: number) => error);
    train.pidControllerRear.calculate.mockImplementation((error: number) => error);
    const manager = {
      getClosestTrack: jest.fn().mockReturnValue(second),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };
    const solver = new TrackFlowSolver(manager as any, train as any);
    const matterImage = train.getMatterBody();
    const body = matterImage.body;
    body.velocity.x = 0.3;
    (solver as any)._switchToTrack(second);

    expect(matterImage.displayWidth).toBe(345.75);
    expect((solver as any)._handoffFrontTrack).toBe(second);
    expect((solver as any)._handoffRearTrack).toBe(first);

    for (let frame = 0; frame < 180; frame++) {
      solver.applyTrackFlowForces();
      simulateMatterUpdate(body, 16.667);
    }
    expect((solver as any)._handoffRearTrack).toBe(first);
    expect((solver as any)._handoffGuidanceLimited).toBe(true);

    const speeds: number[] = [];
    const rearPidResetsBeforePower =
      train.pidControllerRear.resetToError.mock.calls.length;
    let rearMigrated = false;
    let released = false;
    for (let frame = 0; frame < 240; frame++) {
      body.force.x += GameConfig.TRAIN.ENGINE_POWER;
      solver.applyTrackFlowForces();
      if ((solver as any)._handoffRearTrack === second) {
        rearMigrated = true;
      }
      if (rearMigrated && (solver as any)._handoffGuidanceLimited) {
        expect((solver as any)._handoffRearTrack).toBe(second);
      }
      simulateMatterUpdate(body, 16.667);
      speeds.push(Math.hypot(body.velocity.x, body.velocity.y) * 60);
      if (!(solver as any)._handoffGuidanceLimited) {
        released = true;
        break;
      }
    }

    expect(released).toBe(true);
    expect(rearMigrated).toBe(true);
    expect(train.pidControllerRear.resetToError.mock.calls.length)
      .toBeGreaterThan(rearPidResetsBeforePower);
    expect((solver as any)._handoffRearTrack).toBeNull();
    expect(Math.max(...speeds)).toBeLessThan(400);

    const speedAtRelease = speeds[speeds.length - 1];
    const postReleaseSpeeds: number[] = [];
    for (let frame = 0; frame < 24; frame++) {
      solver.applyTrackFlowForces();
      simulateMatterUpdate(body, 16.667);
      postReleaseSpeeds.push(Math.hypot(body.velocity.x, body.velocity.y) * 60);
    }
    expect(Math.max(...postReleaseSpeeds)).toBeLessThan(
      speedAtRelease * 1.5,
    );
  });

  it.each([0, 1e-12])(
    'keeps %p-speed handoff guidance limited until contact guidance settles',
    (initialSpeed) => {
      const currentTrack = makeTrack(scene, 0, 0, 500, 0);
      const nextTrack = makeTrack(scene, 0, 50, 500, 50);
      const train = makeMockTrain(scene, 250, 45);
      train.currentTrack = currentTrack;
      train.pidControllerFront.calculate.mockImplementation((error: number) => error);
      train.pidControllerRear.calculate.mockImplementation((error: number) => error);

      const manager = {
        getClosestTrack: jest.fn().mockReturnValue(nextTrack),
        getJunctionsForTrack: jest.fn().mockReturnValue([]),
      };
      let now = 10_000;
      jest.spyOn(performance, 'now').mockImplementation(() => now);
      const solver = new TrackFlowSolver(manager as any, train as any);
      const body = train.getMatterBody().body;
      body.velocity.x = initialSpeed;
      body.force.x = 3;

      solver.applyTrackFlowForces();

      expect(train.currentTrack).toBe(nextTrack);
      expect(body.force.x).toBe(3);
      const guidanceMagnitude = Math.abs(body.force.y);
      const maxGuidanceForce = body.mass * initialSpeed * 0.01
        / (16.667 * 16.667);
      expect(guidanceMagnitude).toBeLessThanOrEqual(
        maxGuidanceForce + Number.EPSILON,
      );
      expect(Number.isFinite(body.force.x)).toBe(true);
      expect(Number.isFinite(body.force.y)).toBe(true);

      body.force.x = 0;
      body.force.y = 0;
      now += 10_000;
      solver.applyTrackFlowForces();

      expect(Math.hypot(body.force.x, body.force.y)).toBeLessThanOrEqual(
        maxGuidanceForce + Number.EPSILON,
      );
    },
  );

  it('requires sustained physical settlement and resets progress on violations', () => {
    const currentTrack = makeTrack(scene, 0, 0, 500, 0);
    const nextTrack = makeTrack(scene, 0, 50, 500, 50);
    const train = makeMockTrain(scene, 250, 45);
    train.currentTrack = currentTrack;
    train.pidControllerFront.calculate.mockImplementation((error: number) => error);
    train.pidControllerRear.calculate.mockImplementation((error: number) => error);
    const manager = {
      getClosestTrack: jest.fn().mockReturnValue(nextTrack),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };
    const solver = new TrackFlowSolver(manager as any, train as any);
    const body = train.getMatterBody().body;
    body.velocity.x = 1;

    solver.applyTrackFlowForces();
    expect((solver as any)._handoffGuidanceLimited).toBe(true);

    body.force.x = 0;
    body.force.y = 0;
    body.position.y = 50;
    solver.applyTrackFlowForces();
    expect((solver as any)._handoffGuidanceLimited).toBe(true);

    body.force.x = 0;
    body.force.y = 0;
    body.position.y = 45;
    body.velocity.y = 0;
    solver.applyTrackFlowForces();
    expect((solver as any)._handoffSettledFrames).toBe(0);
    expect((solver as any)._handoffGuidanceLimited).toBe(true);

    body.position.y = 50;
    body.force.x = 0;
    body.force.y = 0;
    solver.applyTrackFlowForces();
    expect((solver as any)._handoffSettledFrames).toBe(1);

    body.force.x = 0;
    body.force.y = 0;
    body.velocity.y = 1;
    solver.applyTrackFlowForces();
    expect((solver as any)._handoffSettledFrames).toBe(0);
    expect((solver as any)._handoffGuidanceLimited).toBe(true);

    body.velocity.y = 0;
    for (let frame = 0; frame < 6; frame++) {
      body.force.x = 0;
      body.force.y = 0;
      solver.applyTrackFlowForces();
    }
    expect((solver as any)._handoffGuidanceLimited).toBe(false);

    body.force.x = 0;
    body.force.y = 0;
    body.position.y = 45;
    solver.applyTrackFlowForces();
    expect(body.force.y).toBeCloseTo(10);
  });

  it('reactivates settled handoff limiting on a second switch', () => {
    const firstTrack = makeTrack(scene, 0, 0, 500, 0);
    const secondTrack = makeTrack(scene, 0, 50, 500, 50);
    const thirdTrack = makeTrack(scene, 0, 100, 500, 100);
    const train = makeMockTrain(scene, 250, 50);
    train.currentTrack = firstTrack;
    train.pidControllerFront.calculate.mockImplementation((error: number) => error);
    train.pidControllerRear.calculate.mockImplementation((error: number) => error);
    const manager = {
      getClosestTrack: jest.fn().mockReturnValue(secondTrack),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };
    const solver = new TrackFlowSolver(manager as any, train as any);
    const body = train.getMatterBody().body;
    body.velocity.x = 1;

    solver.applyTrackFlowForces();
    for (let frame = 0; frame < 6; frame++) {
      body.force.x = 0;
      body.force.y = 0;
      solver.applyTrackFlowForces();
    }
    expect((solver as any)._handoffGuidanceLimited).toBe(false);

    body.position.y = 95;
    (solver as any)._switchToTrack(thirdTrack);
    expect((solver as any)._handoffGuidanceLimited).toBe(true);
    expect((solver as any)._handoffPreviousTrack).toBe(secondTrack);
    expect((solver as any)._handoffSettledFrames).toBe(0);

    manager.getClosestTrack.mockReturnValue(thirdTrack);
    body.force.x = 0;
    body.force.y = 0;
    solver.applyTrackFlowForces();
    const safeForce = body.mass * body.velocity.x * 0.01
      / (16.667 * 16.667);
    expect(Math.hypot(body.force.x, body.force.y)).toBeLessThanOrEqual(
      safeForce + Number.EPSILON,
    );
  });

  it('preserves a trailing contact assignment across overlapping handoffs', () => {
    const Phaser = require('phaser');
    const firstTrack = makeTrack(scene, -500, 0, 0, 0);
    const shortMiddleTrack = makeTrack(scene, 0, 0, 100, 0);
    const thirdTrack = makeTrack(scene, 100, 0, 600, 0);
    const train = makeMockTrain(scene, 0, 0);
    train.currentTrack = firstTrack;
    train.pidControllerFront.calculate.mockImplementation((error: number) => error);
    train.pidControllerRear.calculate.mockImplementation((error: number) => error);
    const manager = {
      getClosestTrack: jest.fn().mockReturnValue(shortMiddleTrack),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };
    const solver = new TrackFlowSolver(manager as any, train as any);
    const body = train.getMatterBody().body;
    body.velocity.x = 1;

    (solver as any)._switchToTrack(shortMiddleTrack);
    expect((solver as any)._handoffFrontTrack).toBe(shortMiddleTrack);
    expect((solver as any)._handoffRearTrack).toBe(firstTrack);

    body.position.x = REAL_TRAIN_DISPLAY_WIDTH * 0.4;
    (solver as any)._switchToTrack(thirdTrack);

    expect((solver as any)._handoffPreviousTrack).toBe(shortMiddleTrack);
    expect((solver as any)._handoffFrontTrack).toBe(thirdTrack);
    expect((solver as any)._handoffRearTrack).toBe(firstTrack);

    manager.getClosestTrack.mockReturnValue(thirdTrack);
    body.force.x = 0;
    body.force.y = 0;
    solver.applyTrackFlowForces();
    expect((solver as any)._handoffRearTrack).toBe(firstTrack);

    const rearAssignments = [firstTrack];
    let maxAssignedError = 0;
    for (let step = 0; step < 50; step++) {
      body.position.x += 5;
      body.force.x = 0;
      body.force.y = 0;
      solver.applyTrackFlowForces();
      const rearTrack = (
        (solver as any)._handoffRearTrack ?? thirdTrack
      ) as RailTrack;
      const rearPoint = solver.getRearContactPoint();
      maxAssignedError = Math.max(
        maxAssignedError,
        rearTrack.getTrackPoint(rearPoint).distance(
          new Phaser.Math.Vector2(rearPoint.x, rearPoint.y),
        ),
      );
      if (rearAssignments[rearAssignments.length - 1] !== rearTrack) {
        rearAssignments.push(rearTrack);
      }
    }

    expect(rearAssignments).toEqual([
      firstTrack,
      shortMiddleTrack,
      thirdTrack,
    ]);
    expect(maxAssignedError).toBeLessThanOrEqual(
      GameConfig.TRACK.RAIL_TRACK_WIDTH * GameConfig.TRACK.SCALE * 0.5 + 5,
    );
  });

  it('does not cap ordinary off-track guidance when no handoff occurred', () => {
    const track = makeTrack(scene, 0, 0, 500, 0);
    const train = makeMockTrain(scene, 250, 20);
    train.currentTrack = track;
    train.pidControllerFront.calculate.mockImplementation((error: number) => error);
    train.pidControllerRear.calculate.mockImplementation((error: number) => error);
    const manager = {
      getClosestTrack: jest.fn().mockReturnValue(track),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };
    const solver = new TrackFlowSolver(manager as any, train as any);
    const body = train.getMatterBody().body;

    solver.applyTrackFlowForces();

    expect(body.force.x).toBeCloseTo(0);
    expect(body.force.y).toBeCloseTo(-40);
  });
});

describe('TrackFlowSolver — hysteresis & parallel-deadband (oscillation prevention)', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  it('Given a train on a track, When a parallel track is only marginally closer, Then the train stays on its current track', () => {
    // Two parallel horizontal tracks separated by 25 px (less than PARALLEL_DEADBAND = 30)
    const currentTrack = makeTrack(scene, 0, 0, 500, 0);   // y = 0
    const parallelTrack = makeTrack(scene, 0, 25, 500, 25); // y = 25 — very close

    // Train sits exactly on the parallel track so it is marginally closer, but
    // separation between the tracks (25 px) is inside the PARALLEL_DEADBAND (30 px).
    const train = makeMockTrain(scene, 250, 25);
    train.currentTrack = currentTrack;

    const mockManager = {
      getClosestTrack: jest.fn().mockReturnValue(parallelTrack),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };

    // Wind the clock back so we are past any cooldown period.
    jest.spyOn(performance, 'now').mockReturnValue(Date.now() + 10_000);

    const solver = new TrackFlowSolver(mockManager as any, train as any);
    solver.applyTrackFlowForces();

    // The train should remain on currentTrack despite parallelTrack being closer.
    expect(train.currentTrack).toBe(currentTrack);

    jest.restoreAllMocks();
  });

  it('Given a train on a track, When it is within the switch cooldown period, Then track switches are suppressed', () => {
    const currentTrack = makeTrack(scene, 0, 0, 500, 0);
    // A second track far enough away to clear the deadband (> 30 px) and enough
    // hysteresis advantage (> 20 px) — the only reason it should not switch is the cooldown.
    const farTrack = makeTrack(scene, 0, 60, 500, 60);

    const train = makeMockTrain(scene, 250, 55); // very close to farTrack
    train.currentTrack = currentTrack;

    const mockManager = {
      getClosestTrack: jest.fn().mockReturnValue(farTrack),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };

    // Simulate that a switch just happened by setting performance.now to a recent value.
    const now = Date.now();
    jest.spyOn(performance, 'now').mockReturnValue(now);

    const solver = new TrackFlowSolver(mockManager as any, train as any);

    // Manually record a very recent switch (internal field via cast).
    (solver as any)._lastSwitchTime = now - 10; // only 10 ms ago

    solver.applyTrackFlowForces();

    // The train should remain on currentTrack because cooldown has not expired.
    expect(train.currentTrack).toBe(currentTrack);

    jest.restoreAllMocks();
  });

  it('Given a train on a track, When a genuinely closer track is outside the deadband and cooldown has elapsed, Then the train switches tracks', () => {
    const currentTrack = makeTrack(scene, 0, 0, 500, 0);   // train is 50 px away from this
    const betterTrack  = makeTrack(scene, 0, 50, 500, 50);  // train is ~0 px away from this (separation 50 px > deadband 30 px)

    const train = makeMockTrain(scene, 250, 50); // right on betterTrack
    train.currentTrack = currentTrack;

    const mockManager = {
      getClosestTrack: jest.fn().mockReturnValue(betterTrack),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };

    // Past the cooldown window.
    jest.spyOn(performance, 'now').mockReturnValue(Date.now() + 10_000);

    const solver = new TrackFlowSolver(mockManager as any, train as any);
    solver.applyTrackFlowForces();

    // The train should switch to betterTrack.
    expect(train.currentTrack).toBe(betterTrack);

    jest.restoreAllMocks();
  });

  it('Given a track switch, When _switchToTrack is called, Then PID controllers are soft-reset to current error', () => {
    const currentTrack = makeTrack(scene, 0, 0, 500, 0);
    const betterTrack  = makeTrack(scene, 0, 50, 500, 50);

    const train = makeMockTrain(scene, 250, 50);
    train.currentTrack = currentTrack;

    const mockManager = {
      getClosestTrack: jest.fn().mockReturnValue(betterTrack),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };

    jest.spyOn(performance, 'now').mockReturnValue(Date.now() + 10_000);

    const solver = new TrackFlowSolver(mockManager as any, train as any);
    solver.applyTrackFlowForces();

    expect(train.pidControllerFront.resetToError).toHaveBeenCalled();
    expect(train.pidControllerRear.resetToError).toHaveBeenCalled();

    jest.restoreAllMocks();
  });
});
