import { EditorToolbar } from '../../src/ui/EditorToolbar';

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
});
