/**
 * Unit tests for MenuScene – focused on depth/z-order configuration so that
 * menu trains render behind the UI panel and do not flicker.
 */

import MenuScene from '../../src/scenes/MenuScene';

jest.mock('../../src/entities/Background', () => {
  return jest.fn().mockImplementation(() => ({
    setDepth: jest.fn(),
  }));
});

jest.mock('../../src/systems/CameraController', () => {
  return {
    CameraController: jest.fn().mockImplementation(() => ({
      stopFollow: jest.fn(),
      update: jest.fn(),
    })),
  };
});

jest.mock('../../src/services/SaveService', () => ({
  SaveService: {
    getLastPlayedWorldId: jest.fn().mockReturnValue(null),
    hasSave: jest.fn().mockReturnValue(false),
  },
}));

function buildScene() {
  const listeners: Record<string, Function[]> = {};

  const fluentStub = () => ({
    setStrokeStyle: jest.fn().mockReturnThis(),
    setDepth: jest.fn().mockReturnThis(),
    setScrollFactor: jest.fn().mockReturnThis(),
    setInteractive: jest.fn().mockReturnThis(),
    setVisible: jest.fn().mockReturnThis(),
    setAlpha: jest.fn().mockReturnThis(),
    setFillStyle: jest.fn().mockReturnThis(),
    setOrigin: jest.fn().mockReturnThis(),
    setText: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setShadow: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    off: jest.fn().mockReturnThis(),
    add: jest.fn().mockReturnThis(),
    destroy: jest.fn(),
    _children: [],
    height: 60,
  });

  const scene: any = {};
  scene.add = {
    existing: jest.fn((obj: any) => {
      return obj;
    }),
    image: jest.fn().mockReturnValue({
      setOrigin: jest.fn().mockReturnThis(),
      setScale: jest.fn().mockReturnThis(),
      setDepth: jest.fn().mockReturnThis(),
      rotation: 0,
    }),
    text: jest.fn().mockReturnValue(fluentStub()),
    graphics: jest.fn().mockReturnValue({
      setDepth: jest.fn().mockReturnThis(),
      lineStyle: jest.fn().mockReturnThis(),
      fillStyle: jest.fn().mockReturnThis(),
      beginPath: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      strokePath: jest.fn().mockReturnThis(),
      fillPath: jest.fn().mockReturnThis(),
      fillCircle: jest.fn().mockReturnThis(),
      fillRect: jest.fn().mockReturnThis(),
      strokeRect: jest.fn().mockReturnThis(),
      clear: jest.fn().mockReturnThis(),
      destroy: jest.fn(),
    }),
    rectangle: jest.fn().mockReturnValue(fluentStub()),
    container: jest.fn().mockReturnValue(fluentStub()),
  };
  scene.matter = {
    add: {
      image: jest.fn().mockImplementation((x: number, y: number, key: string) => {
        const img: Record<string, any> = {
          x: x || 0,
          y: y || 0,
          _key: key || '',
          displayWidth: 100,
          displayHeight: 50,
          angle: 0,
          _depth: 0,
          setMass: jest.fn().mockReturnValue(undefined as any),
          setFrictionAir: jest.fn().mockReturnValue(undefined as any),
          // Use arrow so we can close over `img` without `this` implicit-any.
          setAngle: jest.fn().mockImplementation((a: number) => { img.angle = a; return img; }),
          setPosition: jest.fn().mockReturnValue(undefined as any),
          setScale: jest.fn().mockReturnValue(undefined as any),
          setTexture: jest.fn().mockReturnValue(undefined as any),
          clearTint: jest.fn().mockReturnValue(undefined as any),
          setTint: jest.fn().mockReturnValue(undefined as any),
          setDepth: jest.fn().mockImplementation((d: number) => { img._depth = d; return img; }),
          setInteractive: jest.fn().mockReturnThis(),
          setVelocity: jest.fn().mockReturnThis(),
          setAngularVelocity: jest.fn().mockReturnThis(),
          setExistingBody: jest.fn().mockReturnThis(),
          scene,
          parentTrain: undefined,
          body: {
            position: { x: x || 0, y: y || 0 },
            mass: 1000,
            force: { x: 0, y: 0 },
            isStatic: false,
            friction: 0,
            restitution: 0,
            frictionAir: 0.015,
            angle: 0,
            anglePrev: 0,
            angularVelocity: 0,
            velocity: { x: 0, y: 0 },
            positionPrev: { x: x || 0, y: y || 0 },
            inertia: 1000,
          },
        };
        return img;
      }),
    },
    bodies: {
      rectangle: jest.fn().mockReturnValue({
        position: { x: 0, y: 0 },
        mass: 1000,
        force: { x: 0, y: 0 },
        isStatic: false,
        friction: 0,
        restitution: 0,
        angle: 0,
      }),
    },
    world: {
      remove: jest.fn(),
      get scene() { return scene; },
    },
  };
  scene.cameras = {
    main: {
      scrollX: 0, scrollY: 0, zoom: 1, width: 1920, height: 1080,
      setBounds: jest.fn(),
      setZoom: jest.fn(),
      centerOn: jest.fn(),
      getWorldPoint: jest.fn((x: number, y: number) => ({ x, y })),
      startFollow: jest.fn(),
      stopFollow: jest.fn(),
    },
  };
  scene.scale = { width: 1920, height: 1080 };
  scene.input = {
    keyboard: {
      addKey: jest.fn().mockReturnValue({ isDown: false }),
      createCursorKeys: jest.fn().mockReturnValue({
        left: { isDown: false },
        right: { isDown: false },
        up: { isDown: false },
        down: { isDown: false },
      }),
      on: jest.fn(),
      once: jest.fn(),
    },
    on: jest.fn((evt: string, cb: Function) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(cb);
    }),
    setDraggable: jest.fn(),
    addPointer: jest.fn(),
  };
  scene.events = {
    once: jest.fn(),
    on: jest.fn(),
    emit: jest.fn(),
  };
  scene.tweens = {
    add: jest.fn(),
  };
  scene.sound = {
    volume: 1,
    mute: false,
    add: jest.fn().mockReturnValue({ play: jest.fn(), stop: jest.fn() }),
    play: jest.fn(),
  };
  scene.cache = { audio: { exists: jest.fn().mockReturnValue(false) } };
  scene.game = { canvas: document.createElement('canvas') };
  scene.make = {
    tilemap: jest.fn().mockReturnValue({
      addTilesetImage: jest.fn().mockReturnValue({}),
      createBlankLayer: jest.fn().mockReturnValue({
        setScale: jest.fn(),
        putTileAt: jest.fn(),
      }),
    }),
  };
  scene.scene = {
    start: jest.fn(),
  };
  return scene;
}

