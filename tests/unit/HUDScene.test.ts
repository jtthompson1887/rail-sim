import Phaser from 'phaser';
import HUDScene from '../../src/scenes/HUDScene';
import { GameStateManager } from '../../src/managers/GameStateManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { EventBus } from '../../src/services/EventBus';
import type { WorldData } from '../../src/config/WorldData';

describe('HUDScene touch control ownership', () => {
  const shutdownCallbacks: Array<() => void> = [];
  let world: WorldData | null;
  let throttle: jest.Mock;

  const regionalWorld = (id = 'current-world') => ({
    id, management: { speed: 0 },
  } as WorldData);

  function startHud(touch = true) {
    const scene = new HUDScene();
    const resizeListeners = new Map<Function, unknown>();
    // Each Phaser text object has independent lifetime and supports resize styling.
    (scene.add.text as jest.Mock).mockImplementation(() => Object.fromEntries([
      'setScrollFactor', 'setDepth', 'setOrigin', 'setInteractive', 'on',
      'setColor', 'setPosition', 'setFontSize', 'setPadding', 'setText', 'destroy',
    ].map(name => [name, jest.fn().mockReturnThis()])));
    (scene as any).sys = { game: { device: { input: { touch } } } };
    Object.assign(scene.scale, {
      width: 375, height: 667,
      on: jest.fn((_event: string, callback: Function, context: unknown) => {
        resizeListeners.set(callback, context);
      }),
      off: jest.fn((_event: string, callback: Function) => {
        resizeListeners.delete(callback);
      }),
    });
    // The shared Phaser mock has the legacy scale constants only.
    (Phaser.Scale as any).Events = { RESIZE: 'resize' };
    const create = () => {
      scene.create();
      const shutdown = (scene.events.once as jest.Mock).mock.calls.at(-1)![1];
      shutdownCallbacks.push(shutdown);
      return shutdown as () => void;
    };
    const shutdown = create();
    return {
      scene, shutdown, create,
      rectangles: () => (scene.add.rectangle as jest.Mock).mock.results
        .map(({ value }) => value),
      resize: () => resizeListeners.forEach((context, callback) => {
        callback.call(context, { width: 844, height: 390 });
      }),
      resizeListenerCount: () => resizeListeners.size,
    };
  }

  function pointer(button: any, event: string): void {
    const handler = button.on.mock.calls.find(([name]: [string]) => name === event)?.[1];
    expect(handler).toEqual(expect.any(Function));
    handler();
  }

  beforeEach(() => {
    world = { id: 'current-world' } as WorldData;
    jest.spyOn(WorldManager, 'world', 'get').mockImplementation(() => world);
    GameStateManager.enterPlay('current-world');
    throttle = jest.fn();
    EventBus.on('mobile:throttle', throttle);
  });

  afterEach(() => {
    shutdownCallbacks.splice(0).forEach(shutdown => shutdown());
    EventBus.off('mobile:throttle', throttle);
    jest.restoreAllMocks();
  });

  it('keeps legacy forward/reverse release semantics and neutralizes before resizing', () => {
    const hud = startHud();
    const [forward, reverse] = hud.rectangles();
    expect(hud.rectangles()).toHaveLength(2);
    pointer(forward, 'pointerdown');
    pointer(forward, 'pointerup');
    pointer(reverse, 'pointerdown');
    pointer(reverse, 'pointerout');
    expect(throttle.mock.calls.map(([value]) => value)).toEqual([
      { value: 1, hardStop: false }, { value: 0, hardStop: false },
      { value: -1, hardStop: false }, { value: 0, hardStop: false },
    ]);

    pointer(forward, 'pointerdown');
    hud.resize();
    expect(throttle).toHaveBeenLastCalledWith({ value: 0, hardStop: false });
    expect(forward.destroy).toHaveBeenCalledTimes(1);
    expect(reverse.destroy).toHaveBeenCalledTimes(1);
    expect(hud.rectangles()).toHaveLength(4);
    pointer(hud.rectangles()[2], 'pointerdown');
    expect(throttle).toHaveBeenLastCalledWith({ value: 1, hardStop: false });
  });

  it.each(['create', 'play'] as const)(
    'does not create legacy throttle for a regional world opened in %s mode or after resize',
    (mode) => {
      world = regionalWorld();
      if (mode === 'create') GameStateManager.enterCreate(world.id);
      const hud = startHud();
      hud.resize();
      expect(hud.rectangles()).toHaveLength(0);
      expect((hud.scene.add.text as jest.Mock).mock.calls.some(
        ([, , label]) => label === 'THROTTLE',
      )).toBe(false);
      expect(throttle).not.toHaveBeenCalled();
    },
  );

  it('releases held legacy input and removes every control when the current world opts in', () => {
    const hud = startHud();
    const controls = [...(hud.scene as any).mobileControls];
    const destroy = controls.map(control => jest.spyOn(control, 'destroy'));
    pointer(hud.rectangles()[0], 'pointerdown');
    world = regionalWorld();
    EventBus.emit('railway:enabled', {});
    expect(throttle.mock.calls.map(([value]) => value)).toEqual([
      { value: 1, hardStop: false }, { value: 0, hardStop: false },
    ]);
    destroy.forEach(spy => expect(spy).toHaveBeenCalledTimes(1));
    EventBus.emit('railway:enabled', {});
    hud.resize();
    expect(hud.rectangles()).toHaveLength(2);
    expect((hud.scene as any).mobileControls).toHaveLength(0);
    expect(throttle).toHaveBeenCalledTimes(2);
  });

  it.each(['level', 'other-world'])(
    'ignores a leftover regional world while the active HUD belongs to %s',
    (kind) => {
      world = regionalWorld('leftover-regional-world');
      if (kind === 'level') GameStateManager.startLevel('legacy-level');
      const hud = startHud();
      EventBus.emit('railway:enabled', {});
      hud.resize();
      expect(hud.rectangles()).toHaveLength(4);
      pointer(hud.rectangles()[2], 'pointerdown');
      expect(throttle).toHaveBeenLastCalledWith({ value: 1, hardStop: false });
    },
  );

  it('cleans up subscriptions and held input through repeated shutdown and restart', () => {
    const on = jest.spyOn(EventBus, 'on');
    const off = jest.spyOn(EventBus, 'off');
    const hud = startHud();
    const regionalHandler = on.mock.calls.find(([event]) => event === 'railway:enabled')![1];
    pointer(hud.rectangles()[0], 'pointerdown');
    hud.shutdown();
    hud.shutdown();
    expect(off).toHaveBeenCalledWith('railway:enabled', regionalHandler);
    expect(hud.resizeListenerCount()).toBe(0);
    expect(throttle).toHaveBeenCalledTimes(2);
    hud.resize();
    expect(hud.rectangles()).toHaveLength(2);

    hud.create();
    pointer(hud.rectangles()[2], 'pointerdown');
    world = regionalWorld();
    EventBus.emit('railway:enabled', {});
    expect(throttle.mock.calls.map(([value]) => value.value)).toEqual([1, 0, 1, 0]);
    expect(hud.rectangles()[2].destroy).toHaveBeenCalledTimes(1);
  });

  it('does not add touch controls to a desktop HUD', () => {
    const hud = startHud(false);
    hud.resize();
    expect(hud.rectangles()).toHaveLength(0);
    expect(throttle).not.toHaveBeenCalled();
  });
});
