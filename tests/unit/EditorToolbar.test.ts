import { EditorToolbar } from '../../src/ui/EditorToolbar';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

describe('EditorToolbar lifecycle', () => {
  it('hides, restores, and destroys every owned display object without an unused container', () => {
    const scene = makeScene();
    const toolbar = new EditorToolbar(scene);
    const rectangles = scene.add.rectangle.mock.results.map(({ value }: any) => value);
    const texts = scene.add.text.mock.results.map(({ value }: any) => value);
    const ownedObjects = [...rectangles, ...texts];

    toolbar.setVisible(false);
    for (const object of ownedObjects) {
      expect(object.setVisible).toHaveBeenLastCalledWith(false);
    }

    toolbar.setVisible(true);
    for (const object of ownedObjects) {
      expect(object.setVisible).toHaveBeenLastCalledWith(true);
    }

    toolbar.destroy();
    for (const object of new Set(ownedObjects)) {
      expect(object.destroy).toHaveBeenCalled();
    }
    expect(scene.add.container).not.toHaveBeenCalled();
  });

  it.each(['generator', 'completer', 'junction', 'eraser'] as const)(
    'refuses disabled %s selection with the engineering-lock reason',
    (tool) => {
      const scene = makeScene();
      const toolbar = new EditorToolbar(scene);
      const emitSpy = jest.spyOn(EventBus, 'emit');

      toolbar.selectTool(tool);

      expect(toolbar.currentTool).toBe('none');
      expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
        message: expect.stringMatching(/engineering analysis|economy-aware/),
        type: 'info',
      });
      emitSpy.mockRestore();
      toolbar.destroy();
    },
  );

  it('enables the economy-aware place-track tool', () => {
    const scene = makeScene();
    const toolbar = new EditorToolbar(scene);
    const emitSpy = jest.spyOn(EventBus, 'emit');

    toolbar.selectTool('place-track');

    expect(toolbar.currentTool).toBe('place-track');
    expect(emitSpy).toHaveBeenCalledWith('tool:changed', {
      tool: 'place-track',
    });
    toolbar.destroy();
    emitSpy.mockRestore();
  });
});
