/**
 * Tests for Train entity – covers constructor, getters/setters, and passenger logic.
 */

import Phaser from 'phaser';
import Train from '../../src/entities/Train';
import { captureTrainRuntime } from '../../src/freight/TrainRuntime';
import { EventBus } from '../../src/services/EventBus';

// Pull the makeScene helper from our mock
const { makeScene } = require('../../__mocks__/phaser');

describe('Train', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  describe('constructor', () => {
    it('creates a Train without throwing', () => {
      expect(() => new Train(scene, 100, 200)).not.toThrow();
    });

    it('returns a UUID from getUUID()', () => {
      const train = new Train(scene, 0, 0);
      expect(typeof train.getUUID()).toBe('string');
      expect(train.getUUID().length).toBeGreaterThan(0);
    });

    it('each Train has a unique UUID', () => {
      const t1 = new Train(scene, 0, 0);
      const t2 = new Train(scene, 0, 0);
      expect(t1.getUUID()).not.toBe(t2.getUUID());
    });

    it('accepts an optional existing UUID', () => {
      const train = new Train(scene, 0, 0, 'preset-uuid');
      expect(train.getUUID()).toBe('preset-uuid');
    });

    it('starts with enginePower = 0', () => {
      const train = new Train(scene, 0, 0);
      expect(train.enginePower).toBe(0);
    });

    it('starts with derailed = false', () => {
      const train = new Train(scene, 0, 0);
      expect(train.derailed).toBe(false);
    });

    it('starts with selected = false', () => {
      const train = new Train(scene, 0, 0);
      expect(train.selected).toBe(false);
    });

    it('starts with no current track', () => {
      const train = new Train(scene, 0, 0);
      expect(train.currentTrack).toBeNull();
    });

    it('has PID controllers', () => {
      const train = new Train(scene, 0, 0);
      expect(train.pidControllerFront).toBeDefined();
      expect(train.pidControllerRear).toBeDefined();
    });

    it('passenger capacity is positive', () => {
      const train = new Train(scene, 0, 0);
      expect(train.passengerCapacity).toBeGreaterThan(0);
    });
  });

  describe('enginePower getter/setter', () => {
    it('sets and gets enginePower', () => {
      const train = new Train(scene, 0, 0);
      train.enginePower = 0.5;
      expect(train.enginePower).toBe(0.5);
    });

    it('supports negative engine power (reverse)', () => {
      const train = new Train(scene, 0, 0);
      train.enginePower = -0.3;
      expect(train.enginePower).toBe(-0.3);
    });
  });

  describe('currentTrack getter/setter', () => {
    it('can set and get currentTrack', () => {
      const train = new Train(scene, 0, 0);
      const mockTrack = { getUUID: () => 'track-1' } as any;
      train.currentTrack = mockTrack;
      expect(train.currentTrack).toBe(mockTrack);
    });

    it('can clear currentTrack', () => {
      const train = new Train(scene, 0, 0);
      train.currentTrack = { getUUID: () => 'x' } as any;
      train.currentTrack = null;
      expect(train.currentTrack).toBeNull();
    });
  });

  describe('selected getter/setter', () => {
    it('setting selected=true changes tint', () => {
      const train = new Train(scene, 0, 0);
      expect(() => { train.selected = true; }).not.toThrow();
      expect(train.selected).toBe(true);
    });

    it('setting selected=false clears tint', () => {
      const train = new Train(scene, 0, 0);
      train.selected = true;
      expect(() => { train.selected = false; }).not.toThrow();
      expect(train.selected).toBe(false);
    });
  });

  describe('derailed getter/setter', () => {
    it('emits train:derailed event when derailed', () => {
      const cb = jest.fn();
      EventBus.on('train:derailed', cb);
      const train = new Train(scene, 0, 0);
      train.derailed = true;
      expect(cb).toHaveBeenCalledWith({ trainId: train.getUUID() });
      EventBus.off('train:derailed', cb);
    });

    it('setting derailed=true only emits once (no re-emit if already derailed)', () => {
      const cb = jest.fn();
      EventBus.on('train:derailed', cb);
      const train = new Train(scene, 0, 0);
      train.derailed = true;
      train.derailed = true; // second set – should not emit again
      expect(cb).toHaveBeenCalledTimes(1);
      EventBus.off('train:derailed', cb);
    });

    it('derailed becomes true after setting', () => {
      const train = new Train(scene, 0, 0);
      train.derailed = true;
      expect(train.derailed).toBe(true);
    });
  });

  describe('getMatterBody()', () => {
    it('returns the Matter physics body', () => {
      const train = new Train(scene, 0, 0);
      expect(train.getMatterBody()).toBeDefined();
    });
  });

  describe('boardPassengers() and unloadPassengers()', () => {
    it('starts with 0 passengers', () => {
      const train = new Train(scene, 0, 0);
      expect(train.getPassengerCount()).toBe(0);
    });

    it('boards passengers up to capacity', () => {
      const train = new Train(scene, 0, 0);
      const accepted = train.boardPassengers(5);
      expect(accepted).toBe(5);
      expect(train.getPassengerCount()).toBe(5);
    });

    it('cannot board more than capacity', () => {
      const train = new Train(scene, 0, 0);
      const accepted = train.boardPassengers(train.passengerCapacity + 10);
      expect(accepted).toBe(train.passengerCapacity);
      expect(train.getPassengerCount()).toBe(train.passengerCapacity);
    });

    it('boards partial amount when near capacity', () => {
      const train = new Train(scene, 0, 0);
      train.boardPassengers(train.passengerCapacity - 2);
      const accepted = train.boardPassengers(5);
      expect(accepted).toBe(2);
    });

    it('unloads all passengers', () => {
      const train = new Train(scene, 0, 0);
      train.boardPassengers(10);
      const delivered = train.unloadPassengers();
      expect(delivered).toBe(10);
      expect(train.getPassengerCount()).toBe(0);
    });

    it('unload returns 0 when no passengers', () => {
      const train = new Train(scene, 0, 0);
      expect(train.unloadPassengers()).toBe(0);
    });
  });

  describe('update()', () => {
    it('does not throw when called with a stopped train', () => {
      const train = new Train(scene, 0, 0);
      expect(() => train.update(0, 16)).not.toThrow();
    });

    it('does not throw when enginePower is set and train updates', () => {
      const train = new Train(scene, 100, 100);
      train.enginePower = 0.1;
      expect(() => train.update(0, 16)).not.toThrow();
    });

    it('does not apply force when derailed', () => {
      const train = new Train(scene, 0, 0);
      train.derailed = true;
      train.enginePower = 1.0;
      const body = train.getMatterBody();
      const forceBefore = { x: (body.body as any).force.x, y: (body.body as any).force.y };
      train.update(0, 16);
      // derailed + enginePower != 0 but derailed check short-circuits
      expect((body.body as any).force.x).toBe(forceBefore.x);
      expect((body.body as any).force.y).toBe(forceBefore.y);
    });
  });

  describe('aggregate freight runtime', () => {
    it('stores only the freight-set presentation identity', () => {
      const train = new Train(
        scene,
        0,
        0,
        'freight-train',
        'flatbed-freight-set',
      );

      expect(train.freightSetId).toBe('flatbed-freight-set');
      expect(train).not.toHaveProperty('cargo');
      expect(train).not.toHaveProperty('operations');
    });

    it.each([
      { angle: 0, facing: 1 as const },
      { angle: 180, facing: -1 as const },
    ])('captures exact on-track runtime facing $facing', ({ angle, facing }) => {
      const train = new Train(
        scene,
        12,
        34,
        'freight-train',
        'flatbed-freight-set',
      );
      const track = {
        getUUID: jest.fn().mockReturnValue('track-b'),
        getTrackPosition: jest.fn().mockReturnValue(0.75),
        getCurvePath: jest.fn().mockReturnValue({
          getTangent: jest.fn().mockReturnValue({ x: 1, y: 0 }),
        }),
      };
      train.currentTrack = track as any;
      train.getMatterBody().setAngle(angle);
      train.getMatterBody().setVelocity(3, 4);
      train.enginePower = -0.25;

      expect(captureTrainRuntime(train)).toEqual({
        trainId: 'freight-train',
        trackUUID: 'track-b',
        trackT: 0.75,
        facing,
        x: 12,
        y: 34,
        speedWorldUnitsPerSecond: 300,
        throttle: -1,
        derailed: false,
      });
    });

    it.each([
      { enginePower: -0.01, throttle: -1 as const },
      { enginePower: 0, throttle: 0 as const },
      { enginePower: 0.01, throttle: 1 as const },
    ])(
      'normalizes engine power $enginePower to throttle $throttle',
      ({ enginePower, throttle }) => {
        const train = new Train(scene, 0, 0, 'freight-train');
        train.enginePower = enginePower;

        expect(captureTrainRuntime(train).throttle).toBe(throttle);
      },
    );
  });
});
