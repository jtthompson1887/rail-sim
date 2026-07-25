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

  it.each(['place-track', 'eraser'] as const)(
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

  it.each(['KeyP', 'KeyE', 'Delete'])(
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
