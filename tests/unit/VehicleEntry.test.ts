import WorldScene from '../../src/scenes/WorldScene';
import { GameStateManager } from '../../src/managers/GameStateManager';
import { WorldManager } from '../../src/managers/WorldManager';
import { EditorToolbar } from '../../src/ui/EditorToolbar';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');
afterEach(() => { jest.restoreAllMocks();WorldManager.reset(); });

it.each(['button', 'shortcut'])('opens regional Fleet through the %s, cancelling construction and clearing the toolbar', (entry) => {
  const scene = new WorldScene() as any;
  const previous = { cancel: jest.fn(), deactivate: jest.fn() };
  const legacy = { activate: jest.fn() };
  scene.toolRegistry = new Map([['place-vehicle', legacy]]);
  scene.activeTool = 'place-track';scene.activeEditorTool = previous;
  scene.cameraController = { setCursor: jest.fn(), setInputLockOwner: jest.fn() };
  scene.railway = { active: true, showFleet: jest.fn() };
  const toolbar = new EditorToolbar(makeScene());
  const select = ({tool}: {tool: string}) => toolbar.selectTool(tool as any);
  EventBus.on('tool:changed', scene.toolChangedHandler);
  EventBus.on('ui:toolbar-select-tool', select);
  GameStateManager.enterCreate('fleet-routing');
  try {
    if (entry === 'button') toolbar.selectTool('place-vehicle');
    else scene.handleKeyDown(new KeyboardEvent('keydown', {code:'KeyN'}));
    expect(previous.cancel).toHaveBeenCalledTimes(1);expect(previous.deactivate).toHaveBeenCalledTimes(1);
    expect(scene.railway.showFleet).toHaveBeenCalledTimes(1);expect(legacy.activate).not.toHaveBeenCalled();
    expect(scene.activeEditorTool).toBeNull();expect(scene.activeTool).toBe('none');expect(toolbar.currentTool).toBe('none');
    expect(scene.cameraController.setCursor).toHaveBeenCalledWith('default');
    expect(scene.cameraController.setInputLockOwner).toHaveBeenCalledWith('camera');
    toolbar.selectTool('place-vehicle');expect(scene.railway.showFleet).toHaveBeenCalledTimes(2);
  } finally {
    EventBus.off('tool:changed', scene.toolChangedHandler);EventBus.off('ui:toolbar-select-tool', select);toolbar.destroy();
  }
});

it('retains legacy vehicle placement for worlds without regional management', () => {
  const scene = new WorldScene() as any, legacy = { activate: jest.fn() };
  scene.toolRegistry = new Map([['place-vehicle', legacy]]);
  scene.cameraController = { setCursor: jest.fn(), setInputLockOwner: jest.fn() };
  scene.railway = { active: false, showFleet: jest.fn() };
  GameStateManager.enterCreate('legacy-routing');scene.toolChangedHandler({tool:'place-vehicle'});
  expect(legacy.activate).toHaveBeenCalledTimes(1);expect(scene.railway.showFleet).not.toHaveBeenCalled();
});
