import { PropertiesPanel } from '../../src/ui/PropertiesPanel';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

describe('PropertiesPanel', () => {
  let panel: PropertiesPanel;
  let scene: any;
  let trackManager: any;
  let selectionManager: any;

  beforeEach(() => {
    scene = makeScene();
    trackManager = { getTrack: jest.fn() };
    selectionManager = { selectedUUIDs: [] };
    panel = new PropertiesPanel(
      scene,
      trackManager as any,
      selectionManager as any,
      jest.fn(),
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
    expect((panel as any).tunnelBtn.setVisible).toHaveBeenLastCalledWith(false);
    expect((panel as any).tunnelBtnText.setVisible).toHaveBeenLastCalledWith(false);
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

    expect((panel as any).paramObjects.every(
      (object: any) => object.setInteractive.mock.calls.length === 0,
    )).toBe(true);
    expect(scene.add.text).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.stringContaining('engineering analysis'),
      expect.any(Object),
    );
    expect(emitSpy.mock.calls.some(([event]) => event === 'generator:run')).toBe(false);
    emitSpy.mockRestore();
  });

  it('shows analysed structures without a manual tunnel mutation', () => {
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

    expect((panel as any).tunnelBtn.setVisible).toHaveBeenLastCalledWith(true);
    expect((panel as any).tunnelBtn.disableInteractive).toHaveBeenCalled();
    expect((panel as any).tunnelBtnText.setText).toHaveBeenCalledWith(
      expect.stringContaining('analysis'),
    );
    expect((panel as any).deleteBtn.disableInteractive).toHaveBeenCalled();
    expect((panel as any).deleteBtnText.setText).toHaveBeenCalledWith(
      expect.stringContaining('Deletion'),
    );
  });
});
