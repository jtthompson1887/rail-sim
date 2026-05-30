/**
 * Unit tests for MenuScene – focused on depth/z-order configuration so that
 * menu trains render behind the UI panel and do not flicker.
 */

import MenuScene from '../../src/scenes/MenuScene';

jest.mock('../../src/entities/Background', () => {
  return jest.fn().mockImplementation(function () {
    this.setDepth = jest.fn().mockReturnThis();
  });
});

jest.mock('../../src/systems/CameraController', () => {
  return {
    CameraController: jest.fn().mockImplementation(function () {
      this.stopFollow = jest.fn();
      this.update = jest.fn();
    }),
  };
});

jest.mock('../../src/services/SaveService', () => ({
  SaveService: {
    getLastPlayedWorldId: jest.fn().mockReturnValue(null),
    hasSave: jest.fn().mockReturnValue(false),
  },
}));

function makeSceneMock() {
  const listeners: Record<string, Function[]> = {};
  const objects: any[] = [];

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

  return {
    add: {
      existing: jest.fn((obj) => {
        objects.push(obj);
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
    },
    matter: {
      add: {
        image: jest.fn().mockImplementation((x, y, key) => {
          const img = {
            x: x || 0,
            y: y || 0,
            _key: key || '',
            displayWidth: 100,
            displayHeight: 50,
            setMass: jest.fn().mockReturnThis(),
            setFrictionAir: jest.fn().mockReturnThis(),
            setAngle: jest.fn().mockReturnThis(),
            setPosition: jest.fn().mockReturnThis(),
            setScale: jest.fn().mockReturnThis(),
            setDepth: jest.fn().mockReturnThis(),
            setInteractive: jest.fn().mockReturnThis(),
            setVelocity: jest.fn().mockReturnThis(),
            setAngularVelocity: jest.fn().mockReturnThis(),
            setExistingBody: jest.fn().mockReturnThis(),
            parentTrain: undefined,
            body: {
              position: { x: x || 0, y: y || 0 },
              mass: 1000,
              force: { x: 0, y: 0 },
              isStatic: false,
              friction: 0,
              restitution: 0,
              angle: 0,
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
    },
    cameras: {
      main: {
        scrollX: 0, scrollY: 0, zoom: 1, width: 1920, height: 1080,
        setBounds: jest.fn(),
        setZoom: jest.fn(),
        centerOn: jest.fn(),
        getWorldPoint: jest.fn((x, y) => ({ x, y })),
        startFollow: jest.fn(),
        stopFollow: jest.fn(),
      },
    },
    scale: { width: 1920, height: 1080 },
    input: {
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
      on: jest.fn((evt, cb) => {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(cb);
      }),
      setDraggable: jest.fn(),
      addPointer: jest.fn(),
    },
    events: {
      once: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    },
    tweens: {
      add: jest.fn(),
    },
    sound: {
      volume: 1,
      mute: false,
      add: jest.fn().mockReturnValue({ play: jest.fn(), stop: jest.fn() }),
      play: jest.fn(),
    },
    cache: { audio: { exists: jest.fn().mockReturnValue(false) } },
    game: { canvas: document.createElement('canvas') },
    make: {
      tilemap: jest.fn().mockReturnValue({
        addTilesetImage: jest.fn().mockReturnValue({}),
        createBlankLayer: jest.fn().mockReturnValue({
          setScale: jest.fn(),
          putTileAt: jest.fn(),
        }),
      }),
    },
    scene: {
      start: jest.fn(),
    },
  };

  // Self-reference so matter.world.get scene works
  const scene = makeSceneMock();
  // Actually we need to return the scene object, not call recursively.
  // Let me fix this below.
  return scene;
}

// Build scene manually to avoid recursive issue
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
        const img = {
          x: x || 0,
          y: y || 0,
          _key: key || '',
          displayWidth: 100,
          displayHeight: 50,
          setMass: jest.fn().mockReturnThis(),
          setFrictionAir: jest.fn().mockReturnThis(),
          setAngle: jest.fn().mockReturnThis(),
          setPosition: jest.fn().mockReturnThis(),
          setScale: jest.fn().mockReturnThis(),
          setDepth(d: number) { (this as any)._depth = d; return this; },
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
            angle: 0,
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
});
