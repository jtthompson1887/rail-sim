import { EditorToolbar } from '../../src/ui/EditorToolbar';
import { EventBus } from '../../src/services/EventBus';
import { makeUiScene, simulatePointer } from '../helpers/PhaserUiHarness';

const { makeScene } = require('../../__mocks__/phaser');

describe('EditorToolbar lifecycle', () => {
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
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

  it('visually dims disabled construction tool buttons and suppresses hover feedback', () => {
    const { scene } = makeUiScene();
    const toolbar = new EditorToolbar(scene);
    const disabledTools = ['completer', 'junction', 'generator', 'eraser'] as const;
    const buttons = (toolbar as any).toolButtons as any[];
    toolbar.destroy();

    for (const tool of disabledTools) {
      const ref = buttons.find((b) => b.tool === tool);
      expect(ref).toBeDefined();
      expect(ref.bg.setAlpha).toHaveBeenLastCalledWith(0.45);
      expect(ref.iconText.setAlpha).toHaveBeenLastCalledWith(0.45);
      expect(ref.labelText.setAlpha).toHaveBeenLastCalledWith(0.45);
      expect(ref.shortcutText.setAlpha).toHaveBeenLastCalledWith(0.45);
      expect(ref.bg.setInteractive).toHaveBeenCalledWith({ useHandCursor: false });

      const fillCallsBefore = ref.bg.setFillStyle.mock.calls.length;
      simulatePointer(ref.bg, 'pointerover');
      expect(ref.bg.setFillStyle).toHaveBeenCalledTimes(fillCallsBefore);
      simulatePointer(ref.bg, 'pointerout');
      expect(ref.bg.setFillStyle).toHaveBeenCalledTimes(fillCallsBefore);
    }
  });

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

  it('shows one handed-off startup save error and removes its toast listener on destroy', () => {
    const scene = makeScene();
    const showToast = jest.spyOn(
      EditorToolbar.prototype as any,
      'showToast',
    );
    const toolbar = new EditorToolbar(scene);
    const startupError = {
      message: 'Could not save the world. Retry Save is available.',
      type: 'error' as const,
    };

    EventBus.emit('ui:toast', startupError);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(startupError.message, 'error');

    toolbar.destroy();
    EventBus.emit('ui:toast', startupError);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('reflects undo and redo availability in button alpha', () => {
    const { scene } = makeUiScene();
    const toolbar = new EditorToolbar(scene);
    const undoBg = (toolbar as any).undoBg;
    const redoBg = (toolbar as any).redoBg;

    toolbar.setUndoEnabled(true);
    expect(undoBg.setAlpha).toHaveBeenLastCalledWith(1);
    toolbar.setUndoEnabled(false);
    expect(undoBg.setAlpha).toHaveBeenLastCalledWith(0.4);

    toolbar.setRedoEnabled(true);
    expect(redoBg.setAlpha).toHaveBeenLastCalledWith(1);
    toolbar.setRedoEnabled(false);
    expect(redoBg.setAlpha).toHaveBeenLastCalledWith(0.4);

    toolbar.destroy();
  });

  it('highlights a tool button on hover and restores on leave while inactive', () => {
    const { scene } = makeUiScene();
    const toolbar = new EditorToolbar(scene);
    const first = (toolbar as any).toolButtons[0];

    simulatePointer(first.bg, 'pointerover');
    expect(first.bg.setFillStyle).toHaveBeenLastCalledWith(0x1e4a6e, 0.95);
    simulatePointer(first.bg, 'pointerout');
    expect(first.bg.setFillStyle).toHaveBeenLastCalledWith(0x1a3a5c, 0.85);

    toolbar.destroy();
  });

  it('does not highlight an active tool button on hover', () => {
    const { scene } = makeUiScene();
    const toolbar = new EditorToolbar(scene);
    const first = (toolbar as any).toolButtons[0];

    toolbar.selectTool(first.tool);
    const callsBeforeHover = first.bg.setFillStyle.mock.calls.length;

    simulatePointer(first.bg, 'pointerover');
    expect(first.bg.setFillStyle).toHaveBeenCalledTimes(callsBeforeHover);

    toolbar.destroy();
  });

  it('styles toast text by type and uses fade-out tweens', () => {
    jest.useFakeTimers();
    const { scene, tweensAdd } = makeUiScene();
    const toolbar = new EditorToolbar(scene);
    const toastText = (toolbar as any).toastText;

    for (const [type, color] of [
      ['error', '#ff8080'],
      ['success', '#4ade80'],
      ['info', '#ffffff'],
      ['warning', '#ffffff'],
    ] as const) {
      EventBus.emit('ui:toast', { message: `${type} toast`, type: type as any });
      expect(toastText.setColor).toHaveBeenLastCalledWith(color);
      expect(toastText.setText).toHaveBeenLastCalledWith(`${type} toast`);
    }

    jest.advanceTimersByTime(2500);
    expect(tweensAdd).toHaveBeenLastCalledWith(expect.objectContaining({
      targets: toastText,
      alpha: 0,
      duration: 400,
    }));

    toolbar.destroy();
  });

  it('removes the toast listener on scene shutdown', () => {
    jest.useFakeTimers();
    const showToast = jest.spyOn(
      EditorToolbar.prototype as any,
      'showToast',
    );
    const { scene } = makeUiScene();
    const toolbar = new EditorToolbar(scene);
    const toast = { message: 'shutdown test', type: 'info' as const };

    EventBus.emit('ui:toast', toast);
    expect(showToast).toHaveBeenCalledTimes(1);

    const shutdown = scene.events.once.mock.calls.find(
      ([event]: [string]) => event === 'shutdown',
    )[1];
    shutdown();

    EventBus.emit('ui:toast', toast);
    expect(showToast).toHaveBeenCalledTimes(1);

    toolbar.destroy();
  });
});