describe('MenuScene', () => {
  it('positions demo trains behind the UI panel so they do not flicker', () => {
    const scene = buildScene();
    const menu = new MenuScene();
    // Transplant the mocked scene guts onto the MenuScene instance
    Object.assign(menu, scene);

    // Call create – if any mock is missing the test will throw and fail
    (menu as any).create();

    const trains = (menu as any).trains;
    expect(trains).toHaveLength(2);

    for (const train of trains) {
      // The UI panel sits at depth 100; trains must be lower to avoid
      // z-fighting / flickering.
      expect(train._depth).toBeLessThan(100);
      expect(train.getMatterBody()._depth).toBeLessThan(100);
    }
  });

  it('stores engine powers so recovery can restore them', () => {
    const scene = buildScene();
    const menu = new MenuScene();
    Object.assign(menu, scene);

    (menu as any).create();

    const powers: number[] = (menu as any).trainEnginePowers;
    expect(powers).toHaveLength(2);
    // Verify the stored powers match what was assigned at create time.
    expect(powers[0]).toBe(38);
    expect(powers[1]).toBe(42);
  });

  it('snaps position/angle before recover() and restores engine power', () => {
    const scene = buildScene();
    const menu = new MenuScene();
    Object.assign(menu, scene);
    (menu as any).create();

    const trains: any[] = (menu as any).trains;
    const train = trains[0];

    // Simulate derailment: mark the train as derailed, move it away.
    train._derailed = true;
    train.getMatterBody().x = 9999;
    train.getMatterBody().y = 9999;
    // Zero out the engine power to confirm recovery restores it.
    train._enginePower = 0;

    const recoverSpy = jest.spyOn(train, 'recover');
    const setPosSpy  = jest.spyOn(train.getMatterBody(), 'setPosition');

    (menu as any).recoverTrain(train, 0);

    // setPosition must be called BEFORE recover().
    const posCallOrder     = setPosSpy.mock.invocationCallOrder[0];
    const recoverCallOrder = recoverSpy.mock.invocationCallOrder[0];
    expect(posCallOrder).toBeLessThan(recoverCallOrder);

    // Engine power must be restored after recovery.
    expect(train._enginePower).toBe(38);
  });
});
