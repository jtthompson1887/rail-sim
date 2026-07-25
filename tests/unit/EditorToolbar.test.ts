import { EditorToolbar } from '../../src/ui/EditorToolbar';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

describe('EditorToolbar lifecycle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

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

  it.each([
    ['generator', 'Generate unavailable — multi-track construction needs one atomic quote.'],
    ['completer', 'Connect unavailable — route completion needs one atomic quote.'],
    ['junction', 'Junction unavailable — track splitting needs one atomic quote.'],
    ['eraser', 'Erase unavailable — select tracks to review the exact refund.'],
  ] as const)(
    'refuses disabled %s selection with its truthful next-step reason',
    (tool, message) => {
      const scene = makeScene();
      const toolbar = new EditorToolbar(scene);
      const emitSpy = jest.spyOn(EventBus, 'emit');

      toolbar.selectTool(tool);

      expect(toolbar.currentTool).toBe('none');
      expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
        message,
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

  it('exposes Retry Save as a native accessible action only while visible and unsaved', () => {
    const scene = makeScene();
    const toolbar = new EditorToolbar(scene);
    const emitSpy = jest.spyOn(EventBus, 'emit');
    const retry = document.querySelector(
      '[data-testid="editor-retry-save"]',
    ) as HTMLButtonElement | null;

    expect(retry?.tagName).toBe('BUTTON');
    expect(retry?.type).toBe('button');
    expect(retry?.getAttribute('aria-label')).toBe('Retry Save');
    expect(retry?.style.display).toBe('none');

    toolbar.setSaveIndicator('unsaved');
    expect(retry?.textContent).toBe('Retry Save');
    expect(retry?.style.display).toBe('block');
    expect(retry?.disabled).toBe(false);
    retry?.click();
    expect(emitSpy).toHaveBeenCalledWith('editor:save', {});

    toolbar.setSaveIndicator('saving');
    expect(retry?.style.display).toBe('none');
    expect(retry?.disabled).toBe(true);

    toolbar.setSaveIndicator('unsaved');
    toolbar.setVisible(false);
    expect(retry?.style.display).toBe('none');
    toolbar.setVisible(true);
    expect(retry?.style.display).toBe('block');

    toolbar.setSaveIndicator('saved');
    expect(retry?.style.display).toBe('none');
    toolbar.destroy();
    expect(document.querySelector('[data-testid="editor-retry-save"]')).toBeNull();
  });
});
