import { JunctionCreatorSystem } from '../../src/systems/JunctionCreatorSystem';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';

const { makeScene } = require('../../__mocks__/phaser');

describe('JunctionCreatorSystem construction authority', () => {
  let scene: any;
  let trackManager: any;
  let terrainValidator: any;
  let system: JunctionCreatorSystem;
  let emitSpy: jest.SpyInstance;

  beforeEach(() => {
    scene = makeScene();
    trackManager = {
      tracks: [],
      addTrack: jest.fn(),
      removeTrack: jest.fn(),
      createJunctionFromBranches: jest.fn(),
    };
    terrainValidator = { canPlaceTrack: jest.fn() };
    WorldManager.createNew('Junction lock', 'junction-lock-seed');
    emitSpy = jest.spyOn(EventBus, 'emit');
    system = new JunctionCreatorSystem(scene, trackManager, terrainValidator);
  });

  afterEach(() => {
    emitSpy.mockRestore();
    WorldManager.reset();
  });

  it('keeps the public drag workflow disabled before geometry or topology mutation', () => {
    const before = JSON.stringify(WorldManager.world);
    const rightPointer = { rightButtonDown: () => true, x: 10, y: 20 };

    system.onPointerDown(rightPointer as any);
    system.onPointerMove({ x: 200, y: 200 } as any);
    system.onPointerUp({ x: 200, y: 200 } as any);

    expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
      message: 'Junction unavailable — track splitting needs one atomic quote.',
      type: 'info',
    });
    expect(terrainValidator.canPlaceTrack).not.toHaveBeenCalled();
    expect(trackManager.addTrack).not.toHaveBeenCalled();
    expect(trackManager.removeTrack).not.toHaveBeenCalled();
    expect(trackManager.createJunctionFromBranches).not.toHaveBeenCalled();
    expect(JSON.stringify(WorldManager.world)).toBe(before);
  });

  it('ignores non-right clicks and has idempotent cleanup', () => {
    system.onPointerDown({ rightButtonDown: () => false } as any);
    expect(emitSpy).not.toHaveBeenCalled();

    expect(() => {
      system.cancel();
      system.destroy();
      system.destroy();
    }).not.toThrow();
  });
});
