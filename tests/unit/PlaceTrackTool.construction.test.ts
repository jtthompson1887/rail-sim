import Phaser from 'phaser';
import { PlaceTrackTool } from '../../src/systems/tools/PlaceTrackTool';
import { EventBus } from '../../src/services/EventBus';
import { WorldManager } from '../../src/managers/WorldManager';
import RailTrack from '../../src/entities/RailTrack';

const { makeScene } = require('../../__mocks__/phaser');

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    valid: true,
    requiresTunnel: false,
    averageElevation: 12,
    reason: '',
    reasonCode: '',
    ...overrides,
  };
}

function makeTrack(scene: any, x0: number, y0: number, x3: number, y3: number): RailTrack {
  return new RailTrack(
    scene,
    new Phaser.Math.Vector2(x0, y0),
    new Phaser.Math.Vector2(x0 + (x3 - x0) / 3, y0 + (y3 - y0) / 3),
    new Phaser.Math.Vector2(x0 + (x3 - x0) * 2 / 3, y0 + (y3 - y0) * 2 / 3),
    new Phaser.Math.Vector2(x3, y3),
  );
}

describe('PlaceTrackTool construction behavior', () => {
  let scene: any;
  let graphics: any;
  let trackManager: any;
  let snapSystem: any;
  let terrainValidator: any;
  let tool: PlaceTrackTool;
  let emitSpy: jest.SpyInstance;

  beforeEach(() => {
    scene = makeScene();
    const image = scene.add.image();
    image.setAlpha = jest.fn().mockReturnValue(image);
    image.setTint = jest.fn().mockReturnValue(image);
    graphics = scene.add.graphics();
    for (const method of [
      'clear', 'fillStyle', 'fillCircle', 'lineStyle',
      'beginPath', 'moveTo', 'lineTo', 'strokePath', 'destroy',
    ]) {
      graphics[method] = jest.fn().mockReturnValue(graphics);
    }
    trackManager = { addTrack: jest.fn() };
    snapSystem = { snapPoint: jest.fn((x, y) => ({ x, y })) };
    terrainValidator = {
      canPlaceTrack: jest.fn(),
      snapToFlushConnection: jest.fn(),
    };
    WorldManager.createNew('PlaceTrackTool construction');
    emitSpy = jest.spyOn(EventBus, 'emit');
    tool = new PlaceTrackTool(scene, trackManager, snapSystem, terrainValidator);
  });

  afterEach(() => {
    emitSpy.mockRestore();
    WorldManager.reset();
  });

  it('anchors at the snapped first click and previews valid, tunnel, and invalid routes', () => {
    snapSystem.snapPoint.mockReturnValue({ x: 40, y: 60 });
    tool.onPointerDown(43, 64, {} as any);

    expect(snapSystem.snapPoint).toHaveBeenCalledWith(43, 64);
    expect(graphics.fillCircle).toHaveBeenCalledWith(40, 60, 6);

    terrainValidator.canPlaceTrack
      .mockReturnValueOnce(validResult())
      .mockReturnValueOnce(validResult({ requiresTunnel: true, reason: 'tunnel required' }))
      .mockReturnValueOnce({
        valid: false,
        requiresTunnel: false,
        averageElevation: 0,
        reason: 'too steep',
        reasonCode: 'slope',
      });

    tool.onPointerMove(340, 60, {} as any);
    expect(graphics.lineStyle).toHaveBeenLastCalledWith(2, 0x00ff88, 0.6);
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:validation-hint',
      { state: 'ok', message: '' },
    );

    tool.onPointerMove(340, 160, {} as any);
    expect(graphics.lineStyle).toHaveBeenLastCalledWith(2, 0xffcc00, 0.6);
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:validation-hint',
      { state: 'warning', message: 'tunnel required' },
    );

    tool.onPointerMove(340, 260, {} as any);
    expect(graphics.lineStyle).toHaveBeenLastCalledWith(2, 0xff4444, 0.6);
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:validation-hint',
      { state: 'error', message: 'too steep' },
    );
  });

  it('rejects invalid placement without mutation and chains from the rejected endpoint', () => {
    terrainValidator.canPlaceTrack.mockReturnValue({
      valid: false,
      requiresTunnel: false,
      averageElevation: 0,
      reason: 'crosses cliff',
      reasonCode: 'cliff',
    });

    tool.onPointerDown(0, 0, {} as any);
    tool.onPointerDown(300, 100, {} as any);

    expect(trackManager.addTrack).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      { message: 'Cannot place track: crosses cliff', type: 'error' },
    );

    terrainValidator.canPlaceTrack.mockClear();
    tool.onPointerMove(600, 100, {} as any);
    const [p0] = terrainValidator.canPlaceTrack.mock.calls[0];
    expect({ x: p0.x, y: p0.y }).toEqual({ x: 300, y: 100 });
  });

  it('commits a validated tunnel and persists a valid flush neighbour adjustment', () => {
    const neighbour = makeTrack(scene, -100, 0, 0, 0);
    const updateNeighbour = jest.spyOn(neighbour, 'updateTrackVectors');
    const adjustment = {
      track: neighbour,
      p0: new Phaser.Math.Vector2(-100, 0),
      p1: new Phaser.Math.Vector2(-60, 4),
      p2: new Phaser.Math.Vector2(-30, 2),
      p3: new Phaser.Math.Vector2(0, 0),
    };
    terrainValidator.canPlaceTrack
      .mockReturnValueOnce(validResult({
        requiresTunnel: true,
        averageElevation: 88,
        reason: 'tunnel required',
      }))
      .mockReturnValueOnce(validResult());
    terrainValidator.snapToFlushConnection.mockReturnValue({
      p0: new Phaser.Math.Vector2(0, 0),
      p1: new Phaser.Math.Vector2(100, 0),
      p2: new Phaser.Math.Vector2(200, 0),
      p3: new Phaser.Math.Vector2(300, 0),
      neighbourAdjustment: adjustment,
    });
    const updateWorld = jest.spyOn(WorldManager, 'updateTrackDef');
    const addWorld = jest.spyOn(WorldManager, 'addTrackDef');

    tool.onPointerDown(0, 0, {} as any);
    tool.onPointerDown(300, 0, {} as any);

    expect(updateNeighbour).toHaveBeenCalledWith(
      adjustment.p0, adjustment.p1, adjustment.p2, adjustment.p3,
    );
    expect(updateWorld).toHaveBeenCalledWith(expect.objectContaining({ uuid: neighbour.getUUID() }));
    expect(trackManager.addTrack).toHaveBeenCalledTimes(1);
    const committedTrack = trackManager.addTrack.mock.calls[0][0];
    expect(committedTrack.isTunnel).toBe(true);
    expect(committedTrack.elevation).toBe(88);
    expect(addWorld).toHaveBeenCalledWith(expect.objectContaining({
      uuid: committedTrack.getUUID(),
      isTunnel: true,
      elevation: 88,
    }));
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:validation-hint',
      { state: 'warning', message: 'tunnel required' },
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toolbar-save-state',
      { state: 'unsaved' },
    );
  });

  it('leaves a neighbour untouched when its flush adjustment fails validation', () => {
    const neighbour = { updateTrackVectors: jest.fn() };
    terrainValidator.canPlaceTrack
      .mockReturnValueOnce(validResult())
      .mockReturnValueOnce({ valid: false, reason: 'adjustment invalid' });
    terrainValidator.snapToFlushConnection.mockReturnValue({
      p0: new Phaser.Math.Vector2(0, 0),
      p1: new Phaser.Math.Vector2(100, 0),
      p2: new Phaser.Math.Vector2(200, 0),
      p3: new Phaser.Math.Vector2(300, 0),
      neighbourAdjustment: {
        track: neighbour,
        p0: new Phaser.Math.Vector2(-100, 0),
        p1: new Phaser.Math.Vector2(-60, 0),
        p2: new Phaser.Math.Vector2(-30, 0),
        p3: new Phaser.Math.Vector2(0, 0),
      },
    });

    tool.onPointerDown(0, 0, {} as any);
    tool.onPointerDown(300, 0, {} as any);

    expect(neighbour.updateTrackVectors).not.toHaveBeenCalled();
    expect(trackManager.addTrack).toHaveBeenCalledTimes(1);
  });

  it('cancels/deactivates cleanly and advertises only the left pointer button', () => {
    tool.onPointerDown(10, 20, {} as any);
    tool.deactivate();
    terrainValidator.canPlaceTrack.mockClear();
    tool.onPointerMove(50, 60, {} as any);

    expect(terrainValidator.canPlaceTrack).not.toHaveBeenCalled();
    expect(tool.wantsPointerButton(0)).toBe(true);
    expect(tool.wantsPointerButton(1)).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:validation-hint',
      { state: 'ok', message: '' },
    );

    tool.destroy();
    expect(graphics.destroy).toHaveBeenCalled();
  });
});
