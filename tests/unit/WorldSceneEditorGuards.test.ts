import WorldScene from '../../src/scenes/WorldScene';
import { GameStateManager } from '../../src/managers/GameStateManager';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';

describe('WorldScene disabled construction bypass guards', () => {
  afterEach(() => {
    GameStateManager.enterCreate('test-world');
  });

  it.each(['generator', 'completer', 'junction', 'eraser'] as const)(
    'rejects programmatic %s activation and restores camera interaction',
    (tool) => {
      const scene = new WorldScene();
      const activate = jest.fn();
      const cancel = jest.fn();
      const deactivate = jest.fn();
      (scene as any).toolRegistry = new Map([[tool, { activate }]]);
      (scene as any).activeTool = 'place-track';
      (scene as any).activeEditorTool = { cancel, deactivate };
      (scene as any).cameraController = {
        setInputLockOwner: jest.fn(),
        setCursor: jest.fn(),
      };
      GameStateManager.enterCreate('test-world');

      (scene as any).toolChangedHandler({ tool });

      expect(activate).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(deactivate).toHaveBeenCalledTimes(1);
      expect((scene as any).activeEditorTool).toBeNull();
      expect((scene as any).activeTool).toBe('none');
      expect((scene as any).cameraController.setCursor)
        .toHaveBeenCalledWith('default');
      expect((scene as any).cameraController.setInputLockOwner)
        .toHaveBeenCalledWith('camera');
    },
  );

  it('does not expose the unquoted reshape command from the editor command boundary', () => {
    const commands = require('../../src/systems/CommandStack');

    expect(commands.ReshapeTrackCommand).toBeUndefined();
  });

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

  it.each([
    ['KeyD', 'Connect unavailable — route completion needs one atomic quote.'],
    ['KeyJ', 'Junction unavailable — track splitting needs one atomic quote.'],
    ['KeyG', 'Generate unavailable — multi-track construction needs one atomic quote.'],
    ['KeyE', 'Erase unavailable — select tracks to review the exact refund.'],
  ])(
    'routes disabled shortcut %s to its exact guidance without selection or mutation',
    (code, message) => {
      const scene = new WorldScene();
      const onKeyDown = jest.fn();
      const push = jest.fn();
      (scene as any).activeEditorTool = { onKeyDown };
      (scene as any).commandStack = { push };
      const emitSpy = jest.spyOn(EventBus, 'emit');
      GameStateManager.enterCreate('test-world');

      (scene as any).handleKeyDown({ code, ctrlKey: false, altKey: false });

      expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
        message,
        type: 'info',
      });
      expect(emitSpy.mock.calls.some(
        ([event]) => event === 'ui:toolbar-select-tool',
      )).toBe(false);
      expect(onKeyDown).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      emitSpy.mockRestore();
    },
  );

  it('routes repeated Delete keys to the exact selected refund review without direct mutation', () => {
    const scene = new WorldScene();
    const push = jest.fn();
    const clearSelection = jest.fn();
    (scene as any).commandStack = { push };
    (scene as any).selectionManager = {
      selectedUUIDs: ['paid-a', 'paid-b'],
      clearSelection,
    };
    const emitSpy = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterCreate('test-world');

    (scene as any).handleKeyDown({ code: 'Delete', ctrlKey: false, altKey: false });
    (scene as any).handleKeyDown({ code: 'Delete', ctrlKey: false, altKey: false });

    const requests = emitSpy.mock.calls.filter(
      ([event]) => String(event) === 'ui:delete-request',
    );
    expect(requests).toEqual([
      ['ui:delete-request', { uuids: ['paid-a', 'paid-b'] }],
      ['ui:delete-request', { uuids: ['paid-a', 'paid-b'] }],
    ]);
    expect(push).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
    emitSpy.mockRestore();
  });

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

  it('ignores gameplay shortcuts originating from an interactive DOM control', () => {
    const scene = new WorldScene();
    const confirm = jest.fn();
    (scene as any).activeTool = 'place-track';
    (scene as any).activeEditorTool = { onKeyDown: confirm };
    GameStateManager.enterCreate('test-world');
    const button = document.createElement('button');

    (scene as any).handleKeyDown({
      code: 'Enter',
      ctrlKey: false,
      altKey: false,
      target: button,
    });

    expect(confirm).not.toHaveBeenCalled();
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

  it('does not leak an inspector or HUD click into the active construction tool', () => {
    const scene = new WorldScene();
    const onPointerDown = jest.fn();
    (scene as any).activeEditorTool = { onPointerDown };
    (scene as any).inputManager = {
      toWorldPoint: jest.fn().mockReturnValue({ x: 712, y: -84 }),
    };
    (scene as any).scene = {
      get: jest.fn().mockReturnValue({
        containsScreenPoint: jest.fn().mockReturnValue(true),
      }),
    };
    const pointer = {
      x: 1800,
      y: 760,
      button: 0,
      rightButtonDown: () => false,
    };
    GameStateManager.enterCreate('test-world');

    (scene as any).handlePointerDown(pointer);

    expect(onPointerDown).not.toHaveBeenCalled();
    expect((scene as any).inputManager.toWorldPoint).not.toHaveBeenCalled();
  });

  it('routes inspector intents only to the active authoritative Place tool', () => {
    const scene = new WorldScene();
    const tool = {
      confirm: jest.fn(),
      backstep: jest.fn(),
      cancel: jest.fn(),
    };
    (scene as any).activeTool = 'place-track';
    (scene as any).activeEditorTool = tool;
    GameStateManager.enterCreate('test-world');

    (scene as any).constructionIntentHandler({ action: 'confirm' });
    (scene as any).constructionIntentHandler({ action: 'backstep' });
    (scene as any).constructionIntentHandler({ action: 'cancel' });

    expect(tool.confirm).toHaveBeenCalledTimes(1);
    expect(tool.backstep).toHaveBeenCalledTimes(1);
    expect(tool.cancel).toHaveBeenCalledTimes(1);

    (scene as any).activeTool = 'select';
    (scene as any).constructionIntentHandler({ action: 'confirm' });
    expect(tool.confirm).toHaveBeenCalledTimes(1);
  });

  it('publishes authoritative cash after command push, undo, and redo changes', () => {
    const scene = new WorldScene();
    WorldManager.createNew('HUD authority', 'quote-seed');
    (scene as any).commandStack = {};
    (scene as any).selectionManager = { selectedUUIDs: [] };
    const emit = jest.spyOn(EventBus, 'emit');
    (scene as any).bindCommandStackReporting();

    for (const cash of [997_200, 1_000_000, 997_200]) {
      WorldManager.world!.company.cash = cash;
      (scene as any).commandStack.onChange(true, true);
      expect(emit).toHaveBeenCalledWith('ui:company-state', {
        cash,
        saveState: 'unsaved',
      });
    }

    emit.mockRestore();
    WorldManager.reset();
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

  it('rejects stale deletion intent with zero command or selection mutation', () => {
    const scene = new WorldScene();
    const push = jest.fn();
    WorldManager.createNew('Delete authority', 'quote-seed');
    (scene as any).commandStack = { push };
    (scene as any).selectionManager = {
      selectedUUIDs: ['paid-track'],
      clearSelection: jest.fn(),
    };
    GameStateManager.enterCreate('test-world');

    (scene as any).editorDeleteHandler({
      uuids: ['paid-track'],
      expectedRefund: 50,
      expectedRevision: WorldManager.world!.revision + 1,
    });

    expect(push).not.toHaveBeenCalled();
    expect((scene as any).selectionManager.clearSelection).not.toHaveBeenCalled();
    WorldManager.reset();
  });

  it('pushes an exactly revalidated deletion through CommandStack and clears selection', () => {
    const scene = new WorldScene();
    const world = WorldManager.createNew('Delete authority', 'quote-seed');
    world.tracks.push({
      uuid: 'paid-track',
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 0 },
      p2: { x: 200, y: 0 },
      p3: { x: 300, y: 0 },
      verticalProfile: {
        profileVersion: 1,
        knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
      },
      structures: [{
        type: 'surface',
        startT: 0,
        endT: 1,
        startElevation: 0,
        endElevation: 0,
      }],
      paidBuildCost: 101,
    });
    const push = jest.fn().mockReturnValue(true);
    const clearSelection = jest.fn();
    (scene as any).commandStack = { push };
    (scene as any).trackManager = {
      captureTopology: jest.fn().mockReturnValue({
        connections: [],
        junctions: [],
      }),
      getJunction: jest.fn(),
    };
    (scene as any).selectionManager = {
      selectedUUIDs: ['paid-track'],
      clearSelection,
    };
    GameStateManager.enterCreate(world.id);

    (scene as any).editorDeleteHandler({
      uuids: ['paid-track'],
      expectedRefund: 50,
      expectedRevision: world.revision,
    });

    expect(push).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Delete track(s)',
    }));
    expect(clearSelection).toHaveBeenCalledTimes(1);
    WorldManager.reset();
  });

  it('publishes the persisted refund and a specific station dependency reason', () => {
    const scene = new WorldScene();
    const world = WorldManager.createNew('Delete review', 'quote-seed');
    world.tracks.push({
      uuid: 'paid-track',
      geometryVersion: 1,
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 0 },
      p2: { x: 200, y: 0 },
      p3: { x: 300, y: 0 },
      verticalProfile: {
        profileVersion: 1,
        knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
      },
      structures: [{
        type: 'surface',
        startT: 0,
        endT: 1,
        startElevation: 0,
        endElevation: 0,
      }],
      paidBuildCost: 101,
    });
    world.stations.push({
      id: 'station-1',
      name: 'Station',
      trackUUID: 'paid-track',
      trackT: 0.5,
      passengerSpawnRate: 1,
    });
    (scene as any).selectionManager = {
      selectedUUIDs: ['paid-track'],
      clearSelection: jest.fn(),
    };
    (scene as any).commandStack = { push: jest.fn() };
    const emit = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterCreate(world.id);

    (scene as any).publishDeletionReview(['paid-track']);
    expect(emit).toHaveBeenCalledWith('ui:deletion-review', {
      uuids: ['paid-track'],
      expectedRefund: 50,
      expectedRevision: world.revision,
      available: false,
      blockingReason: expect.stringContaining('Remove stations'),
    });

    (scene as any).editorDeleteHandler({
      uuids: ['paid-track'],
      expectedRefund: 50,
      expectedRevision: world.revision,
    });
    expect((scene as any).commandStack.push).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('ui:toast', {
      message: expect.stringContaining('Remove stations'),
      type: 'warning',
    });

    emit.mockRestore();
    WorldManager.reset();
  });

  it('refuses generator run events even in create mode', () => {
    const scene = new WorldScene();
    const runFromAnchor = jest.fn();
    (scene as any).toolRegistry = new Map([['generator', { runFromAnchor }]]);
    GameStateManager.enterCreate('test-world');

    const emitSpy = jest.spyOn(EventBus, 'emit');
    (scene as any).generatorRunHandler();

    expect(runFromAnchor).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
      message: 'Generate unavailable — multi-track construction needs one atomic quote.',
      type: 'info',
    });
    emitSpy.mockRestore();
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
      'ui:company-state',
      { cash: expect.any(Number), saveState: 'unsaved' },
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
