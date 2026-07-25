import WorldScene from '../../src/scenes/WorldScene';
import { GameStateManager } from '../../src/managers/GameStateManager';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';

describe('WorldScene disabled construction bypass guards', () => {
  afterEach(() => {
    GameStateManager.enterCreate('test-world');
  });

  it.each(['generator', 'completer', 'junction'] as const)(
    'ignores programmatic %s tool activation',
    (tool) => {
      const scene = new WorldScene();
      const activate = jest.fn();
      (scene as any).toolRegistry = new Map([[tool, { activate }]]);
      (scene as any).cameraController = { setInputLockOwner: jest.fn() };
      GameStateManager.enterCreate('test-world');

      (scene as any).toolChangedHandler({ tool });

      expect(activate).not.toHaveBeenCalled();
      expect((scene as any).activeEditorTool).toBeNull();
    },
  );

  it.each(['eraser'] as const)(
    'ignores programmatic economy-bypassing %s activation',
    (tool) => {
      const scene = new WorldScene();
      const activate = jest.fn();
      (scene as any).toolRegistry = new Map([[tool, { activate }]]);
      (scene as any).cameraController = { setInputLockOwner: jest.fn() };
      GameStateManager.enterCreate('test-world');

      (scene as any).toolChangedHandler({ tool });

      expect(activate).not.toHaveBeenCalled();
      expect((scene as any).activeEditorTool).toBeNull();
    },
  );

  it('activates the economy-aware place-track tool programmatically', () => {
    const scene = new WorldScene();
    const place = {
      activate: jest.fn(),
      cancel: jest.fn(),
      deactivate: jest.fn(),
    };
    (scene as any).toolRegistry = new Map([['place-track', place]]);
    (scene as any).cameraController = {
      setInputLockOwner: jest.fn(),
      setCursor: jest.fn(),
    };
    GameStateManager.enterCreate('test-world');

    (scene as any).toolChangedHandler({ tool: 'place-track' });

    expect(place.activate).toHaveBeenCalledTimes(1);
    expect((scene as any).activeEditorTool).toBe(place);
    expect((scene as any).cameraController.setInputLockOwner)
      .toHaveBeenCalledWith('editor-tool');
  });

  it.each(['KeyG', 'KeyD', 'KeyJ'])(
    'does not emit a toolbar-selection event for disabled shortcut %s',
    (code) => {
      const scene = new WorldScene();
      const emitSpy = jest.spyOn(EventBus, 'emit');
      GameStateManager.enterCreate('test-world');

      (scene as any).handleKeyDown({ code, ctrlKey: false, altKey: false });

      expect(emitSpy.mock.calls.some(
        ([event]) => event === 'ui:toolbar-select-tool',
      )).toBe(false);
      emitSpy.mockRestore();
    },
  );

  it.each(['KeyE', 'Delete'])(
    'does not mutate or select a cash-bypassing action for %s',
    (code) => {
      const scene = new WorldScene();
      const push = jest.fn();
      (scene as any).commandStack = { push };
      (scene as any).selectionManager = {
        selectedUUIDs: ['paid-track'],
        clearSelection: jest.fn(),
      };
      const emitSpy = jest.spyOn(EventBus, 'emit');
      GameStateManager.enterCreate('test-world');

      (scene as any).handleKeyDown({ code, ctrlKey: false, altKey: false });

      expect(push).not.toHaveBeenCalled();
      expect(emitSpy.mock.calls.some(
        ([event, payload]) => event === 'ui:toolbar-select-tool'
          && (((payload as any).tool === 'place-track') || ((payload as any).tool === 'eraser')),
      )).toBe(false);
      emitSpy.mockRestore();
    },
  );

  it('emits toolbar selection for the P shortcut', () => {
    const scene = new WorldScene();
    const emitSpy = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterCreate('test-world');

    (scene as any).handleKeyDown({
      code: 'KeyP',
      ctrlKey: false,
      altKey: false,
    });

    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toolbar-select-tool',
      { tool: 'place-track' },
    );
    emitSpy.mockRestore();
  });

  it('keeps Place selected when Escape cancels its pending proposal', () => {
    const scene = new WorldScene();
    const cancel = jest.fn();
    (scene as any).activeTool = 'place-track';
    (scene as any).activeEditorTool = { cancel, onKeyDown: jest.fn() };
    (scene as any).selectionManager = { clearSelection: jest.fn() };
    const emitSpy = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterCreate('test-world');

    (scene as any).handleKeyDown({
      code: 'Escape',
      ctrlKey: false,
      altKey: false,
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(emitSpy).not.toHaveBeenCalledWith(
      'ui:toolbar-select-tool',
      { tool: 'none' },
    );
    emitSpy.mockRestore();
  });

  it('cancels pending construction before undo changes the authority revision', () => {
    const scene = new WorldScene();
    const cancel = jest.fn();
    const undo = jest.fn();
    (scene as any).activeTool = 'place-track';
    (scene as any).activeEditorTool = { cancel };
    (scene as any).commandStack = { undo };
    GameStateManager.enterCreate('test-world');

    (scene as any).handleKeyDown({
      code: 'KeyZ',
      ctrlKey: true,
      altKey: false,
    });

    expect(cancel.mock.invocationCallOrder[0])
      .toBeLessThan(undo.mock.invocationCallOrder[0]);
  });

  it('cancels pending construction before toolbar undo/redo changes authority', () => {
    const scene = new WorldScene();
    const cancel = jest.fn();
    const undo = jest.fn();
    const redo = jest.fn();
    (scene as any).activeTool = 'place-track';
    (scene as any).activeEditorTool = { cancel };
    (scene as any).commandStack = { undo, redo };
    GameStateManager.enterCreate('test-world');

    (scene as any).undoHandler();
    (scene as any).redoHandler();

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel.mock.invocationCallOrder[0])
      .toBeLessThan(undo.mock.invocationCallOrder[0]);
    expect(cancel.mock.invocationCallOrder[1])
      .toBeLessThan(redo.mock.invocationCallOrder[0]);
  });

  it('routes editor pointers through the camera world transform only in create mode', () => {
    const scene = new WorldScene();
    const onPointerDown = jest.fn();
    (scene as any).activeEditorTool = { onPointerDown };
    (scene as any).inputManager = {
      toWorldPoint: jest.fn().mockReturnValue({ x: 712, y: -84 }),
    };
    (scene as any).scale = { width: 1920, height: 1080 };
    const pointer = {
      x: 400,
      y: 200,
      button: 0,
      rightButtonDown: () => false,
    };
    GameStateManager.enterCreate('test-world');

    (scene as any).handlePointerDown(pointer);
    expect((scene as any).inputManager.toWorldPoint).toHaveBeenCalledWith(pointer);
    expect(onPointerDown).toHaveBeenCalledWith(712, -84, pointer);

    GameStateManager.enterPlay('test-world');
    (scene as any).handlePointerDown(pointer);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('forwards the canceling pointer to pointer-aware construction tools', () => {
    const scene = new WorldScene();
    const onPointerCancel = jest.fn();
    const cancel = jest.fn();
    (scene as any).activeEditorTool = { cancel, onPointerCancel };
    GameStateManager.enterCreate('test-world');
    const pointer = { id: 9 };

    (scene as any).handlePointerCancel(pointer);

    expect(onPointerCancel).toHaveBeenCalledWith(pointer);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('rejects editor delete events and the direct scene deletion path', () => {
    const scene = new WorldScene();
    const push = jest.fn();
    (scene as any).commandStack = { push };
    (scene as any).selectionManager = {
      selectedUUIDs: ['paid-track'],
      clearSelection: jest.fn(),
    };
    GameStateManager.enterCreate('test-world');

    (scene as any).editorDeleteHandler({ uuids: ['paid-track'] });
    (scene as any).deleteSelectedTracks(['paid-track']);

    expect(push).not.toHaveBeenCalled();
    expect((scene as any).selectionManager.clearSelection).not.toHaveBeenCalled();
  });

  it('refuses generator run events even in create mode', () => {
    const scene = new WorldScene();
    const runFromAnchor = jest.fn();
    (scene as any).toolRegistry = new Map([['generator', { runFromAnchor }]]);
    GameStateManager.enterCreate('test-world');

    (scene as any).generatorRunHandler();

    expect(runFromAnchor).not.toHaveBeenCalled();
  });

  it('keeps the toolbar unsaved and reports an error when persistence fails', () => {
    const scene = new WorldScene();
    (scene as any).trainManager = { trains: [], carriages: [] };
    const saveSpy = jest.spyOn(WorldManager, 'save').mockReturnValue(false);
    const emitSpy = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterCreate('test-world');

    (scene as any).saveHandler();

    expect(emitSpy).not.toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'saved' },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'unsaved' },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      { message: 'Could not save the world.', type: 'error' },
    );

    emitSpy.mockRestore();
    saveSpy.mockRestore();
  });

  it('reports save failure when entering create mode', () => {
    const scene = new WorldScene();
    (scene as any).trainManager = { trains: [], carriages: [] };
    (scene as any).cameraController = {
      stopFollow: jest.fn(),
    };
    const saveSpy = jest.spyOn(WorldManager, 'save').mockReturnValue(false);
    const emitSpy = jest.spyOn(EventBus, 'emit');

    (scene as any).activateCreateMode();

    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'unsaved' },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      { message: 'Could not save the world.', type: 'error' },
    );

    emitSpy.mockRestore();
    saveSpy.mockRestore();
  });
});
