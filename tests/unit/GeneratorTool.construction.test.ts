import { GeneratorTool } from '../../src/systems/tools/GeneratorTool';
import TrackGenerator from '../../src/systems/TrackGenerator';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';

const { makeScene } = require('../../__mocks__/phaser');

describe('GeneratorTool construction authority', () => {
  let scene: any;
  let tool: GeneratorTool;
  let trackManager: any;
  let snapSystem: any;
  let terrainValidator: any;
  let emitSpy: jest.SpyInstance;
  let generateSpy: jest.SpyInstance;

  beforeEach(() => {
    scene = makeScene();
    const graphics = scene.add.graphics();
    graphics.strokeCircle = jest.fn().mockReturnValue(graphics);
    scene.add.graphics.mockReturnValue(graphics);
    scene.scene = { get: jest.fn().mockReturnValue(null) };
    trackManager = {
      tracks: [],
      addTrack: jest.fn(),
      removeTrack: jest.fn(),
      updateTrackVectors: jest.fn(),
      getAllTracks: jest.fn().mockReturnValue([]),
    };
    snapSystem = { snapPoint: jest.fn((x, y) => ({ x, y })) };
    terrainValidator = { canPlaceTrack: jest.fn() };
    WorldManager.createNew('Generator lock', 'generator-lock-seed');
    emitSpy = jest.spyOn(EventBus, 'emit');
    generateSpy = jest.spyOn(TrackGenerator.prototype, 'generateTracks').mockReturnValue([]);
    tool = new GeneratorTool(scene, trackManager, snapSystem, terrainValidator);
  });

  afterEach(() => {
    generateSpy.mockRestore();
    emitSpy.mockRestore();
    WorldManager.reset();
  });

  it('keeps click and direct-run entry points disabled with one truthful atomicity reason', () => {
    const before = JSON.stringify(WorldManager.world);

    tool.activate();
    tool.onPointerDown(20, 40, {} as any);
    tool.runFromAnchor();
    tool.runGeneratorAt(500, 600);

    expect(emitSpy).toHaveBeenCalledWith('ui:toast', {
      message: 'Generate unavailable — multi-track construction needs one atomic quote.',
      type: 'info',
    });
    expect(generateSpy).not.toHaveBeenCalled();
    expect(snapSystem.snapPoint).not.toHaveBeenCalled();
    expect(terrainValidator.canPlaceTrack).not.toHaveBeenCalled();
    expect(trackManager.addTrack).not.toHaveBeenCalled();
    expect(trackManager.removeTrack).not.toHaveBeenCalled();
    expect(trackManager.updateTrackVectors).not.toHaveBeenCalled();
    expect(JSON.stringify(WorldManager.world)).toBe(before);
  });

  it('owns no pending construction state and releases its visual shell', () => {
    const graphics = (tool as any).ghostGraphics;
    const destroySpy = jest.spyOn(graphics, 'destroy');

    tool.cancel();
    tool.deactivate();
    tool.destroy();

    expect((tool as any).anchor).toBeUndefined();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
