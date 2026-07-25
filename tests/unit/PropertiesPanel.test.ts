import { PropertiesPanel } from '../../src/ui/PropertiesPanel';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

describe('PropertiesPanel', () => {
  let panel: PropertiesPanel;
  let scene: any;
  let trackManager: any;
  let selectionManager: any;
  let onDelete: jest.Mock;

  beforeEach(() => {
    scene = makeScene();
    trackManager = { getTrack: jest.fn() };
    selectionManager = { selectedUUIDs: [] };
    onDelete = jest.fn();
    panel = new PropertiesPanel(
      scene,
      trackManager as any,
      selectionManager as any,
      onDelete,
    );
  });

  afterEach(() => {
    panel.destroy();
  });

  it('destroys the previous selector objects before rebuilding after a click', () => {
    EventBus.emit('tool:changed', { tool: 'place-vehicle' });
    const initialObjects = [...(panel as any).vehicleTypeObjects];
    const firstButton = initialObjects[0];
    const pointerDown = firstButton.on.mock.calls.find(
      ([event]: [string]) => event === 'pointerdown',
    )[1];

    pointerDown();

    for (const object of initialObjects) {
      expect(object.destroy).toHaveBeenCalled();
    }
    expect((panel as any).vehicleTypeObjects).toHaveLength(initialObjects.length);
  });

  it('keeps selection-only actions hidden for an empty selection', () => {
    expect((panel as any).deleteBtn.setVisible).toHaveBeenLastCalledWith(false);
    expect((panel as any).deleteBtnText.setVisible).toHaveBeenLastCalledWith(false);
    expect((panel as any).tunnelBtn).toBeUndefined();
    expect((panel as any).tunnelBtnText).toBeUndefined();
    expect(scene.add.text.mock.calls.some(
      ([, , text]: [number, number, string]) => text.includes('Toggle Tunnel'),
    )).toBe(false);
  });

  it.each([
    ['place-vehicle', 'vehicleTypeObjects'],
  ])('hides and disables %s controls in play, then restores them in create', (tool, objectsKey) => {
    EventBus.emit('tool:changed', { tool: tool as any });
    const beforePlay = [...(panel as any)[objectsKey]];
    expect(beforePlay.length).toBeGreaterThan(0);

    (panel as any).setVisible(false);

    const container = scene.add.container.mock.results[0].value;
    expect(container.setVisible).toHaveBeenLastCalledWith(false);
    const interactiveObjects = beforePlay.filter((object: any) =>
      object.setInteractive.mock.calls.length > 0,
    );
    expect(interactiveObjects.length).toBeGreaterThan(0);
    for (const object of interactiveObjects) {
      expect(object.disableInteractive).toHaveBeenCalled();
    }

    EventBus.emit('selection:changed', { uuids: [] });
    (panel as any).setVisible(true);

    const afterCreate = (panel as any)[objectsKey];
    expect(afterCreate.length).toBeGreaterThan(0);
    expect(container.setVisible).toHaveBeenLastCalledWith(true);
    expect((panel as any).deleteBtn.setVisible).toHaveBeenLastCalledWith(false);
  });

  it('shows generator as disabled without interactive parameters or a run event', () => {
    const emitSpy = jest.spyOn(EventBus, 'emit');

    EventBus.emit('tool:changed', { tool: 'generator' });

    expect((panel as any).paramObjects).toBeUndefined();
    expect(scene.add.text).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      'Generate unavailable — multi-track construction needs one atomic quote.',
      expect.any(Object),
    );
    expect(emitSpy.mock.calls.some(([event]) => event === 'generator:run')).toBe(false);
    emitSpy.mockRestore();
  });

  it('shows analysed structures and exact refund without tunnel or reshape mutation', () => {
    trackManager.getTrack.mockReturnValue({
      getUUID: () => 'track-1',
      getControlPoints: () => ({
        p0: { x: 0, y: 0 },
        p1: { x: 100, y: 0 },
        p2: { x: 200, y: 0 },
        p3: { x: 300, y: 0 },
      }),
      getCurvePath: () => ({ getLength: () => 300 }),
      structures: [{
        type: 'tunnel',
        startT: 0,
        endT: 1,
        startElevation: 10,
        endElevation: 10,
      }],
      paidBuildCost: 1234,
    });
    selectionManager.selectedUUIDs = ['track-1'];

    EventBus.emit('selection:changed', { uuids: ['track-1'] });
    EventBus.emit('ui:deletion-review', {
      uuids: ['track-1'],
      expectedRefund: 617,
      expectedRevision: 4,
      available: true,
      blockingReason: '',
    });

    expect((panel as any).tunnelBtn).toBeUndefined();
    expect((panel as any).tunnelBtnText).toBeUndefined();
    expect((panel as any).deleteBtnText.setText).toHaveBeenCalledWith(
      expect.stringContaining('Refund £617'),
    );
    expect(scene.add.text).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.stringContaining('cost-delta quote required'),
      expect.any(Object),
    );
  });

  it('confirms the exact sum of per-track floored refunds in two inline steps', () => {
    const tracks: Record<string, any> = {
      a: {
        getUUID: () => 'a',
        getCurvePath: () => ({ getLength: () => 100 }),
        paidBuildCost: 101,
      },
      b: {
        getUUID: () => 'b',
        getCurvePath: () => ({ getLength: () => 100 }),
        paidBuildCost: 103,
      },
    };
    trackManager.getTrack.mockImplementation((uuid: string) => tracks[uuid]);
    selectionManager.selectedUUIDs = ['a', 'b'];
    EventBus.emit('selection:changed', { uuids: ['a', 'b'] });
    EventBus.emit('ui:deletion-review', {
      uuids: ['a', 'b'],
      expectedRefund: 101,
      expectedRevision: 7,
      available: true,
      blockingReason: '',
    });
    const pointerDown = (panel as any).deleteBtn.on.mock.calls.find(
      ([event]: [string]) => event === 'pointerdown',
    )[1];

    expect((panel as any).deleteBtnText.setText).toHaveBeenLastCalledWith(
      expect.stringContaining('Refund £101'),
    );
    pointerDown();
    expect(onDelete).not.toHaveBeenCalled();
    expect((panel as any).deleteBtnText.setText).toHaveBeenLastCalledWith(
      expect.stringContaining('Confirm'),
    );

    pointerDown();
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({
      uuids: ['a', 'b'],
      expectedRefund: 101,
      expectedRevision: 7,
    }));
  });

  it('uses the same exact two-step confirmation for keyboard and context requests', () => {
    trackManager.getTrack.mockReturnValue({
      getUUID: () => 'a',
      getControlPoints: () => ({
        p0: { x: 0, y: 0 },
        p1: { x: 33, y: 0 },
        p2: { x: 66, y: 0 },
        p3: { x: 100, y: 0 },
      }),
      getCurvePath: () => ({ getLength: () => 100 }),
      structures: [],
      paidBuildCost: 101,
    });
    selectionManager.selectedUUIDs = ['a'];
    EventBus.emit('selection:changed', { uuids: ['a'] });
    EventBus.emit('ui:deletion-review', {
      uuids: ['a'],
      expectedRefund: 50,
      expectedRevision: 4,
      available: true,
      blockingReason: '',
    });

    (EventBus as any).emit('ui:delete-request', { uuids: ['a'] });
    expect(onDelete).not.toHaveBeenCalled();
    expect((panel as any).deleteBtnText.setText).toHaveBeenLastCalledWith(
      'Confirm delete · Refund £50',
    );

    (EventBus as any).emit('ui:delete-request', { uuids: ['a'] });
    expect(onDelete).toHaveBeenCalledWith({
      uuids: ['a'],
      expectedRefund: 50,
      expectedRevision: 4,
    });
  });

  it('disarms on revision change and ignores a request for a different selection', () => {
    trackManager.getTrack.mockReturnValue({
      getUUID: () => 'a',
      getControlPoints: () => ({
        p0: { x: 0, y: 0 },
        p1: { x: 33, y: 0 },
        p2: { x: 66, y: 0 },
        p3: { x: 100, y: 0 },
      }),
      getCurvePath: () => ({ getLength: () => 100 }),
      structures: [],
      paidBuildCost: 101,
    });
    selectionManager.selectedUUIDs = ['a'];
    EventBus.emit('selection:changed', { uuids: ['a'] });
    EventBus.emit('ui:deletion-review', {
      uuids: ['a'],
      expectedRefund: 50,
      expectedRevision: 4,
      available: true,
      blockingReason: '',
    });
    (EventBus as any).emit('ui:delete-request', { uuids: ['a'] });
    expect((panel as any).deleteArmed).toBe(true);

    EventBus.emit('ui:deletion-review', {
      uuids: ['a'],
      expectedRefund: 50,
      expectedRevision: 5,
      available: true,
      blockingReason: '',
    });
    expect((panel as any).deleteArmed).toBe(false);

    (EventBus as any).emit('ui:delete-request', { uuids: ['b'] });
    expect((panel as any).deleteArmed).toBe(false);
    expect(onDelete).not.toHaveBeenCalled();

    (EventBus as any).emit('ui:delete-request', { uuids: ['a'] });
    expect(onDelete).not.toHaveBeenCalled();
    (EventBus as any).emit('ui:delete-request', { uuids: ['a'] });
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 5,
    }));
  });

  it('closes a multi-track panel after synchronous deletion without refreshing old UUIDs', () => {
    const tracks: Record<string, any> = {
      a: {
        getUUID: () => 'a',
        getCurvePath: () => ({ getLength: () => 100 }),
        paidBuildCost: 101,
      },
      b: {
        getUUID: () => 'b',
        getCurvePath: () => ({ getLength: () => 100 }),
        paidBuildCost: 103,
      },
    };
    trackManager.getTrack.mockImplementation((uuid: string) => tracks[uuid]);
    selectionManager.selectedUUIDs = ['a', 'b'];
    EventBus.emit('selection:changed', { uuids: ['a', 'b'] });
    EventBus.emit('ui:deletion-review', {
      uuids: ['a', 'b'],
      expectedRefund: 101,
      expectedRevision: 7,
      available: true,
      blockingReason: '',
    });
    onDelete.mockImplementation(() => {
      delete tracks.a;
      delete tracks.b;
      selectionManager.selectedUUIDs = [];
      EventBus.emit('selection:changed', { uuids: [] });
    });

    (EventBus as any).emit('ui:delete-request', { uuids: ['a', 'b'] });
    trackManager.getTrack.mockClear();
    (EventBus as any).emit('ui:delete-request', { uuids: ['a', 'b'] });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(trackManager.getTrack).not.toHaveBeenCalled();
    expect((panel as any).isVisible).toBe(false);
  });

  it('disarms deletion confirmation when selection, tool, or play state changes', () => {
    trackManager.getTrack.mockReturnValue({
      getUUID: () => 'a',
      getControlPoints: () => ({
        p0: { x: 0, y: 0 },
        p1: { x: 33, y: 0 },
        p2: { x: 66, y: 0 },
        p3: { x: 100, y: 0 },
      }),
      getCurvePath: () => ({ getLength: () => 100 }),
      structures: [],
      paidBuildCost: 101,
    });
    selectionManager.selectedUUIDs = ['a'];
    EventBus.emit('selection:changed', { uuids: ['a'] });
    EventBus.emit('ui:deletion-review', {
      uuids: ['a'],
      expectedRefund: 50,
      expectedRevision: 9,
      available: true,
      blockingReason: '',
    });
    const pointerDown = (panel as any).deleteBtn.on.mock.calls.find(
      ([event]: [string]) => event === 'pointerdown',
    )[1];
    pointerDown();
    expect((panel as any).deleteArmed).toBe(true);

    EventBus.emit('tool:changed', { tool: 'select' });
    expect((panel as any).deleteArmed).toBe(false);
    pointerDown();
    panel.setVisible(false);
    expect((panel as any).deleteArmed).toBe(false);
  });

  it('echoes an unavailable authoritative deletion review and cannot arm it', () => {
    trackManager.getTrack.mockReturnValue({
      getUUID: () => 'a',
      getControlPoints: () => ({
        p0: { x: 0, y: 0 },
        p1: { x: 33, y: 0 },
        p2: { x: 66, y: 0 },
        p3: { x: 100, y: 0 },
      }),
      getCurvePath: () => ({ getLength: () => 100 }),
      structures: [],
      paidBuildCost: 999_999,
    });
    selectionManager.selectedUUIDs = ['a'];
    EventBus.emit('selection:changed', { uuids: ['a'] });
    EventBus.emit('ui:deletion-review', {
      uuids: ['a'],
      expectedRefund: 0,
      expectedRevision: 12,
      available: false,
      blockingReason: 'Deletion blocked · Move trains off these tracks first',
    });
    const pointerDown = (panel as any).deleteBtn.on.mock.calls.find(
      ([event]: [string]) => event === 'pointerdown',
    )[1];

    expect((panel as any).deleteBtnText.setText).toHaveBeenLastCalledWith(
      expect.stringContaining('Move trains'),
    );
    pointerDown();
    expect((panel as any).deleteArmed).toBe(false);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('hides selection properties while the Place tool owns the right edge', () => {
    trackManager.getTrack.mockReturnValue({
      getUUID: () => 'a',
      getControlPoints: () => ({
        p0: { x: 0, y: 0 },
        p1: { x: 33, y: 0 },
        p2: { x: 66, y: 0 },
        p3: { x: 100, y: 0 },
      }),
      getCurvePath: () => ({ getLength: () => 100 }),
      structures: [],
      paidBuildCost: 100,
    });
    selectionManager.selectedUUIDs = ['a'];
    EventBus.emit('selection:changed', { uuids: ['a'] });

    EventBus.emit('tool:changed', { tool: 'place-track' });

    expect((panel as any).isVisible).toBe(false);
  });
});
