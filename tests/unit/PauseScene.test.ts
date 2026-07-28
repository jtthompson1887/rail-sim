import PauseScene from '../../src/scenes/PauseScene';
import { GameStateManager } from '../../src/managers/GameStateManager';
import { EventBus } from '../../src/services/EventBus';

describe('PauseScene overlay visibility flow', () => {
  const prepare = (): {
    scene: PauseScene;
    manager: {
      resume: jest.Mock;
      stop: jest.Mock;
      start: jest.Mock;
    };
  } => {
    const scene = new PauseScene();
    const manager = {
      resume: jest.fn(),
      stop: jest.fn(),
      start: jest.fn(),
    };
    (scene as any).scene = manager;
    return { scene, manager };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('clears pause overlays before resuming play', () => {
    const { scene, manager } = prepare();
    const emit = jest.spyOn(EventBus, 'emit');
    const resume = jest.spyOn(GameStateManager, 'resume')
      .mockImplementation(() => undefined);

    (scene as any).resumeGame();

    expect(emit).toHaveBeenCalledWith(
      'ui:pause-visible',
      { visible: false },
    );
    expect(resume).toHaveBeenCalled();
    expect(manager.resume).toHaveBeenCalledWith('WorldScene');
    expect(manager.resume).toHaveBeenCalledWith('GameScene');
    expect(manager.stop).toHaveBeenCalled();
  });

  it('clears pause overlays after switching to create mode', () => {
    const { scene, manager } = prepare();
    const emit = jest.spyOn(EventBus, 'emit');
    const returnToCreate = jest.spyOn(GameStateManager, 'returnToCreate')
      .mockImplementation(() => undefined);

    (scene as any).returnToCreate();

    expect(returnToCreate).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'ui:pause-visible',
      { visible: false },
    );
    expect(manager.resume).toHaveBeenCalledWith('WorldScene');
    expect(manager.stop).toHaveBeenCalled();
  });

  it('clears pause overlays before quitting to the menu', () => {
    const { scene, manager } = prepare();
    const emit = jest.spyOn(EventBus, 'emit');

    (scene as any).quitToMenu();

    expect(emit).toHaveBeenCalledWith(
      'ui:pause-visible',
      { visible: false },
    );
    expect(manager.stop).toHaveBeenCalledWith('WorldScene');
    expect(manager.start).toHaveBeenCalledWith('MenuScene');
  });
});
