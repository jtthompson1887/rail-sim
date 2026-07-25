import { PlaceTrackTool } from '../../src/systems/tools/PlaceTrackTool';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';

const { makeScene } = require('../../__mocks__/phaser');

describe('PlaceTrackTool economy guard', () => {
  afterEach(() => WorldManager.reset());

  it('rejects direct pointer placement without analysing or mutating tracks', () => {
    const scene = makeScene();
    const trackManager = { addTrack: jest.fn() };
    const snapSystem = { snapPoint: jest.fn((x, y) => ({ x, y })) };
    const terrainValidator = { canPlaceTrack: jest.fn() };
    const emitSpy = jest.spyOn(EventBus, 'emit');
    WorldManager.createNew('Guarded placement', 'real-terrain-alpha');
    const tool = new PlaceTrackTool(
      scene,
      trackManager as any,
      snapSystem as any,
      terrainValidator as any,
    );

    tool.onPointerDown(0, 0, {} as any);
    tool.onPointerDown(300, 0, {} as any);

    expect(terrainValidator.canPlaceTrack).not.toHaveBeenCalled();
    expect(trackManager.addTrack).not.toHaveBeenCalled();
    expect(WorldManager.world!.tracks).toEqual([]);
    expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
      message: expect.stringContaining('economy-aware'),
      type: 'info',
    });

    tool.destroy();
    emitSpy.mockRestore();
  });
});
