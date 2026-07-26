import { CabViewHost } from '../../src/cab3d/CabViewHost';
import { EventBus } from '../../src/services/EventBus';
import type { ICabSnapshotSource } from '../../src/cab3d/contracts/ICabSnapshotSource';
import type { ICabRenderer } from '../../src/cab3d/contracts/ICabRenderer';
import { INVALID_SNAPSHOT, type CabWorldSnapshot } from '../../src/cab3d/model/CabWorldSnapshot';

describe('CabViewHost', () => {
  const createRenderer = (): jest.Mocked<ICabRenderer> => ({
    isReady: jest.fn().mockReturnValue(true),
    show: jest.fn(),
    hide: jest.fn(),
    render: jest.fn(),
    destroy: jest.fn(),
  } as unknown as jest.Mocked<ICabRenderer>);

  const createSource = (snapshot: CabWorldSnapshot = INVALID_SNAPSHOT): jest.Mocked<ICabSnapshotSource> => ({
    capture: jest.fn().mockReturnValue(snapshot),
  } as unknown as jest.Mocked<ICabSnapshotSource>);

  let stateEvents: Array<{ active: boolean }> = [];
  let stateHandler: (data: { active: boolean }) => void;

  beforeEach(() => {
    stateEvents = [];
    stateHandler = (data) => stateEvents.push(data);
    EventBus.on('cab:state', stateHandler);
  });

  afterEach(() => {
    EventBus.off('cab:state', stateHandler);
  });

  it('starts inactive and does not call the source or renderer', () => {
    const source = createSource();
    const host = new CabViewHost(source, () => Promise.resolve(createRenderer()));

    expect(host.isActive).toBe(false);
    host.update(0, 16);
    expect(source.capture).not.toHaveBeenCalled();

    host.destroy();
  });

  it('toggles active, loads the renderer, and emits cab:state', async () => {
    const renderer = createRenderer();
    const source = createSource();
    const host = new CabViewHost(source, () => Promise.resolve(renderer));

    EventBus.emit('cab:toggle', {});

    // Allow the async renderer loader to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(host.isActive).toBe(true);
    expect(renderer.show).toHaveBeenCalled();
    expect(stateEvents).toContainEqual({ active: true });

    host.destroy();
  });

  it('renders valid snapshots only when active and ready', async () => {
    const snapshot: CabWorldSnapshot = {
      valid: true,
      seed: 'test',
      biome: 'temperate',
      vehicle: null,
      path: [],
      elapsedSecs: 0,
    };
    const renderer = createRenderer();
    const source = createSource(snapshot);
    const host = new CabViewHost(source, () => Promise.resolve(renderer));

    EventBus.emit('cab:toggle', {});
    await new Promise((resolve) => setTimeout(resolve, 10));

    host.update(1000, 16);

    expect(source.capture).toHaveBeenCalledWith(1000, 16);
    expect(renderer.render).toHaveBeenCalledWith(snapshot);

    host.destroy();
  });

  it('hides the renderer and emits inactive on second toggle', async () => {
    const renderer = createRenderer();
    const host = new CabViewHost(createSource(), () => Promise.resolve(renderer));

    EventBus.emit('cab:toggle', {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    EventBus.emit('cab:toggle', {});

    expect(host.isActive).toBe(false);
    expect(renderer.hide).toHaveBeenCalled();
    expect(stateEvents).toContainEqual({ active: false });

    host.destroy();
  });

  it('destroys the renderer and unsubscribes from cab:toggle', async () => {
    const renderer = createRenderer();
    const host = new CabViewHost(createSource(), () => Promise.resolve(renderer));

    EventBus.emit('cab:toggle', {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    host.destroy();

    expect(renderer.destroy).toHaveBeenCalled();

    // After destroy, toggling should not change state.
    const before = stateEvents.length;
    EventBus.emit('cab:toggle', {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stateEvents.length).toBe(before);
  });
});
