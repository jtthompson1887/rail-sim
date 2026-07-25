import WorldScene from '../../src/scenes/WorldScene';
import { GameStateManager } from '../../src/managers/GameStateManager';

describe('WorldScene editor event guards', () => {
  afterEach(() => {
    GameStateManager.enterCreate('test-world');
  });

  it('ignores stale generator and delete events outside create mode', () => {
    const scene = new WorldScene();
    const runFromAnchor = jest.fn();
    const deleteSelectedTracks = jest.fn();
    (scene as any).toolRegistry = new Map([['generator', { runFromAnchor }]]);
    (scene as any).deleteSelectedTracks = deleteSelectedTracks;

    GameStateManager.enterPlay('test-world');
    (scene as any).generatorRunHandler();
    (scene as any).editorDeleteHandler({ uuids: ['track-1'] });

    expect(runFromAnchor).not.toHaveBeenCalled();
    expect(deleteSelectedTracks).not.toHaveBeenCalled();

    GameStateManager.returnToCreate();
    (scene as any).generatorRunHandler();
    (scene as any).editorDeleteHandler({ uuids: ['track-1'] });

    expect(runFromAnchor).toHaveBeenCalledTimes(1);
    expect(deleteSelectedTracks).toHaveBeenCalledWith(['track-1']);
  });
});
