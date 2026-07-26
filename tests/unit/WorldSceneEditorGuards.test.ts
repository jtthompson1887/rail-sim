import WorldScene from '../../src/scenes/WorldScene';
import { GameStateManager } from '../../src/managers/GameStateManager';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';
import { CommandStack } from '../../src/systems/CommandStack';
import { SaveService } from '../../src/services/SaveService';
import { GameConfig } from '../../src/config/GameConfig';
import { createCompanyState } from '../../src/economy/FinanceLedger';
import { applyConstructionTransaction } from '../../src/systems/ConstructionEconomy';
import type { FreightPurchaseQuote } from '../../src/freight/FreightPurchaseService';
import { TrainManager } from '../../src/managers/TrainManager';
import { clonePlainData } from '../../src/utils/PlainData';
import {
  makeFirstFreightRouteWorld,
  makeFreightTrainDef,
} from '../fixtures/FirstFreightRouteFixture';

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

  function installFirstRouteWorld(): ReturnType<
    typeof WorldManager.createNew
  > {
    const world = WorldManager.createNew(
      'Scene freight operations',
      'scene-freight-operations',
    );
    const fixture = makeFirstFreightRouteWorld();
    world.tracks = clonePlainData(fixture.tracks);
    world.economy = clonePlainData(fixture.economy);
    world.trains = clonePlainData(fixture.trains);
    world.firstRouteProgress = clonePlainData(fixture.firstRouteProgress);
    return world;
  }

  function makeLiveFreightTrain(
    trainId: string,
    enginePower = 0,
  ): any {
    const body = {
      x: 0,
      y: 0,
      rotation: 0,
      body: { velocity: { x: 0, y: 0 } },
    };
    return {
      currentTrack: {
        getUUID: () => 'forest-sawmill-track',
        getTrackPosition: () => 0.5,
        getCurvePath: () => ({
          getTangent: () => ({ x: 1, y: 0 }),
        }),
      },
      derailed: false,
      enginePower,
      body,
      getUUID: () => trainId,
      getMatterBody: jest.fn(() => body),
    };
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

  it('uses the shared focus gate for shortcuts inside every freight panel', () => {
    const scene = new WorldScene();
    const onKeyDown = jest.fn();
    (scene as any).activeEditorTool = { onKeyDown };
    GameStateManager.enterCreate('test-world');

    for (const testId of [
      'vehicle-purchase-panel',
      'train-inspector',
      'first-route-objective',
    ]) {
      const panel = document.createElement('section');
      panel.dataset.testid = testId;
      const child = document.createElement('span');
      panel.append(child);
      (scene as any).handleKeyDown({
        code: 'KeyP',
        ctrlKey: false,
        altKey: false,
        target: child,
      });
    }

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
    const emit = jest.spyOn(EventBus, 'emit');
    (scene as any).bindCommandStackReporting();

    expect(commandStack.push(command)).toBe(true);
    expect(commandStack.undo()).toBe(true);
    expect(commandStack.redo()).toBe(true);

    expect(save).toHaveBeenCalledTimes(3);
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
      operatingSummary: {
        fromTick: 0,
        throughTick: 0,
        deliveryRevenue: 0,
        runningExpenses: 0,
        operatingProfit: 0,
        capitalExpenditure: 0,
        cashFlow: WorldManager.world!.company.cash,
      },
    });
    expect(emit).toHaveBeenCalledWith('ui:company-state', {
      cash: WorldManager.world!.company.cash,
      saveState: 'saved',
      economyTick: WorldManager.world!.economy.tick,
      constructionIndexBps:
        WorldManager.world!.economy.market.constructionIndexBps,
      operatingSummary: {
        fromTick: 0,
        throughTick: 0,
        deliveryRevenue: 0,
        runningExpenses: 0,
        operatingProfit: 0,
        capitalExpenditure: 0,
        cashFlow: WorldManager.world!.company.cash,
      },
    });

    emit.mockRestore();
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
    save.mockRestore();
    WorldManager.reset();
  });

  it('skips the periodic safety save while already saved but retries when unsaved', () => {
    const scene = new WorldScene();
    WorldManager.createNew('Periodic save', 'periodic-seed');
    (scene as any).trainManager = { trains: [], carriages: [] };
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    const emit = jest.spyOn(EventBus, 'emit');

    (scene as any).lastReportedSaveState = 'saved';
    (scene as any).runPeriodicSafetySave();
    expect(save).not.toHaveBeenCalled();
    expect(emit.mock.calls.some(([event]) => event === 'ui:toast')).toBe(false);

    (scene as any).lastReportedSaveState = 'unsaved';
    (scene as any).runPeriodicSafetySave();
    expect(save).toHaveBeenCalledTimes(1);

    emit.mockRestore();
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

  it('locks an insolvent train before same-frame input and unlocks the complete set only after an affordable committed tick', () => {
    const scene = new WorldScene() as any;
    const world = installFirstRouteWorld();
    world.company = createCompanyState(10);
    const trainId = world.trains[0].id;
    const liveTrain = makeLiveFreightTrain(trainId, 1);
    const stopFreightTrains = jest.fn((trainIds: readonly string[]) => {
      if (trainIds.indexOf(trainId) !== -1) liveTrain.enginePower = 0;
    });
    const handleTrainMovement = jest.fn((
      selectedTrain: typeof liveTrain,
      lockedTrainIds: ReadonlySet<string>,
    ) => {
      selectedTrain.enginePower = lockedTrainIds.has(trainId) ? 0 : 1;
    });
    prepareWorldLoop(scene);
    scene.trainManager = {
      selectedTrain: liveTrain,
      trains: [liveTrain],
      carriages: [],
      stopFreightTrains,
      update: jest.fn(),
    };
    scene.inputManager = { handleTrainMovement };
    jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    GameStateManager.enterPlay(world.id);

    scene.update(0, 1_000);

    expect(liveTrain.enginePower).toBe(0);
    expect(Array.from(scene.operationsLockedTrainIds)).toEqual([trainId]);
    expect(stopFreightTrains).toHaveBeenCalledWith([trainId]);
    expect(stopFreightTrains.mock.invocationCallOrder[0])
      .toBeLessThan(handleTrainMovement.mock.invocationCallOrder[0]);
    expect(handleTrainMovement.mock.calls[0][1]).toEqual(new Set([trainId]));
    expect(scene.cargoStatusByTrainId.get(trainId).blocker)
      .toBe('Insufficient cash for running costs');

    scene.update(1_000, 1_000);

    expect(liveTrain.enginePower).toBe(0);
    expect(Array.from(scene.operationsLockedTrainIds)).toEqual([trainId]);
    expect(handleTrainMovement.mock.calls[1][1]).toEqual(new Set([trainId]));
    expect(scene.cargoStatusByTrainId.get(trainId).blocker)
      .toBe('Insufficient cash for running costs');

    world.company = createCompanyState(100);
    scene.update(2_000, 1_000);

    expect(scene.operationsLockedTrainIds.size).toBe(0);
    expect(handleTrainMovement.mock.calls[2][1]).toEqual(new Set());
    expect(liveTrain.enginePower).toBe(1);
    expect(scene.cargoStatusByTrainId.get(trainId).blocker)
      .not.toBe('Insufficient cash for running costs');
  });

  it('refreshes once after catch-up, clears construction history once, and emits every delivery presentation event', () => {
    const scene = new WorldScene() as any;
    const world = installFirstRouteWorld();
    world.trains[0].cargo = {
      productId: 'logs',
      units: 10,
      originFacilityId: 'managed-forest',
    };
    const trainId = world.trains[0].id;
    const liveTrain = makeLiveFreightTrain(trainId);
    liveTrain.currentTrack.getTrackPosition = () => 0.9;
    liveTrain.body.x = 500;
    prepareWorldLoop(scene);
    scene.trainManager = {
      selectedTrain: liveTrain,
      trains: [liveTrain],
      carriages: [],
      stopFreightTrains: jest.fn(),
      update: jest.fn(),
    };
    scene.commandStack = {
      onChange: jest.fn(),
      clear: jest.fn(),
    };
    scene.refreshFacilityPresentation = jest.fn();
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    const emit = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterPlay(world.id);

    scene.update(0, 4_000);

    expect(world.economy.tick).toBe(4);
    expect(liveTrain.getMatterBody).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(scene.refreshFacilityPresentation).toHaveBeenCalledTimes(1);
    expect(scene.commandStack.clear).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('ui:toolbar-undo-state', {
      canUndo: false,
      canRedo: false,
    });
    expect(emit).toHaveBeenCalledWith(
      'ui:toast',
      expect.objectContaining({ type: 'success' }),
    );
    expect(emit).toHaveBeenCalledWith(
      'ui:cash-pulse',
      expect.objectContaining({ amount: expect.any(Number) }),
    );
    expect(emit).toHaveBeenCalledWith(
      'ui:freight-delivery-completed',
      expect.objectContaining({
        trainId,
        destinationFacilityId: 'sawmill',
      }),
    );

    scene.update(4_000, 1_000);

    expect(scene.commandStack.clear).toHaveBeenCalledTimes(1);
  });

  it('recreates the scene without replaying the achieved objective celebration in this page session', () => {
    const world = installFirstRouteWorld();
    world.firstRouteProgress.profitableDeliveryCompleted = true;
    const topology = [{
      kind: 'track' as const,
      uuid: 'forest-sawmill-track',
      previous: null,
      next: null,
    }];
    const firstScene = new WorldScene() as any;
    const reloadedScene = new WorldScene() as any;
    firstScene.trackManager = {
      captureTopology: jest.fn().mockReturnValue(topology),
    };
    reloadedScene.trackManager = {
      captureTopology: jest.fn().mockReturnValue(topology),
    };
    firstScene.trainManager = { selectedTrain: null };
    reloadedScene.trainManager = { selectedTrain: null };
    const emit = jest.spyOn(EventBus, 'emit');

    firstScene.publishFreightPresentation([]);
    reloadedScene.publishFreightPresentation([]);

    expect(emit.mock.calls.filter(
      ([event]) => event === 'ui:first-route-objective',
    )).toHaveLength(2);
    expect(emit.mock.calls.filter(
      ([event, payload]) => event === 'ui:toast'
        && (payload as any).message === 'First freight route complete',
    )).toHaveLength(1);
  });

  it('retains the committed authority after localStorage failure and retries the exact world without rerunning operations', () => {
    const scene = new WorldScene() as any;
    const world = installFirstRouteWorld();
    const liveTrain = makeLiveFreightTrain(world.trains[0].id);
    prepareWorldLoop(scene);
    scene.trainManager = {
      selectedTrain: liveTrain,
      trains: [liveTrain],
      carriages: [],
      stopFreightTrains: jest.fn(),
      update: jest.fn(),
    };
    const saveWorld = jest.spyOn(SaveService, 'saveWorld');
    const write = jest.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('quota');
      });
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    GameStateManager.enterPlay(world.id);

    scene.update(0, 5_000);

    const committed = clonePlainData(world);
    const committedLedgerLength = world.company.ledger.length;
    const committedOperationsRevision = world.operationsRevision;
    expect(world.economy.tick).toBe(4);
    expect(scene.lastReportedSaveState).toBe('unsaved');
    expect(saveWorld).toHaveBeenCalledTimes(1);

    scene.runPeriodicSafetySave();

    expect(saveWorld).toHaveBeenCalledTimes(2);
    expect(liveTrain.getMatterBody).toHaveBeenCalledTimes(1);
    expect(world.economy.tick).toBe(committed.economy.tick);
    expect(world.economy.facilities).toEqual(committed.economy.facilities);
    expect(world.trains).toEqual(committed.trains);
    expect(world.company.cash).toBe(committed.company.cash);
    expect(world.company.ledger).toEqual(committed.company.ledger);
    expect(world.firstRouteProgress).toEqual(committed.firstRouteProgress);
    expect(world.revision).toBe(committed.revision);
    expect(world.operationsRevision).toBe(committedOperationsRevision);
    expect(world.company.ledger).toHaveLength(committedLedgerLength);
    expect(SaveService.loadWorld(world.id)).toMatchObject({
      revision: committed.revision,
      operationsRevision: committed.operationsRevision,
      company: committed.company,
      economy: committed.economy,
      trains: committed.trains,
      firstRouteProgress: committed.firstRouteProgress,
    });

    warning.mockRestore();
    write.mockRestore();
  });

  it('does not save or expose rejected operation proposals and requests a retry', () => {
    const scene = new WorldScene() as any;
    const world = installFirstRouteWorld();
    prepareWorldLoop(scene);
    scene.economySystem = {
      update: jest.fn().mockReturnValue({
        ticksAdvanced: 0,
        changedFacilityIds: [],
        cargoStatuses: [],
        completedDeliveries: [],
        runningCostBlockerByTrainId: {},
        stopTrainIds: [],
        commitRejected: true,
        authoritativeChanged: false,
      }),
    };
    scene.refreshFacilityPresentation = jest.fn();
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    const emit = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterPlay(world.id);

    scene.update(0, 1_000);

    expect(save).not.toHaveBeenCalled();
    expect(scene.refreshFacilityPresentation).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('ui:toast', {
      message: 'Freight state changed · retry operation',
      type: 'info',
    });
  });

  it('reconciles rejected live runtime from newer authority before input and preserves it on retry', () => {
    const scene = new WorldScene() as any;
    const world = installFirstRouteWorld();
    const trainId = world.trains[0].id;
    world.tracks.push({
      ...clonePlainData(world.tracks[0]),
      uuid: 'newer-track',
    });
    const liveTrain = makeLiveFreightTrain(trainId, 1);
    const placeFreightTrain = jest.fn((
      train: typeof liveTrain,
      trackUUID: string,
      trackT: number,
      facing: 1 | -1,
    ) => {
      train.currentTrack = {
        getUUID: () => trackUUID,
        getTrackPosition: () => trackT,
        getCurvePath: () => ({
          getTangent: () => ({ x: 1, y: 0 }),
        }),
      };
      train.body.rotation = facing === -1 ? Math.PI : 0;
      train.enginePower = 0;
      train.body.body.velocity = { x: 0, y: 0 };
      return true;
    });
    const inputStates: Array<{
      trackUUID: string | undefined;
      trackT: number | null;
      enginePower: number;
    }> = [];
    const handleTrainMovement = jest.fn(() => {
      inputStates.push({
        trackUUID: liveTrain.currentTrack?.getUUID(),
        trackT: liveTrain.currentTrack?.getTrackPosition(),
        enginePower: liveTrain.enginePower,
      });
    });
    prepareWorldLoop(scene);
    scene.trainManager = {
      selectedTrain: liveTrain,
      trains: [liveTrain],
      carriages: [],
      placeFreightTrain,
      stopFreightTrains: jest.fn(),
      update: jest.fn(),
    };
    scene.inputManager = { handleTrainMovement };
    const applyAuthoritativeBatch =
      WorldManager.applyOperationsBatch.bind(WorldManager);
    jest.spyOn(WorldManager, 'applyOperationsBatch')
      .mockImplementationOnce(() => applyAuthoritativeBatch(
        world.revision,
        (draft) => {
          draft.trains[0].trackUUID = 'newer-track';
          draft.trains[0].trackT = 0.8;
          draft.trains[0].facing = -1;
          return true;
        },
      ) && false);
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);
    const emit = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterPlay(world.id);

    scene.update(0, 1_000);

    expect(world.economy.tick).toBe(0);
    expect(world.trains[0]).toMatchObject({
      trackUUID: 'newer-track',
      trackT: 0.8,
      facing: -1,
    });
    expect(placeFreightTrain).toHaveBeenCalledWith(
      liveTrain,
      'newer-track',
      0.8,
      -1,
    );
    expect(placeFreightTrain.mock.invocationCallOrder[0])
      .toBeLessThan(handleTrainMovement.mock.invocationCallOrder[0]);
    expect(inputStates[0]).toEqual({
      trackUUID: 'newer-track',
      trackT: 0.8,
      enginePower: 0,
    });
    expect(save).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('ui:toast', {
      message: 'Freight state changed · retry operation',
      type: 'info',
    });
    expect(emit.mock.calls.some(([
      event,
      data,
    ]) => event === 'ui:cash-pulse'
      || (event === 'ui:toast'
        && (data as { type?: string }).type === 'success'))).toBe(false);

    scene.update(1_000, 0);

    expect(world.economy.tick).toBe(1);
    expect(world.trains[0]).toMatchObject({
      trackUUID: 'newer-track',
      trackT: 0.8,
      facing: -1,
    });
    expect(world.operationsRevision).toBe(2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('merges moved runtime while retaining detached derailed authority before save', () => {
    const scene = new WorldScene() as any;
    const world = WorldManager.createNew(
      'Truthful economy save',
      'truthful-economy-save',
    );
    world.tracks = makeFirstFreightRouteWorld().tracks;
    const authoritativeTrain = makeFreightTrainDef({
      id: 'moving-train',
      trackT: 0.1,
      cargo: {
        productId: 'logs',
        units: 11,
        originFacilityId: 'managed-forest',
      },
      operations: {
        currentTripRevenue: 1,
        currentTripRunningCost: 2,
        lastTripRevenue: 3,
        lastTripRunningCost: 4,
        lifetimeDeliveredUnits: 5,
        lifetimeRevenue: 6,
        lifetimeRunningCost: 7,
      },
    });
    const derailedAuthoritative = makeFreightTrainDef({
      id: 'derailed-train',
      trackT: 0.4,
      cargo: {
        productId: 'logs',
        units: 8,
        originFacilityId: 'managed-forest',
      },
    });
    world.trains = [authoritativeTrain, derailedAuthoritative];
    const liveTrack = {
      getUUID: jest.fn().mockReturnValue('forest-sawmill-track'),
      getTrackPosition: jest.fn().mockReturnValue(0.75),
      getCurvePath: jest.fn().mockReturnValue({
        getTangent: jest.fn().mockReturnValue({ x: 1, y: 0 }),
      }),
    };
    const liveTrain = {
      currentTrack: liveTrack,
      derailed: false,
      enginePower: -1,
      getUUID: jest.fn().mockReturnValue('moving-train'),
      getMatterBody: jest.fn().mockReturnValue({
        x: 750,
        y: 20,
        rotation: Math.PI,
        body: { velocity: { x: 0, y: 0 } },
      }),
    };
    const derailedTrain = {
      currentTrack: liveTrack,
      derailed: true,
      enginePower: 1,
      getUUID: jest.fn().mockReturnValue('derailed-train'),
      getMatterBody: jest.fn().mockReturnValue({
        x: 900,
        y: 40,
        rotation: 0,
        body: { velocity: { x: 2, y: 0 } },
      }),
    };
    prepareWorldLoop(scene);
    scene.trainManager = {
      selectedTrain: liveTrain,
      trains: [liveTrain, derailedTrain],
      carriages: [],
      update: jest.fn(),
    };
    const applyBatch = jest.spyOn(WorldManager, 'applyOperationsBatch');
    let trainsAtSave: typeof world.trains | undefined;
    const save = jest.spyOn(WorldManager, 'save').mockImplementation(() => {
      trainsAtSave = WorldManager.world?.trains;
      return true;
    });

    expect(scene.syncTrainLocationsAndSave()).toBe(true);

    expect(applyBatch).toHaveBeenCalledTimes(1);
    expect(world.trains).toEqual([
      {
        ...authoritativeTrain,
        trackUUID: 'forest-sawmill-track',
        trackT: 0.75,
        facing: -1,
      },
      derailedAuthoritative,
    ]);
    expect(world.trains[0]).not.toBe(authoritativeTrain);
    expect(world.trains[0].cargo).toEqual(authoritativeTrain.cargo);
    expect(world.trains[0].cargo).not.toBe(authoritativeTrain.cargo);
    expect(world.trains[0].operations).toEqual(authoritativeTrain.operations);
    expect(world.trains[0].operations).not.toBe(authoritativeTrain.operations);
    expect(world.trains[1]).not.toBe(derailedAuthoritative);
    expect(world.trains.every((train) => train !== null)).toBe(true);
    expect(trainsAtSave).toBe(world.trains);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves directly without committing when runtime locations are unchanged', () => {
    const scene = new WorldScene() as any;
    const world = WorldManager.createNew('No-op train save', 'no-op-save');
    world.tracks = makeFirstFreightRouteWorld().tracks;
    const authoritative = makeFreightTrainDef({
      id: 'stationary-train',
      trackT: 0.1,
      facing: 1,
    });
    world.trains = [authoritative];
    const revision = world.revision;
    scene.trainManager = {
      trains: [{
        currentTrack: {
          getUUID: () => authoritative.trackUUID,
          getTrackPosition: () => authoritative.trackT,
          getCurvePath: () => ({
            getTangent: () => ({ x: 1, y: 0 }),
          }),
        },
        derailed: false,
        enginePower: 0,
        getUUID: () => authoritative.id,
        getMatterBody: () => ({
          x: 0,
          y: 0,
          rotation: 0,
          body: { velocity: { x: 0, y: 0 } },
        }),
      }],
    };
    const applyBatch = jest.spyOn(WorldManager, 'applyOperationsBatch');
    const save = jest.spyOn(WorldManager, 'save').mockReturnValue(true);

    expect(scene.syncTrainLocationsAndSave()).toBe(true);

    expect(applyBatch).toHaveBeenCalledTimes(1);
    expect(world.revision).toBe(revision);
    expect(world.trains).toEqual([authoritative]);
    expect(save).toHaveBeenCalledTimes(1);
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
    expect(WorldManager.applyOperationsBatch(world.revision, (draft) => {
      draft.economy.tick += 1;
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
        operatingSummary: {
          fromTick: 0,
          throughTick: 0,
          deliveryRevenue: 0,
          runningExpenses: 0,
          operatingProfit: 0,
          capitalExpenditure: 0,
          cashFlow: 0,
        },
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

  it('routes the timber purchase-mode request to the authoritative placement tool', () => {
    const scene = new WorldScene() as any;
    const setFreightSetId = jest.fn();
    scene.toolRegistry = new Map([[
      'place-vehicle',
      { setFreightSetId },
    ]]);
    const emit = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterCreate('purchase-mode');

    scene.freightPurchaseModeRequestedHandler({
      freightSetId: 'timber-freight-set',
    });

    expect(setFreightSetId).toHaveBeenCalledWith('timber-freight-set');
    expect(emit).toHaveBeenCalledWith('ui:toolbar-select-tool', {
      tool: 'place-vehicle',
    });
  });

  it('clears stale construction UI/history and selects the committed train without a second save', () => {
    const scene = new WorldScene() as any;
    WorldManager.createNew('Committed purchase', 'committed-purchase');
    const quote: FreightPurchaseQuote = Object.freeze({
      expectedRevision: 0,
      freightSetId: 'timber-freight-set',
      trackUUID: 'forest-route',
      trackT: 0.1,
      facing: -1,
      purchasePrice: 90_000,
      cashAfter: 910_000,
      affordable: true,
      valid: true,
      blocker: null,
    });
    const purchasedTrain = { getUUID: () => 'purchased-train' };
    const purchase = jest.fn().mockReturnValue(Object.freeze({
      ok: true,
      trainId: 'purchased-train',
      saved: true,
      saveState: 'saved',
    }));
    scene.freightPurchaseService = { purchase };
    scene.commandStack = { clear: jest.fn() };
    scene.selectionManager = {
      clearSelection: jest.fn(),
      selectedUUIDs: ['stale-track'],
    };
    scene.trainManager = {
      trains: [purchasedTrain],
      selectTrain: jest.fn(),
    };
    scene.selectedFacilityId = 'sawmill';
    scene.facilityViews = [{
      facilityId: 'sawmill',
      setSelected: jest.fn(),
    }];
    const save = jest.spyOn(WorldManager, 'save');
    const emit = jest.spyOn(EventBus, 'emit');
    GameStateManager.enterCreate('committed-purchase');

    scene.freightPurchaseConfirmedHandler({ quote });

    expect(purchase).toHaveBeenCalledTimes(1);
    const confirmedQuote = purchase.mock.calls[0][0];
    expect(confirmedQuote).toBe(quote);
    expect(Object.isFrozen(confirmedQuote)).toBe(true);
    expect(scene.commandStack.clear).toHaveBeenCalledTimes(1);
    expect(scene.selectionManager.clearSelection).toHaveBeenCalledTimes(1);
    expect(scene.trainManager.selectTrain).toHaveBeenCalledWith(
      purchasedTrain,
    );
    expect(scene.facilityViews[0].setSelected).toHaveBeenCalledWith(false);
    expect(scene.selectedFacilityId).toBeNull();
    expect(emit).toHaveBeenCalledWith('ui:toolbar-undo-state', {
      canUndo: false,
      canRedo: false,
    });
    expect(emit).toHaveBeenCalledWith('facility:deselected', {
      facilityId: 'sawmill',
    });
    const resultCall = emit.mock.calls.find(
      ([event]) => event === 'freight:purchase-result',
    );
    expect(resultCall?.[1]).toEqual({
      ok: true,
      trainId: 'purchased-train',
      saved: true,
      saveState: 'saved',
    });
    expect(Object.isFrozen(resultCall?.[1])).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('does not clear history or selection when purchase precommit fails', () => {
    const scene = new WorldScene() as any;
    const quote = Object.freeze({
      expectedRevision: 0,
      freightSetId: 'timber-freight-set' as const,
      trackUUID: 'forest-route',
      trackT: 0.1,
      facing: 1 as const,
      purchasePrice: 90_000 as const,
      cashAfter: 910_000,
      affordable: true,
      valid: true,
      blocker: null,
    });
    scene.freightPurchaseService = {
      purchase: jest.fn().mockReturnValue({
        ok: false,
        blocker: 'live-placement-failed',
      }),
    };
    scene.commandStack = { clear: jest.fn() };
    scene.selectionManager = { clearSelection: jest.fn() };
    scene.trainManager = { trains: [], selectTrain: jest.fn() };
    const emit = jest.spyOn(EventBus, 'emit');

    scene.freightPurchaseConfirmedHandler({ quote });

    expect(scene.commandStack.clear).not.toHaveBeenCalled();
    expect(scene.selectionManager.clearSelection).not.toHaveBeenCalled();
    expect(scene.trainManager.selectTrain).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'freight:purchase-result',
      Object.freeze({
        ok: false,
        blocker: 'live-placement-failed',
      }),
    );
  });

  it('adapts TrainManager spawn/place/remove while preserving quote facing', () => {
    const scene = new WorldScene() as any;
    const train = { getUUID: () => 'runtime-train' };
    scene.trainManager = {
      createFreightTrain: jest.fn().mockReturnValue(train),
      placeFreightTrain: jest.fn().mockReturnValue(true),
      removeFreightTrain: jest.fn().mockReturnValue(true),
    };

    const runtime = scene.createFreightPurchaseRuntimePort();

    expect(runtime.spawn(
      'runtime-train',
      'timber-freight-set',
    )).toBe(train);
    expect(runtime.place(
      train,
      'forest-route',
      0.125,
      -1,
    )).toBe(true);
    runtime.remove('runtime-train');
    expect(scene.trainManager.placeFreightTrain).toHaveBeenCalledWith(
      train,
      'forest-route',
      0.125,
      -1,
    );
    expect(scene.trainManager.removeFreightTrain)
      .toHaveBeenCalledWith('runtime-train');
  });

  it('places a provisional freight train on the selected track with exact facing', () => {
    const { makeScene } = require('../../__mocks__/phaser');
    const liveTrack = {
      getCurvePath: jest.fn().mockReturnValue({
        getPoint: jest.fn().mockReturnValue({ x: 125, y: 250 }),
      }),
      getTrackAngle: jest.fn().mockReturnValue(35),
    };
    const trackManager = {
      getTrack: jest.fn().mockReturnValue(liveTrack),
    };
    const manager = new TrainManager(
      makeScene(),
      trackManager as any,
      {} as any,
    );
    const train = manager.createFreightTrain(
      'placed-train',
      'timber-freight-set',
    );
    const body = train.getMatterBody();
    const setPosition = jest.spyOn(body, 'setPosition');
    const setAngle = jest.spyOn(body, 'setAngle');
    const setVelocity = jest.spyOn(body, 'setVelocity');
    const setAngularVelocity = jest.spyOn(body, 'setAngularVelocity');

    expect(manager.placeFreightTrain(
      train,
      'forest-route',
      0.125,
      -1,
    )).toBe(true);

    expect(trackManager.getTrack).toHaveBeenCalledWith('forest-route');
    expect(setPosition).toHaveBeenCalledWith(125, 250);
    expect(setAngle).toHaveBeenCalledWith(215);
    expect(setVelocity).toHaveBeenCalledWith(0, 0);
    expect(setAngularVelocity).toHaveBeenCalledWith(0);
    expect(train.currentTrack).toBe(liveTrack);
    expect(train.enginePower).toBe(0);
  });
});
