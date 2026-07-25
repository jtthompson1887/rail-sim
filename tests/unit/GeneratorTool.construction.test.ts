import Phaser from 'phaser';
import { GeneratorTool } from '../../src/systems/tools/GeneratorTool';
import TrackGenerator from '../../src/systems/TrackGenerator';
import RailTrack from '../../src/entities/RailTrack';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';
import { GameConfig } from '../../src/config/GameConfig';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(scene: any, x0: number, y0: number, x3: number, y3: number): RailTrack {
  return new RailTrack(
    scene,
    new Phaser.Math.Vector2(x0, y0),
    new Phaser.Math.Vector2(x0 + (x3 - x0) / 3, y0 + (y3 - y0) / 3),
    new Phaser.Math.Vector2(x0 + (x3 - x0) * 2 / 3, y0 + (y3 - y0) * 2 / 3),
    new Phaser.Math.Vector2(x3, y3),
  );
}

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    valid: true,
    requiresTunnel: false,
    averageElevation: 10,
    reason: '',
    reasonCode: '',
    ...overrides,
  };
}

describe('GeneratorTool construction behavior', () => {
  let scene: any;
  let graphics: any;
  let trackManager: any;
  let snapSystem: any;
  let terrainValidator: any;
  let editorUI: any;
  let tool: GeneratorTool;
  let emitSpy: jest.SpyInstance;
  let generateSpy: jest.SpyInstance;

  beforeEach(() => {
    scene = makeScene();
    const image = scene.add.image();
    image.setAlpha = jest.fn().mockReturnValue(image);
    image.setTint = jest.fn().mockReturnValue(image);
    graphics = scene.add.graphics();
    graphics.strokeCircle = jest.fn().mockReturnValue(graphics);
    for (const method of ['clear', 'fillStyle', 'fillCircle', 'lineStyle', 'destroy']) {
      graphics[method] = jest.fn().mockReturnValue(graphics);
    }
    editorUI = {
      getGeneratorParams: jest.fn().mockReturnValue({
        sections: 3,
        minLength: 110,
        maxLength: 220,
        curveProbability: 0.4,
        minCurveAngle: 12,
        maxCurveAngle: 34,
      }),
    };
    scene.scene = { get: jest.fn().mockReturnValue(editorUI) };
    trackManager = {
      getAllTracks: jest.fn().mockReturnValue([]),
      removeTrack: jest.fn(),
    };
    snapSystem = { snapPoint: jest.fn((x, y) => ({ x, y })) };
    terrainValidator = { canPlaceTrack: jest.fn().mockReturnValue(validResult()) };
    WorldManager.createNew('GeneratorTool construction', 'construction-seed');
    emitSpy = jest.spyOn(EventBus, 'emit');
    generateSpy = jest.spyOn(TrackGenerator.prototype, 'generateTracks').mockReturnValue([]);
    tool = new GeneratorTool(scene, trackManager, snapSystem, terrainValidator);
  });

  afterEach(() => {
    generateSpy.mockRestore();
    emitSpy.mockRestore();
    WorldManager.reset();
  });

  it('requires an anchor, draws the snapped anchor, generates on second click, and clears it', () => {
    tool.runFromAnchor();
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      { message: 'Click on the map to set a generation anchor first', type: 'error' },
    );

    snapSystem.snapPoint.mockReturnValue({ x: 25, y: 45 });
    tool.onPointerDown(20, 40, {} as any);
    expect(graphics.fillCircle).toHaveBeenCalledWith(25, 45, 8);
    expect(graphics.strokeCircle).toHaveBeenCalledWith(25, 45, 16);

    tool.onPointerDown(999, 999, {} as any);
    expect(generateSpy).toHaveBeenCalledWith(expect.objectContaining({
      startPoint: expect.objectContaining({ x: 25, y: 45 }),
      startAngle: Phaser.Math.DegToRad(90),
      sections: 3,
      minLength: 110,
      maxLength: 220,
    }));
    expect(graphics.clear).toHaveBeenCalled();

    generateSpy.mockClear();
    tool.runFromAnchor();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('uses configuration defaults when the editor UI is unavailable', () => {
    scene.scene.get.mockReturnValue(null);
    snapSystem.snapPoint.mockReturnValue({ x: 500, y: 600 });

    tool.runGeneratorAt(500, 600);

    expect(generateSpy).toHaveBeenCalledWith(expect.objectContaining({
      sections: GameConfig.GENERATION.MAIN.SECTIONS,
      minLength: GameConfig.GENERATION.MAIN.MIN_LENGTH,
      maxLength: GameConfig.GENERATION.MAIN.MAX_LENGTH,
      curveProbability: GameConfig.GENERATION.MAIN.CURVE_PROB,
      minCurveAngle: GameConfig.GENERATION.MAIN.MIN_ANGLE,
      maxCurveAngle: GameConfig.GENERATION.MAIN.MAX_ANGLE,
    }));
  });

  it('continues outward from the nearest endpoint of an existing track', () => {
    const existing = makeTrack(scene, 100, 100, 400, 100);
    trackManager.getAllTracks.mockReturnValue([existing]);
    snapSystem.snapPoint.mockReturnValue({ x: 105, y: 102 });

    tool.runGeneratorAt(105, 102);

    const params = generateSpy.mock.calls[0][0];
    expect({ x: params.startPoint.x, y: params.startPoint.y }).toEqual({ x: 100, y: 100 });
    expect(params.startAngle).toBeCloseTo(Math.PI);
  });

  it('commits valid sections, removes invalid ones, and reports grouped reasons', () => {
    const valid = makeTrack(scene, 0, 0, 200, 0);
    const slopeInvalid = makeTrack(scene, 200, 0, 400, 0);
    const secondSlopeInvalid = makeTrack(scene, 400, 0, 600, 0);
    const cliffInvalid = makeTrack(scene, 600, 0, 800, 0);
    generateSpy.mockReturnValue([valid, slopeInvalid, secondSlopeInvalid, cliffInvalid]);
    terrainValidator.canPlaceTrack
      .mockReturnValueOnce(validResult({
        requiresTunnel: true,
        averageElevation: 77,
      }))
      .mockReturnValueOnce({
        valid: false, reason: 'too steep', reasonCode: 'slope',
      })
      .mockReturnValueOnce({
        valid: false, reason: 'too steep', reasonCode: 'slope',
      })
      .mockReturnValueOnce({
        valid: false, reason: 'crosses cliff', reasonCode: 'cliff',
      });
    const addWorld = jest.spyOn(WorldManager, 'addTrackDef');
    const updateValid = jest.spyOn(valid, 'updateTrackVectors');

    tool.runGeneratorAt(0, 0);

    expect(updateValid).toHaveBeenCalled();
    expect(valid.isTunnel).toBe(true);
    expect(valid.elevation).toBe(77);
    expect(addWorld).toHaveBeenCalledTimes(1);
    expect(addWorld).toHaveBeenCalledWith(expect.objectContaining({
      uuid: valid.getUUID(),
      isTunnel: true,
      elevation: 77,
    }));
    expect(trackManager.removeTrack).toHaveBeenCalledTimes(3);
    expect(trackManager.removeTrack).toHaveBeenCalledWith(slopeInvalid.getUUID());
    expect(trackManager.removeTrack).toHaveBeenCalledWith(cliffInvalid.getUUID());
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:validation-hint',
      { state: 'warning', message: '3 section(s) failed: slope, cliff' },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      {
        message: 'Generated 1 tracks (3 blocked: 2 too steep, 1 crosses cliffs)',
        type: 'warning',
      },
    );
  });

  it('reports a clean successful generation and resets lifecycle state on deactivate', () => {
    const first = makeTrack(scene, 0, 0, 100, 0);
    const second = makeTrack(scene, 100, 0, 200, 0);
    generateSpy.mockReturnValue([first, second]);
    terrainValidator.canPlaceTrack.mockReturnValue(validResult());

    tool.runGeneratorAt(0, 0);

    expect(trackManager.removeTrack).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:validation-hint',
      { state: 'ok', message: '' },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      { message: 'Generated 2 tracks', type: 'success' },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'unsaved' },
    );

    tool.activate();
    tool.onPointerDown(10, 20, {} as any);
    tool.deactivate();
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:validation-hint',
      { state: 'ok', message: '' },
    );
    expect(tool.wantsPointerButton(0)).toBe(true);
    expect(tool.wantsPointerButton(2)).toBe(false);
  });

  it('destroys its owned ghost graphics', () => {
    tool.destroy();

    expect(graphics.destroy).toHaveBeenCalledTimes(1);
  });
});
