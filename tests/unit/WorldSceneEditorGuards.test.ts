import WorldScene from '../../src/scenes/WorldScene';
import { GameStateManager } from '../../src/managers/GameStateManager';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';
import { CommandStack } from '../../src/systems/CommandStack';
import { SaveService } from '../../src/services/SaveService';
import { GameConfig } from '../../src/config/GameConfig';
import { applyConstructionTransaction } from '../../src/systems/ConstructionEconomy';

describe('WorldScene disabled construction bypass guards', () => {
  const startupScenes: any[] = [];

  function prepareWorldLoop(scene: any): void {
    scene.scene = { isPaused: jest.fn().mockReturnValue(false) };
    scene.cameraController = { update: jest.fn() };
    scene.publishDebugState = jest.fn();
    scene.terrainChunkManager = { update: jest.fn() };
    scene.sceneryManager = { update: jest.fn() };
    scene.updateTerrainOverlay = jest.fn();
    scene.inputManager = { handleTrainMovement: jest.fn() };
    scene.trainManager = {
      selectedTrain: null,
      trains: [],
      carriages: [],
      update: jest.fn(),
    };
    scene.contentLoader = { stations: [] };
    scene.publishHUDState = jest.fn();
  }

  function createStartupScene(
    mode: 'create' | 'play',
    saveResult: boolean,
  ): {
    scene: any;
    save: jest.SpyInstance;
    launch: jest.Mock;
  } {
    const world = WorldManager.createNew(`Startup ${mode}`, `startup-${mode}`);
    const scene = new WorldScene() as any;
    const graphics = scene.add.graphics();
    graphics.setScrollFactor = jest.fn().mockReturnValue(graphics);
    scene.add.graphics = jest.fn().mockReturnValue(graphics);
    const launch = jest.fn();
    scene.scene = {
      launch,
      start: jest.fn(),
      stop: jest.fn(),
      get: jest.fn(),
    };
    scene.cameras.main.setZoom = jest.fn();
    scene.cameras.main.centerOn = jest.fn();
    scene.init({ worldId: world.id, mode });
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(saveResult);
    startupScenes.push(scene);
    scene.create();
    return { scene, save, launch };
  }

  afterEach(() => {
    for (const scene of startupScenes.splice(0)) {
      for (const [, callback] of scene.events.once.mock.calls) callback();
    }
    jest.restoreAllMocks();
    WorldManager.reset();
    localStorage.clear();
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
    const facility = {
      facilityId: 'sawmill',
      setSelected: jest.fn(),
      setSelectionEnabled: jest.fn(),
    };
    (scene as any).facilityViews = [facility];
    (scene as any).selectedFacilityId = 'sawmill';
    GameStateManager.enterCreate('test-world');

    (scene as any).toolChangedHandler({ tool: 'place-track' });

    expect(place.activate).toHaveBeenCalledTimes(1);
    expect((scene as any).activeEditorTool).toBe(place);
    expect((scene as any).cameraController.setInputLockOwner)
      .toHaveBeenCalledWith('editor-tool');
    expect(facility.setSelected).toHaveBeenCalledWith(false);
    expect(facility.setSelectionEnabled).toHaveBeenCalledWith(false);
    expect((scene as any).selectedFacilityId).toBeNull();
  });

  it.each([
    ['KeyD', 'Connect unavailable — route completion needs one atomic quote.'],
    ['KeyJ', 'Junction unavailable — track splitting needs one atomic quote.'],
    ['KeyG', 'Generate unavailable — multi-track construction needs one atomic quote.'],
    ['KeyX', 'Erase unavailable — select tracks to review the exact refund.'],
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

  it('ignores held Delete repeats but preserves two deliberate refund review presses', () => {
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

    (scene as any).handleKeyDown({
      code: 'Delete',
      ctrlKey: false,
      altKey: false,
      repeat: false,
    });
    (scene as any).handleKeyDown({
      code: 'Delete',
      ctrlKey: false,
      altKey: false,
      repeat: true,
    });
    (scene as any).handleKeyDown({
      code: 'Delete',
      ctrlKey: false,
      altKey: false,
      repeat: false,
    });

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

  it('ignores gameplay shortcuts originating inside the facility inspector', () => {
    const scene = new WorldScene();
    const onKeyDown = jest.fn();
    (scene as any).activeEditorTool = { onKeyDown };
    GameStateManager.enterCreate('test-world');
    const inspector = document.createElement('section');
    inspector.dataset.testid = 'facility-inspector';
    const child = document.createElement('span');
    inspector.append(child);

    (scene as any).handleKeyDown({
      code: 'KeyP',
      ctrlKey: false,
      altKey: false,
      target: child,
    });

    expect(onKeyDown).not.toHaveBeenCalled();
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

  it('persists every successful push, undo, and redo without syncing trains', () => {
    const scene = new WorldScene();
    WorldManager.createNew('HUD authority', 'quote-seed');
    const commandStack = new CommandStack();
    const command = {
      description: 'Persistence fixture',
      execute: jest.fn().mockReturnValue(true),
      undo: jest.fn().mockReturnValue(true),
    };
    (scene as any).commandStack = commandStack;
    (scene as any).selectionManager = { selectedUUIDs: [] };
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    const setTrainDefs = jest.spyOn(WorldManager, 'setTrainDefs');
    const emit = jest.spyOn(EventBus, 'emit');
    (scene as any).bindCommandStackReporting();

    expect(commandStack.push(command)).toBe(true);
    expect(commandStack.undo()).toBe(true);
    expect(commandStack.redo()).toBe(true);

    expect(save).toHaveBeenCalledTimes(3);
    expect(setTrainDefs).not.toHaveBeenCalled();
    expect(emit.mock.calls.filter(
      ([event]) => event === 'ui:toolbar-save-state',
    )).toEqual([
      ['ui:toolbar-save-state', { state: 'saving' }],
      ['ui:toolbar-save-state', { state: 'saved' }],
      ['ui:toolbar-save-state', { state: 'saving' }],
      ['ui:toolbar-save-state', { state: 'saved' }],
      ['ui:toolbar-save-state', { state: 'saving' }],
      ['ui:toolbar-save-state', { state: 'saved' }],
    ]);
    expect(emit).toHaveBeenCalledWith('ui:company-state', {
      cash: WorldManager.world!.company.cash,
      saveState: 'saving',
      economyTick: WorldManager.world!.economy.tick,
      constructionIndexBps:
        WorldManager.world!.economy.market.constructionIndexBps,
    });
    expect(emit).toHaveBeenCalledWith('ui:company-state', {
      cash: WorldManager.world!.company.cash,
      saveState: 'saved',
      economyTick: WorldManager.world!.economy.tick,
      constructionIndexBps:
        WorldManager.world!.economy.market.constructionIndexBps,
    });

    emit.mockRestore();
    setTrainDefs.mockRestore();
    save.mockRestore();
    WorldManager.reset();
  });

  it('preserves the live command result and exact prior snapshot when immediate persistence fails', () => {
    const scene = new WorldScene();
    const world = WorldManager.createNew('Failure authority', 'failure-seed');
    const priorRaw = localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY);
    const priorStored = SaveService.loadWorld(world.id);
    const transaction = applyConstructionTransaction(world.company, {
      kind: 'purchase',
      magnitude: 2_800,
      referenceId: 'test-live-command',
      direction: 'forward',
    }, world.economy.tick);
    if (transaction.ok === false) throw new Error(transaction.code);
    world.company = transaction.company;
    world.revision += 1;
    world.constructionRevision += 1;
    const liveAfterCommand = JSON.parse(JSON.stringify(world));
    (scene as any).commandStack = {};
    (scene as any).selectionManager = { selectedUUIDs: [] };
    const write = jest.spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new Error('quota'); });
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    const emit = jest.spyOn(EventBus, 'emit');
    (scene as any).bindCommandStackReporting();

    (scene as any).commandStack.onChange(true, false);

    expect(WorldManager.world).toEqual(liveAfterCommand);
    expect(WorldManager.world?.revision).toBe(liveAfterCommand.revision);
    expect(WorldManager.world?.company.cash).toBe(liveAfterCommand.company.cash);
    expect(localStorage.getItem(GameConfig.WORLD.WORLDS_SAVE_KEY)).toBe(priorRaw);
    expect(SaveService.loadWorld(world.id)).toEqual(priorStored);
    expect(emit).toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'saving' },
    );
    expect(emit).toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'unsaved' },
    );
    expect(emit).not.toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'saved' },
    );
    expect(emit.mock.calls.some(([event]) => event === 'world:saved')).toBe(false);
    expect(emit).toHaveBeenCalledWith('ui:toast', {
      message: 'Could not save the world. Retry Save is available.',
      type: 'error',
    });

    emit.mockRestore();
    warning.mockRestore();
    write.mockRestore();
    WorldManager.reset();
    localStorage.clear();
  });

  it('uses pure persistence for Retry Save and Ctrl+S without changing revision or cash', () => {
    const scene = new WorldScene();
    const world = WorldManager.createNew('Manual save', 'real-terrain-alpha');
    const revision = world.revision;
    const cash = world.company.cash;
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    const setTrainDefs = jest.spyOn(WorldManager, 'setTrainDefs');
    const emit = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterCreate(world.id);

    (scene as any).saveHandler();
    (scene as any).handleKeyDown({
      code: 'KeyS',
      ctrlKey: true,
      altKey: false,
      repeat: false,
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(setTrainDefs).not.toHaveBeenCalled();
    expect(world.revision).toBe(revision);
    expect(world.company.cash).toBe(cash);
    expect(emit.mock.calls.filter(
      ([event]) => event === 'ui:toolbar-save-state',
    )).toEqual([
      ['ui:toolbar-save-state', { state: 'saving' }],
      ['ui:toolbar-save-state', { state: 'saved' }],
      ['ui:toolbar-save-state', { state: 'saving' }],
      ['ui:toolbar-save-state', { state: 'saved' }],
    ]);

    emit.mockRestore();
    setTrainDefs.mockRestore();
    save.mockRestore();
    WorldManager.reset();
  });

  it('skips the periodic safety save while already saved but retries when unsaved', () => {
    const scene = new WorldScene();
    WorldManager.createNew('Periodic save', 'periodic-seed');
    (scene as any).trainManager = { trains: [], carriages: [] };
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    const setTrainDefs = jest.spyOn(WorldManager, 'setTrainDefs');
    const emit = jest.spyOn(EventBus, 'emit');

    (scene as any).lastReportedSaveState = 'saved';
    (scene as any).runPeriodicSafetySave();
    expect(save).not.toHaveBeenCalled();
    expect(setTrainDefs).not.toHaveBeenCalled();
    expect(emit.mock.calls.some(([event]) => event === 'ui:toast')).toBe(false);

    (scene as any).lastReportedSaveState = 'unsaved';
    (scene as any).runPeriodicSafetySave();
    expect(save).toHaveBeenCalledTimes(1);
    expect(setTrainDefs).toHaveBeenCalledWith([]);

    emit.mockRestore();
    setTrainDefs.mockRestore();
    save.mockRestore();
    WorldManager.reset();
  });

  it('ticks the generated economy only while play mode is operating', () => {
    const scene = new WorldScene() as any;
    const world = WorldManager.createNew(
      'World-loop economy',
      'world-loop-economy',
    );
    prepareWorldLoop(scene);
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);

    GameStateManager.enterCreate(world.id);
    scene.update(0, 4_000);
    expect(world.economy.tick).toBe(0);

    GameStateManager.enterPlay(world.id);
    scene.update(4_000, 250);
    scene.update(4_250, 250);
    scene.update(4_500, 250);
    scene.update(4_750, 250);
    expect(world.economy.tick).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);

    scene.scene.isPaused.mockReturnValue(true);
    scene.update(5_000, 4_000);
    expect(world.economy.tick).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);

    scene.scene.isPaused.mockReturnValue(false);
    GameStateManager.pause();
    scene.update(9_000, 4_000);
    expect(world.economy.tick).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('syncs live train positions into the same successful Operate tick save', () => {
    const scene = new WorldScene() as any;
    const world = WorldManager.createNew(
      'Truthful economy save',
      'truthful-economy-save',
    );
    world.trains = [{
      id: 'live-train',
      passengers: 3,
      type: 'locomotive',
      dynamics: {
        mode: 'on-rail',
        trackUUID: 'track-live',
        distance: 100,
        direction: 1,
        speedMps: 4,
        consistId: 'consist-live',
        consistOrder: 0,
      },
    }];
    const liveTrack = {
      getUUID: jest.fn().mockReturnValue('track-live'),
      getTrackPosition: jest.fn().mockReturnValue(0.75),
    };
    const liveTrain = {
      currentTrack: liveTrack,
      persistedDynamics: {
        mode: 'on-rail',
        trackUUID: 'track-live',
        distance: 750,
        direction: 1,
        speedMps: 8,
        consistId: 'consist-live',
        consistOrder: 0,
      },
      getUUID: jest.fn().mockReturnValue('live-train'),
      getMatterBody: jest.fn().mockReturnValue({ x: 750, y: 20 }),
      getPassengerCount: jest.fn().mockReturnValue(7),
      vehicleType: 'locomotive',
    };
    prepareWorldLoop(scene);
    scene.trainManager = {
      selectedTrain: liveTrain,
      trains: [liveTrain],
      carriages: [],
      update: jest.fn(),
    };
    let trainAtSave: typeof world.trains[number] | undefined;
    const save = jest.spyOn(WorldManager, 'save').mockImplementation(() => {
      trainAtSave = WorldManager.world?.trains[0];
      return true;
    });
    const emit = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterPlay(world.id);

    scene.update(0, 1_000);

    expect(world.economy.tick).toBe(1);
    expect(world.trains).toEqual([{
      id: 'live-train',
      passengers: 7,
      type: 'locomotive',
      dynamics: {
        mode: 'on-rail',
        trackUUID: 'track-live',
        distance: 750,
        direction: 1,
        speedMps: 8,
        consistId: 'consist-live',
        consistOrder: 0,
      },
    }]);
    expect(trainAtSave).toEqual(world.trains[0]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'saved' },
    );
  });

  it('reports a failed economy save and retries through the next changed batch', () => {
    const scene = new WorldScene() as any;
    const world = WorldManager.createNew(
      'Economy retry',
      'world-loop-economy-retry',
    );
    prepareWorldLoop(scene);
    const save = jest.spyOn(WorldManager, 'save')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const emit = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterPlay(world.id);

    scene.update(0, 1_000);

    expect(world.economy.tick).toBe(1);
    expect(emit).toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'unsaved' },
    );
    expect(emit.mock.calls.some(([event]) => event === 'ui:toast'))
      .toBe(false);

    scene.update(1_000, 1_000);

    expect(world.economy.tick).toBe(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'saved' },
    );
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
      expectedConstructionRevision:
        WorldManager.world!.constructionRevision + 1,
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
      expectedConstructionRevision: world.constructionRevision,
    });

    expect(push).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Delete track(s)',
    }));
    expect(clearSelection).toHaveBeenCalledTimes(1);
    WorldManager.reset();
  });

  it('keeps deletion confirmation current across economy-only revisions and rejects construction changes', () => {
    const scene = new WorldScene();
    const world = WorldManager.createNew('Delete cursor', 'quote-seed');
    const paidTrack = {
      uuid: 'paid-track',
      geometryVersion: 1 as const,
      p0: { x: 0, y: 0 },
      p1: { x: 100, y: 0 },
      p2: { x: 200, y: 0 },
      p3: { x: 300, y: 0 },
      verticalProfile: {
        profileVersion: 1 as const,
        knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 0 }],
      },
      structures: [{
        type: 'surface' as const,
        startT: 0,
        endT: 1,
        startElevation: 0,
        endElevation: 0,
      }],
      paidBuildCost: 101,
    };
    world.tracks.push(paidTrack);
    const constructionCursor = world.constructionRevision;
    expect(WorldManager.applyEconomyBatch(world.economyRevision, (economy) => {
      economy.tick += 1;
      return true;
    })).toBe(true);
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
    const intent = {
      uuids: ['paid-track'],
      expectedRefund: 50,
      expectedConstructionRevision: constructionCursor,
    };

    (scene as any).editorDeleteHandler(intent);

    expect(push).toHaveBeenCalledTimes(1);
    expect(clearSelection).toHaveBeenCalledTimes(1);

    expect(WorldManager.applyConstructionBatch(
      constructionCursor,
      (draft) => draft.addTrack({
        ...paidTrack,
        uuid: 'external-construction',
      }),
    )).toBe(true);
    (scene as any).editorDeleteHandler(intent);

    expect(push).toHaveBeenCalledTimes(1);
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
      expectedConstructionRevision: world.constructionRevision,
      available: false,
      blockingReason: expect.stringContaining('Remove stations'),
    });

    (scene as any).editorDeleteHandler({
      uuids: ['paid-track'],
      expectedRefund: 50,
      expectedConstructionRevision: world.constructionRevision,
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
      {
        cash: expect.any(Number),
        saveState: 'unsaved',
        economyTick: expect.any(Number),
        constructionIndexBps: expect.any(Number),
      },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      {
        message: 'Could not save the world. Retry Save is available.',
        type: 'error',
      },
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
      {
        message: 'Could not save the world. Retry Save is available.',
        type: 'error',
      },
    );

    emitSpy.mockRestore();
    saveSpy.mockRestore();
  });

  it('launches create UI after a successful initial save with completed state', () => {
    const { save, launch } = createStartupScene('create', true);
    const editorLaunchIndex = launch.mock.calls
      .findIndex(([key]) => key === 'EditorUIScene');
    const editorLaunch = launch.mock.calls[editorLaunchIndex];
    const launchData = editorLaunch?.[1];

    expect(launchData?.visible).toBe(true);
    expect(launchData?.companyCash).toBe(WorldManager.world?.company.cash);
    expect(launchData?.saveState).toBe('saved');
    expect(launchData?.saveErrorMessage).toBeUndefined();
    expect(save.mock.invocationCallOrder[0])
      .toBeLessThan(launch.mock.invocationCallOrder[editorLaunchIndex]);
  });

  it('hands a failed initial save to create UI once and clears the pending message', () => {
    const { scene, launch } = createStartupScene('create', false);
    const editorLaunch = launch.mock.calls.find(([key]) => key === 'EditorUIScene');
    const launchData = editorLaunch?.[1];

    expect(launchData?.visible).toBe(true);
    expect(launchData?.companyCash).toBe(WorldManager.world?.company.cash);
    expect(launchData?.saveState).toBe('unsaved');
    expect(launchData?.saveErrorMessage)
      .toBe('Could not save the world. Retry Save is available.');
    expect((scene as any).pendingStartupSaveError).toBeNull();
  });

  it('keeps play startup hidden without running a create-mode save', () => {
    const { save, launch } = createStartupScene('play', true);
    const editorLaunch = launch.mock.calls.find(([key]) => key === 'EditorUIScene');
    const launchData = editorLaunch?.[1];

    expect(save).not.toHaveBeenCalled();
    expect(launchData?.visible).toBe(false);
    expect(launchData?.companyCash).toBe(WorldManager.world?.company.cash);
    expect(launchData?.saveState).toBe('saved');
    expect(launchData?.saveErrorMessage).toBeUndefined();
  });
});
