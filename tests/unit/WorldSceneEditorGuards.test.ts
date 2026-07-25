import WorldScene from '../../src/scenes/WorldScene';
import { GameStateManager } from '../../src/managers/GameStateManager';
import { EventBus } from '../../src/services/EventBus';

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

  it('refuses generator run events even in create mode', () => {
    const scene = new WorldScene();
    const runFromAnchor = jest.fn();
    (scene as any).toolRegistry = new Map([['generator', { runFromAnchor }]]);
    GameStateManager.enterCreate('test-world');

    (scene as any).generatorRunHandler();

    expect(runFromAnchor).not.toHaveBeenCalled();
  });
});
