import { InputManager } from '../../src/systems/InputManager';
import { TrainManager } from '../../src/managers/TrainManager';
import Train from '../../src/entities/Train';
import RailTrack from '../../src/entities/RailTrack';
import TrackFlowSolver from '../../src/systems/TrackFlowSolver';
import { GameConfig } from '../../src/config/GameConfig';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(scene: any, x1 = 0, y1 = 0, x2 = 500, y2 = 0): RailTrack {
  const Phaser = require('phaser');
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  return new RailTrack(scene, p0, p1, p2, p3);
}

describe('InputManager drag recovery regression', () => {
  let scene: any;
  let inputManager: InputManager;
  let trainManager: TrainManager;
  let dragCallbacks: Map<string, Function[]>;

  beforeEach(() => {
    scene = makeScene();
    dragCallbacks = new Map();

    // Override the mock input.on so we can capture and invoke drag handlers
    scene.input.on = jest.fn((event: string, callback: Function) => {
      if (!dragCallbacks.has(event)) {
        dragCallbacks.set(event, []);
      }
      dragCallbacks.get(event)!.push(callback);
    });
    scene.input.setDraggable = jest.fn();

    const track = makeTrack(scene, 0, 0, 500, 0);
    const trackManager = {
      getClosestTrack: jest.fn().mockImplementation((pos: any, limit: number) => {
        const dx = pos.x - 250;
        const dy = pos.y - 0;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= (limit || Infinity) ? track : null;
      }),
      getJunctionsForTrack: jest.fn().mockReturnValue([]),
    };

    const cameraController = {
      setInputLockOwner: jest.fn(),
      update: jest.fn(),
      startFollow: jest.fn(),
      stopFollow: jest.fn(),
    };

    trainManager = new TrainManager(scene, trackManager as any, cameraController as any);
    inputManager = new InputManager(scene, cameraController as any);
    inputManager.setupClickHandling(trainManager);
  });

  function fireDrag(gameObject: any, dragX: number, dragY: number) {
    const cbs = dragCallbacks.get('drag') || [];
    for (const cb of cbs) {
      cb({ button: 0 } as any, gameObject, dragX, dragY);
    }
  }

  function fireDragEnd(gameObject: any) {
    const cbs = dragCallbacks.get('dragend') || [];
    for (const cb of cbs) {
      cb({ button: 0 } as any, gameObject);
    }
  }

  it('train stays recovered after full drag-and-drop flow', () => {
    const train = trainManager.createInitialTrain();
    train.derailed = true;
    train.currentTrack = null;

    const body = train.getMatterBody();
    // Start off the track, then drag onto it
    body.setPosition(250, 150);

    // Simulate dragging from off-track to on-track
    fireDrag(body, 250, 150);
    fireDrag(body, 250, 100);
    fireDrag(body, 250, 50);
    fireDrag(body, 250, 10);
    fireDrag(body, 250, 0);

    // Now release the drag
    fireDragEnd(body);

    expect(train.derailed).toBe(false);
    expect(train.currentTrack).not.toBeNull();

    // Simulate the next physics tick
    const solver = trainManager['trackSolvers'].get(train) as TrackFlowSolver;
    train.update(0, 16);
    solver.applyTrackFlowForces();

    // The train must NOT immediately derail again
    expect(train.derailed).toBe(false);
    expect(train.currentTrack).not.toBeNull();

    // Run a second tick
    train.update(16, 16);
    solver.applyTrackFlowForces();
    expect(train.derailed).toBe(false);
  });

  it('does not fling the train with high velocity after drag recovery', () => {
    const train = trainManager.createInitialTrain();
    train.derailed = true;
    train.currentTrack = null;

    const body = train.getMatterBody();
    body.setPosition(250, 100);

    // Simulate a fast drag — large position jumps between frames
    fireDrag(body, 250, 100);
    fireDrag(body, 250, 60);
    fireDrag(body, 250, 20);
    fireDrag(body, 250, 0);

    fireDragEnd(body);

    const solver = trainManager['trackSolvers'].get(train) as TrackFlowSolver;
    train.update(0, 16);
    solver.applyTrackFlowForces();

    const vx = (body.body as any).velocity.x;
    const vy = (body.body as any).velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);

    // After recovery the train should not be "flung"
    expect(speed).toBeLessThan(5);
  });

  it('carriage stays recovered after full drag-and-drop flow', () => {
    const carriage = trainManager.createCarriage();
    carriage.derailed = true;
    carriage.currentTrack = null;

    const body = carriage.getMatterBody();
    body.setPosition(250, 150);

    fireDrag(body, 250, 150);
    fireDrag(body, 250, 100);
    fireDrag(body, 250, 50);
    fireDrag(body, 250, 10);
    fireDrag(body, 250, 0);

    fireDragEnd(body);

    expect(carriage.derailed).toBe(false);
    expect(carriage.currentTrack).not.toBeNull();

    const solver = trainManager['trackSolvers'].get(carriage) as TrackFlowSolver;
    carriage.update(0, 16);
    solver.applyTrackFlowForces();

    expect(carriage.derailed).toBe(false);
    expect(carriage.currentTrack).not.toBeNull();

    carriage.update(16, 16);
    solver.applyTrackFlowForces();
    expect(carriage.derailed).toBe(false);
    expect(carriage.currentTrack).not.toBeNull();
  });

  it('does not fling the carriage with high velocity after drag recovery', () => {
    const carriage = trainManager.createCarriage();
    carriage.derailed = true;
    carriage.currentTrack = null;

    const body = carriage.getMatterBody();
    body.setPosition(250, 100);

    fireDrag(body, 250, 100);
    fireDrag(body, 250, 60);
    fireDrag(body, 250, 20);
    fireDrag(body, 250, 0);

    fireDragEnd(body);

    const solver = trainManager['trackSolvers'].get(carriage) as TrackFlowSolver;
    carriage.update(0, 16);
    solver.applyTrackFlowForces();

    const vx = (body.body as any).velocity.x;
    const vy = (body.body as any).velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);

    expect(speed).toBeLessThan(5);
  });

  it('shows a carriage-specific recovery toast', () => {
    const carriage = trainManager.createInitialTrain() as any;
    carriage.vehicleType = 'passenger-carriage';
    carriage.derailed = true;
    TrainManager.bodyToTrain.set(carriage.getMatterBody(), carriage);
    jest.spyOn(trainManager, 'tryRecoverDerailedTrain').mockReturnValue(true);
    const emit = jest.spyOn(EventBus, 'emit');

    fireDragEnd(carriage.getMatterBody());

    expect(emit).toHaveBeenCalledWith('ui:toast', {
      message: 'Carriage re-railed',
      type: 'success',
    });
  });

  it('refreshes draggable vehicles without duplicating input handlers', () => {
    const initialHandlerCount = scene.input.on.mock.calls.length;
    const carriage = trainManager.createCarriage();
    scene.input.setDraggable.mockClear();

    inputManager.setupClickHandling(trainManager);

    expect(scene.input.setDraggable).toHaveBeenCalledWith(carriage.getMatterBody(), true);
    expect(scene.input.on).toHaveBeenCalledTimes(initialHandlerCount);
    for (const callbacks of dragCallbacks.values()) {
      expect(callbacks).toHaveLength(1);
    }
  });

  it('uses the main camera transform for editor world coordinates', () => {
    scene.cameras.main.getWorldPoint.mockReturnValue({ x: 712, y: -84 });
    const pointer = { x: 400, y: 200 };

    expect(inputManager.toWorldPoint(pointer as any)).toEqual({
      x: 712,
      y: -84,
    });
    expect(scene.cameras.main.getWorldPoint).toHaveBeenCalledWith(400, 200);
  });
});
