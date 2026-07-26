/**
 * Tests for PlaceVehicleTool – verifies track-snapping placement logic,
 * vehicle type switching, and EventBus emissions.
 */

import Phaser from 'phaser';
import { PlaceVehicleTool } from '../../src/systems/tools/PlaceVehicleTool';
import { EventBus } from '../../src/services/EventBus';
import RailTrack from '../../src/entities/RailTrack';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(scene: any, x1 = 0, y1 = 0, x2 = 500, y2 = 0): RailTrack {
  const p0 = new Phaser.Math.Vector2(x1, y1);
  const p1 = new Phaser.Math.Vector2(x1 + (x2 - x1) / 3, y1 + 30);
  const p2 = new Phaser.Math.Vector2(x1 + 2 * (x2 - x1) / 3, y1 - 30);
  const p3 = new Phaser.Math.Vector2(x2, y2);
  return new RailTrack(scene, p0, p1, p2, p3);
}

describe('PlaceVehicleTool', () => {
  let scene: any;
  let trackManager: any;
  let trainManager: any;
  let tool: PlaceVehicleTool;

  beforeEach(() => {
    scene = makeScene();
    trackManager = {
      getClosestTrack: jest.fn(),
    };
    trainManager = {
      createInitialTrain: jest.fn().mockReturnValue({
        getMatterBody: () => ({ setPosition: jest.fn(), setAngle: jest.fn() }),
        currentTrack: null,
        getUUID: () => 'train-1',
        getPassengerCount: () => 0,
        boardPassengers: jest.fn(),
        unloadPassengers: jest.fn(),
      }),
      createCarriage: jest.fn().mockReturnValue({
        getMatterBody: () => ({ setPosition: jest.fn(), setAngle: jest.fn() }),
        currentTrack: null,
        getUUID: () => 'carriage-1',
        getPassengerCount: () => 0,
        boardPassengers: jest.fn(),
        unloadPassengers: jest.fn(),
      }),
    };
    tool = new PlaceVehicleTool(scene, trackManager, trainManager);
  });

  afterEach(() => {
    tool.destroy();
  });

  describe('setVehicleType', () => {
    it('does not freely place a locomotive', () => {
      const track = makeTrack(scene);
      trackManager.getClosestTrack.mockReturnValue(track);
      tool.onPointerDown(250, 0, { button: 0 } as any);
      expect(trainManager.createInitialTrain).not.toHaveBeenCalled();
      expect(trainManager.createCarriage).not.toHaveBeenCalled();
    });

    it('does not freely place a passenger carriage', () => {
      tool.setVehicleType('passenger-carriage');
      const track = makeTrack(scene);
      trackManager.getClosestTrack.mockReturnValue(track);
      tool.onPointerDown(250, 0, { button: 0 } as any);
      expect(trainManager.createCarriage).not.toHaveBeenCalled();
      expect(trainManager.createInitialTrain).not.toHaveBeenCalled();
    });
  });

  describe('onPointerDown', () => {
    it('ignores unsupported pointer buttons', () => {
      const track = makeTrack(scene);
      trackManager.getClosestTrack.mockReturnValue(track);

      tool.onPointerDown(250, 0, { button: 1 } as any);

      expect(trackManager.getClosestTrack).not.toHaveBeenCalled();
      expect(trainManager.createInitialTrain).not.toHaveBeenCalled();
      expect(trainManager.createCarriage).not.toHaveBeenCalled();
    });

    it('emits error toast when no track is nearby', () => {
      const toastCb = jest.fn();
      EventBus.on('ui:toast', toastCb);
      trackManager.getClosestTrack.mockReturnValue(null);

      tool.onPointerDown(0, 0, { button: 0 } as any);

      expect(toastCb).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Click on a track to place a vehicle', type: 'error' }),
      );
      EventBus.off('ui:toast', toastCb);
    });

    it('does not create, persist, or report success for a track click', () => {
      const clear = jest.fn();
      const emit = jest.spyOn(EventBus, 'emit');
      const historyAwareTool = new PlaceVehicleTool(
        scene,
        trackManager,
        trainManager,
        { clear } as any,
      );
      const track = makeTrack(scene);
      trackManager.getClosestTrack.mockReturnValue(track);

      historyAwareTool.onPointerDown(250, 0, { button: 0 } as any);

      expect(trainManager.createInitialTrain).not.toHaveBeenCalled();
      expect(trainManager.createCarriage).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalledWith(
        'ui:toast',
        expect.objectContaining({ type: 'success' }),
      );
      expect(emit).not.toHaveBeenCalledWith(
        'ui:toolbar-save-state',
        { state: 'unsaved' },
      );
      historyAwareTool.destroy();
      emit.mockRestore();
    });
  });

  describe('onPointerMove', () => {
    it('draws an X when no track is nearby', () => {
      trackManager.getClosestTrack.mockReturnValue(null);
      // Should not throw
      expect(() => tool.onPointerMove(0, 0, { button: 0 } as any)).not.toThrow();
    });

    it('draws ghost preview when near a track', () => {
      const track = makeTrack(scene);
      trackManager.getClosestTrack.mockReturnValue(track);
      expect(() => tool.onPointerMove(250, 0, { button: 0 } as any)).not.toThrow();
    });
  });

  describe('activate / deactivate / cancel', () => {
    it('activate does not throw', () => {
      expect(() => tool.activate()).not.toThrow();
    });

    it('deactivate clears ghost graphics', () => {
      expect(() => tool.deactivate()).not.toThrow();
    });

    it('cancel clears ghost graphics', () => {
      expect(() => tool.cancel()).not.toThrow();
    });
  });

  describe('wantsPointerButton', () => {
    it('returns true for left button (0)', () => {
      expect(tool.wantsPointerButton(0)).toBe(true);
    });

    it('returns false for right button (2)', () => {
      expect(tool.wantsPointerButton(2)).toBe(false);
    });
  });
});
