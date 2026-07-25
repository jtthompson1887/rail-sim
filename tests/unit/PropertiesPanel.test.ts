import { PropertiesPanel } from '../../src/ui/PropertiesPanel';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

describe('PropertiesPanel vehicle selector', () => {
  let panel: PropertiesPanel;

  beforeEach(() => {
    const scene = makeScene();
    const makeRectangle = scene.add.rectangle;
    scene.add.rectangle = jest.fn().mockImplementation(() => {
      const rectangle = makeRectangle();
      rectangle.setPosition = jest.fn().mockReturnValue(rectangle);
      return rectangle;
    });
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
});
