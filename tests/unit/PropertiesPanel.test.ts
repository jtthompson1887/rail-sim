import { PropertiesPanel } from '../../src/ui/PropertiesPanel';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

describe('PropertiesPanel', () => {
  let panel: PropertiesPanel;
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
    const trackManager = { getTrack: jest.fn() };
    const selectionManager = { selectedUUIDs: [] };
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
    ['generator', 'paramObjects'],
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
});
