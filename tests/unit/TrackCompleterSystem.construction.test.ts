import { TrackCompleterSystem } from '../../src/systems/TrackCompleterSystem';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';

const { makeScene } = require('../../__mocks__/phaser');

describe('TrackCompleterSystem construction authority', () => {
  let scene: any;
  let trackManager: any;
  let terrainValidator: any;
  let system: TrackCompleterSystem;
  let emitSpy: jest.SpyInstance;

  beforeEach(() => {
    scene = makeScene();
    trackManager = {
      tracks: [],
      addTrack: jest.fn(),
      removeTrack: jest.fn(),
      updateTrackVectors: jest.fn(),
    };
    terrainValidator = { canPlaceTrack: jest.fn() };
    WorldManager.createNew('Completer lock', 'completer-lock-seed');
    emitSpy = jest.spyOn(EventBus, 'emit');
    system = new TrackCompleterSystem(scene, trackManager, terrainValidator);
  });

  afterEach(() => {
    emitSpy.mockRestore();
    WorldManager.reset();
  });

  it('keeps activation, pointer, keyboard, and confirm paths mutation-free', () => {
    const before = JSON.stringify(WorldManager.world);

    system.setActive(true);
    system.onPointerDown({ leftButtonDown: () => true, x: 0, y: 0 } as any);
    system.onKeyDown({ code: 'Enter' } as KeyboardEvent);
    system.onKeyDown({ code: 'Space' } as KeyboardEvent);
    system.confirm();
    system.update(16);

    expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
      message: 'Connect unavailable — route completion needs one atomic quote.',
      type: 'info',
    });
    expect(terrainValidator.canPlaceTrack).not.toHaveBeenCalled();
    expect(trackManager.addTrack).not.toHaveBeenCalled();
    expect(trackManager.removeTrack).not.toHaveBeenCalled();
    expect(trackManager.updateTrackVectors).not.toHaveBeenCalled();
    expect(JSON.stringify(WorldManager.world)).toBe(before);
    expect((system as any).pendingTracks).toBeUndefined();
  });

  it('cancel, deactivate, and destroy are idempotent lifecycle no-ops', () => {
    expect(() => {
      system.cancel();
      system.setActive(false);
      system.destroy();
      system.destroy();
    }).not.toThrow();
  });
});
