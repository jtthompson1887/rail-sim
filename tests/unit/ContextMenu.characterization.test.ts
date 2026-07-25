import {
  ContextMenu,
  buildEmptyContextItems,
  buildTrackContextItems,
} from '../../src/ui/ContextMenu';
import { WorldManager } from '../../src/managers/WorldManager';

const { makeScene } = require('../../__mocks__/phaser');

function uiNode() {
  const handlers: Record<string, Function> = {};
  const node: any = {
    x: 0,
    y: 0,
    visible: true,
    handlers,
    setStrokeStyle: jest.fn(() => node),
    setDepth: jest.fn(() => node),
    setScrollFactor: jest.fn(() => node),
    setVisible: jest.fn((visible: boolean) => {
      node.visible = visible;
      return node;
    }),
    setPosition: jest.fn((x: number, y: number) => {
      node.x = x;
      node.y = y;
      return node;
    }),
    setSize: jest.fn(() => node),
    setOrigin: jest.fn(() => node),
    setInteractive: jest.fn(() => node),
    setFillStyle: jest.fn(() => node),
    add: jest.fn(() => node),
    on: jest.fn((event: string, handler: Function) => {
      handlers[event] = handler;
      return node;
    }),
    destroy: jest.fn(),
  };
  return node;
}

function menuHarness() {
  const scene = makeScene();
  const container = uiNode();
  const rectangles: any[] = [];
  const texts: any[] = [];
  scene.add.container.mockReturnValue(container);
  scene.add.rectangle.mockImplementation(() => {
    const rectangle = uiNode();
    rectangles.push(rectangle);
    return rectangle;
  });
  scene.add.text.mockImplementation(() => {
    const text = uiNode();
    texts.push(text);
    return text;
  });
  scene.input.off = jest.fn();
  scene.input.keyboard.off = jest.fn();
  const menu = new ContextMenu(scene);
  return { menu, scene, container, rectangles, texts };
}

describe('ContextMenu interaction and cleanup', () => {
  it('keeps a menu on screen, executes its row action, and clears transient rows', () => {
    const { menu, container, rectangles, texts } = menuHarness();
    const action = jest.fn();

    menu.show(1900, 1070, [
      { label: 'Inspect', action },
      { label: 'Delete', color: '#ff8080', action: jest.fn() },
    ]);

    expect(container.setPosition).toHaveBeenCalledWith(1720, 1002);
    expect(container.visible).toBe(true);
    expect(rectangles[0].setSize).toHaveBeenCalledWith(180, 68);
    expect(texts).toHaveLength(2);

    const firstRow = rectangles[1];
    firstRow.handlers.pointerover();
    expect(firstRow.setFillStyle).toHaveBeenLastCalledWith(0x1e4a7c, 0.8);
    firstRow.handlers.pointerout();
    expect(firstRow.setFillStyle).toHaveBeenLastCalledWith(0x1a3a5c, 0);

    firstRow.handlers.pointerdown();
    expect(action).toHaveBeenCalledTimes(1);
    expect(container.visible).toBe(false);
    expect(firstRow.destroy).toHaveBeenCalledTimes(1);
    expect(texts[0].destroy).toHaveBeenCalledTimes(1);

    menu.destroy();
  });

  it('stays open for an inside click and closes for an outside click', () => {
    const { menu, scene, container } = menuHarness();
    menu.show(100, 100, [{ label: 'One', action: jest.fn() }]);
    const closeHandler = scene.input.on.mock.calls.find(
      ([event]: [string]) => event === 'pointerdown',
    )[1];

    closeHandler({ x: 110, y: 110 });
    expect(container.visible).toBe(true);

    closeHandler({ x: 99, y: 99 });
    expect(container.visible).toBe(false);

    menu.destroy();
  });

  it('closes on Escape and unregisters its pointer and keyboard listeners on scene shutdown', () => {
    const { menu, scene, container } = menuHarness();
    menu.show(100, 100, [{ label: 'One', action: jest.fn() }]);
    const keyHandler = scene.input.keyboard.on.mock.calls.find(
      ([event]: [string]) => event === 'keydown',
    )[1];

    keyHandler({ code: 'KeyA' });
    expect(container.visible).toBe(true);
    keyHandler({ code: 'Escape' });
    expect(container.visible).toBe(false);

    const shutdownHandler = scene.events.once.mock.calls.find(
      ([event]: [string]) => event === 'shutdown',
    )[1];
    shutdownHandler();
    expect(scene.input.off).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(scene.input.keyboard.off).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(container.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('Context menu factories', () => {
  afterEach(() => WorldManager.reset());

  it('toggles a single track surface type in both the live and persisted world', () => {
    WorldManager.createNew('Context fixture', 'context-seed');
    WorldManager.addTrackDef({
      uuid: 'track-1',
      p0: { x: 0, y: 0 },
      p1: { x: 1, y: 0 },
      p2: { x: 2, y: 0 },
      p3: { x: 3, y: 0 },
    });
    const track = {
      isTunnel: false,
      getUUID: () => 'track-1',
    };
    const trackManager = { getTrack: jest.fn(() => track) };
    const onDelete = jest.fn();

    const items = buildTrackContextItems(trackManager as any, ['track-1'], onDelete);
    expect(items.map((item) => item.label)).toEqual([
      '🚇 Set as Tunnel',
      '🗑 Delete (1)',
    ]);

    items[0].action();
    expect(track.isTunnel).toBe(true);
    expect(WorldManager.world!.tracks[0].isTunnel).toBe(true);
    expect(buildTrackContextItems(trackManager as any, ['track-1'], onDelete)[0].label)
      .toBe('☀ Set as Surface');

    items[1].action();
    expect(onDelete).toHaveBeenCalledWith(['track-1']);
  });

  it('offers only batch deletion for multiple tracks and no actions for an empty selection', () => {
    const onDelete = jest.fn();
    const trackManager = { getTrack: jest.fn() };

    const items = buildTrackContextItems(trackManager as any, ['a', 'b'], onDelete);
    expect(items.map((item) => item.label)).toEqual(['🗑 Delete (2)']);
    items[0].action();
    expect(onDelete).toHaveBeenCalledWith(['a', 'b']);
    expect(buildTrackContextItems(trackManager as any, [], onDelete)).toEqual([]);
    expect(trackManager.getTrack).not.toHaveBeenCalled();
  });

  it('captures the requested world position for generate-here actions', () => {
    const generate = jest.fn();
    const [item] = buildEmptyContextItems(321, 654, generate);

    item.action();

    expect(generate).toHaveBeenCalledWith(321, 654);
  });
});
