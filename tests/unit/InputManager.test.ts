import {
  InputManager,
  isGameplayInputFocused,
} from '../../src/systems/InputManager';
import { TrainManager } from '../../src/managers/TrainManager';
import Train from '../../src/entities/Train';
import RailTrack from '../../src/entities/RailTrack';
import { GameConfig } from '../../src/config/GameConfig';
import { EventBus } from '../../src/services/EventBus';
import { CameraController } from '../../src/systems/CameraController';

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
      getInputLockOwner: jest.fn().mockReturnValue('camera'),
      update: jest.fn(),
      startFollow: jest.fn(),
      stopFollow: jest.fn(),
    };

    trainManager = new TrainManager(scene, trackManager as any, cameraController as any);
    inputManager = new InputManager(scene, cameraController as any);
    inputManager.setupClickHandling(trainManager);
  });

  it('distinguishes neutral coast from Stop in authoritative on-rail physics', () => {
    const trackManager=(trainManager as any).trackManager;
    const track=trackManager.getClosestTrack({x:250,y:0},1000);
    trackManager.tracks=[track];trackManager.junctions=[];trackManager.getTrack=()=>track;
    const train=trainManager.createInitialTrain('physics-stop');
    trainManager.restoreVehicleDynamics(train,{mode:'on-rail',trackUUID:track.getUUID(),distance:250,direction:1,
      speedMps:3,consistId:'consist-physics-stop',consistOrder:0});
    trainManager.update(0,20);
    EventBus.emit('mobile:throttle',{value:0,hardStop:false});inputManager.handleTrainMovement(train);trainManager.update(20,20);
    expect(train.persistedDynamics).toEqual(expect.objectContaining({speedMps:expect.any(Number)}));
    if(train.persistedDynamics.mode==='on-rail')expect(train.persistedDynamics.speedMps).toBeGreaterThan(0);
    EventBus.emit('mobile:throttle',{value:0,hardStop:true});inputManager.handleTrainMovement(train);trainManager.update(40,20);
    expect(train.persistedDynamics).toEqual(expect.objectContaining({speedMps:0}));
    expect(trainManager.getDynamicsAdapter('consist-physics-stop')!.getOnRailState(train.getUUID())!.speedMps).toBe(0);
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

    expect(train.derailed).toBe(false);
    expect(train.currentTrack).not.toBeNull();
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

    expect(carriage.derailed).toBe(false);
    expect(carriage.currentTrack).not.toBeNull();
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

  it('does not let held keyboard or mobile throttle repower an operations-locked train', () => {
    const train = trainManager.createInitialTrain('locked-train');
    (inputManager as any).wKey.isDown = true;
    train.enginePower = 0;

    inputManager.handleTrainMovement(
      train,
      new Set(['locked-train']),
    );

    expect(train.enginePower).toBe(0);

    (inputManager as any).wKey.isDown = false;
    EventBus.emit('mobile:throttle', { value: 1, hardStop: false });
    inputManager.handleTrainMovement(
      train,
      new Set(['locked-train']),
    );

    expect(train.enginePower).toBe(0);
  });

  it('explicit UI Stop zeros linear and angular velocity without changing coasting or direction commands', () => {
    const train = trainManager.createInitialTrain('mobile-stop-train');
    const body = train.getMatterBody();
    body.setVelocity(3, 4);
    body.setAngularVelocity(0.2);
    const velocitySpy = jest.spyOn(body, 'setVelocity');
    const angularVelocitySpy = jest.spyOn(body, 'setAngularVelocity');

    inputManager.handleTrainMovement(train);
    expect(velocitySpy).not.toHaveBeenCalled();
    expect(angularVelocitySpy).not.toHaveBeenCalled();

    EventBus.emit('mobile:throttle', { value: 1, hardStop: false });
    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(GameConfig.TRAIN.ENGINE_POWER);
    expect(velocitySpy).not.toHaveBeenCalled();

    EventBus.emit('mobile:throttle', { value: -1, hardStop: false });
    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(-GameConfig.TRAIN.ENGINE_POWER);
    expect(velocitySpy).not.toHaveBeenCalled();

    EventBus.emit('mobile:throttle', {
      value: 0,
      hardStop: false,
    });
    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(0);
    expect(velocitySpy).not.toHaveBeenCalled();
    expect(angularVelocitySpy).not.toHaveBeenCalled();

    EventBus.emit('mobile:throttle', {
      value: 0,
      hardStop: true,
    });
    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(0);
    expect(velocitySpy).toHaveBeenLastCalledWith(0, 0);
    expect(angularVelocitySpy).toHaveBeenLastCalledWith(0);

    body.setVelocity(2, 0);
    velocitySpy.mockClear();
    angularVelocitySpy.mockClear();
    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(0);
    expect(velocitySpy).not.toHaveBeenCalled();
    expect(angularVelocitySpy).not.toHaveBeenCalled();

    (inputManager as any).wKey.isDown = true;
    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(GameConfig.TRAIN.ENGINE_POWER);
    expect(velocitySpy).not.toHaveBeenCalled();
  });

  it.each([
    ['button', null],
    ['input', null],
    ['select', null],
    ['textarea', null],
    ['span', 'construction-inspector'],
    ['span', 'facility-inspector'],
    ['span', 'vehicle-purchase-panel'],
    ['span', 'train-inspector'],
    ['span', 'freight-objective'],
  ])('recognises focused %s controls inside %s', (tag, testId) => {
    const parent = document.createElement('section');
    if (testId) parent.dataset.testid = testId;
    const child = document.createElement(tag);
    parent.append(child);
    document.body.append(parent);

    expect(isGameplayInputFocused(child)).toBe(true);
    expect(isGameplayInputFocused(document.body)).toBe(false);
    parent.remove();
  });

  it('shields W/S over the freight card but not the removed first-route selector', () => {
    const train = trainManager.createInitialTrain('objective-focus-train');
    const current = document.createElement('section');
    current.dataset.testid = 'freight-objective';
    const focused = document.createElement('span');
    focused.tabIndex = 0;
    current.append(focused);
    document.body.append(current);
    focused.focus();
    (inputManager as any).wKey.isDown = true;
    train.enginePower = -0.25;

    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(-0.25);

    current.remove();
    const removed = document.createElement('section');
    removed.dataset.testid = 'first-route-objective';
    const legacyFocused = document.createElement('span');
    legacyFocused.tabIndex = 0;
    removed.append(legacyFocused);
    document.body.append(removed);
    legacyFocused.focus();

    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(GameConfig.TRAIN.ENGINE_POWER);
    removed.remove();
  });

  it('sets no new keyboard or mobile throttle while gameplay input is focused', () => {
    const train = trainManager.createInitialTrain('focused-train');
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    (inputManager as any).wKey.isDown = true;
    train.enginePower = -0.25;

    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(-0.25);

    (inputManager as any).wKey.isDown = false;
    EventBus.emit('mobile:throttle', { value: 1, hardStop: false });
    inputManager.handleTrainMovement(train);
    expect(train.enginePower).toBe(-0.25);
    input.remove();
  });
});

describe('InputManager construction click ownership', () => {
  function setup() {
    const scene = makeScene();
    const callbacks = new Map<string, Function[]>();
    scene.input.on = jest.fn((event: string, callback: Function) => {
      callbacks.set(event, [...(callbacks.get(event) ?? []), callback]);
    });
    const camera = scene.cameras.main;
    // Match Phaser's immediate scroll change when a click starts camera follow.
    camera.startFollow.mockImplementation((body: { x: number; y: number }) => {
      camera.scrollX = body.x - camera.width / 2;
      camera.scrollY = body.y - camera.height / 2;
    });
    camera.getWorldPoint.mockImplementation((x: number, y: number) => ({
      x: x + camera.scrollX, y: y + camera.scrollY,
    }));
    const controller = new CameraController(scene);
    const manager = new TrainManager(scene, {} as any, controller);
    const input = new InputManager(scene, controller);
    input.setupClickHandling(manager);
    const selected = manager.createInitialTrain('selected');
    const underPointer = manager.createInitialTrain('under-pointer');
    underPointer.getMatterBody().setPosition(5400, -3200);
    manager.selectTrain(selected.getUUID());
    camera.startFollow.mockClear();
    camera.stopFollow.mockClear();
    const pointer = { id: 0, button: 0, x: 400, y: 200,
      leftButtonDown: () => true, middleButtonDown: () => false };
    const fire = (event: string, ...args: unknown[]) => {
      for (const callback of callbacks.get(event) ?? []) callback(...args);
    };
    return { camera, controller, manager, input, selected, underPointer, pointer, fire };
  }

  it.each(['editor-tool', 'ui'] as const)('preserves selection and world coordinates when %s owns a train click', owner => {
    const { camera, controller, manager, input, selected, underPointer, pointer, fire } = setup();
    controller.setInputLockOwner(owner);
    const before = input.toWorldPoint(pointer);
    const selectedThrottle = selected.enginePower = 0.25;

    // This is Phaser's actual order, followed by the editor's world conversion.
    fire('gameobjectdown', pointer, underPointer.getMatterBody());
    fire('pointerdown', pointer);
    expect(input.toWorldPoint(pointer)).toEqual(before);
    expect(manager.selectedTrain).toBe(selected);
    expect(selected.enginePower).toBe(selectedThrottle);
    expect(camera.startFollow).not.toHaveBeenCalled();
    expect(camera.stopFollow).not.toHaveBeenCalled();

    // A bare construction/UI click must not deselect either.
    fire('pointerdown', pointer);
    expect(manager.selectedTrain).toBe(selected);
    expect(camera.stopFollow).not.toHaveBeenCalled();
  });

  it('still selects trains and deselects on bare clicks when the camera owns input', () => {
    const { camera, controller, manager, underPointer, pointer, fire } = setup();
    expect(controller.getInputLockOwner()).toBe('camera');
    fire('gameobjectdown', pointer, underPointer.getMatterBody());
    fire('pointerdown', pointer);
    expect(manager.selectedTrain).toBe(underPointer);
    expect(camera.startFollow).toHaveBeenCalledWith(underPointer.getMatterBody());
    fire('pointerup', pointer);
    fire('pointerdown', pointer);
    expect(manager.selectedTrain).toBeNull();
  });
});
