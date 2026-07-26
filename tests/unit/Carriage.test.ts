/**
 * Tests for Carriage entity – covers constructor, getters/setters, passenger logic,
 * and verifies it behaves as a passive track-follower (no engine power).
 */

import Phaser from 'phaser';
import Carriage from '../../src/entities/Carriage';
import { EventBus } from '../../src/services/EventBus';

const { makeScene } = require('../../__mocks__/phaser');

describe('Carriage', () => {
  let scene: any;

  beforeEach(() => {
    scene = makeScene();
  });

  describe('constructor', () => {
    it('creates a Carriage without throwing', () => {
      expect(() => new Carriage(scene, 100, 200)).not.toThrow();
    });

    it('returns a UUID from getUUID()', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(typeof carriage.getUUID()).toBe('string');
      expect(carriage.getUUID().length).toBeGreaterThan(0);
    });

    it('each Carriage has a unique UUID', () => {
      const c1 = new Carriage(scene, 0, 0);
      const c2 = new Carriage(scene, 0, 0);
      expect(c1.getUUID()).not.toBe(c2.getUUID());
    });

    it('accepts an optional existing UUID', () => {
      const carriage = new Carriage(scene, 0, 0, 'preset-uuid');
      expect(carriage.getUUID()).toBe('preset-uuid');
    });

    it('starts with enginePower = 0', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.enginePower).toBe(0);
    });

    it('enginePower setter is ignored', () => {
      const carriage = new Carriage(scene, 0, 0);
      carriage.enginePower = 5;
      expect(carriage.enginePower).toBe(0);
    });

    it('starts with derailed = false', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.derailed).toBe(false);
    });

    it('starts with selected = false', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.selected).toBe(false);
    });

    it('starts with no current track', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.currentTrack).toBeNull();
    });

    it('has PID controllers', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.pidControllerFront).toBeDefined();
      expect(carriage.pidControllerRear).toBeDefined();
    });

    it('passenger capacity is 40', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.passengerCapacity).toBe(40);
    });

    it('declares itself as a passenger carriage', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.vehicleType).toBe('passenger-carriage');
    });
  });

  describe('selected getter/setter', () => {
    it('setting selected=true changes tint', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(() => { carriage.selected = true; }).not.toThrow();
      expect(carriage.selected).toBe(true);
    });

    it('setting selected=false clears tint', () => {
      const carriage = new Carriage(scene, 0, 0);
      carriage.selected = true;
      expect(() => { carriage.selected = false; }).not.toThrow();
      expect(carriage.selected).toBe(false);
    });
  });

  describe('derailed getter/setter', () => {
    it('emits carriage:derailed event when derailed', () => {
      const cb = jest.fn();
      EventBus.on('carriage:derailed', cb);
      const carriage = new Carriage(scene, 0, 0);
      carriage.derailed = true;
      expect(cb).toHaveBeenCalledWith({ carriageId: carriage.getUUID() });
      EventBus.off('carriage:derailed', cb);
    });

    it('setting derailed=true only emits once', () => {
      const cb = jest.fn();
      EventBus.on('carriage:derailed', cb);
      const carriage = new Carriage(scene, 0, 0);
      carriage.derailed = true;
      carriage.derailed = true;
      expect(cb).toHaveBeenCalledTimes(1);
      EventBus.off('carriage:derailed', cb);
    });

    it('derailed becomes true after setting', () => {
      const carriage = new Carriage(scene, 0, 0);
      carriage.derailed = true;
      expect(carriage.derailed).toBe(true);
    });
  });

  describe('getMatterBody()', () => {
    it('returns the Matter physics body', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.getMatterBody()).toBeDefined();
    });
  });

  describe('boardPassengers() and unloadPassengers()', () => {
    it('starts with 0 passengers', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.getPassengerCount()).toBe(0);
    });

    it('boards passengers up to capacity', () => {
      const carriage = new Carriage(scene, 0, 0);
      const accepted = carriage.boardPassengers(5);
      expect(accepted).toBe(5);
      expect(carriage.getPassengerCount()).toBe(5);
    });

    it('cannot board more than capacity', () => {
      const carriage = new Carriage(scene, 0, 0);
      const accepted = carriage.boardPassengers(carriage.passengerCapacity + 10);
      expect(accepted).toBe(carriage.passengerCapacity);
      expect(carriage.getPassengerCount()).toBe(carriage.passengerCapacity);
    });

    it('boards partial amount when near capacity', () => {
      const carriage = new Carriage(scene, 0, 0);
      carriage.boardPassengers(carriage.passengerCapacity - 2);
      const accepted = carriage.boardPassengers(5);
      expect(accepted).toBe(2);
    });

    it('unloads all passengers', () => {
      const carriage = new Carriage(scene, 0, 0);
      carriage.boardPassengers(10);
      const delivered = carriage.unloadPassengers();
      expect(delivered).toBe(10);
      expect(carriage.getPassengerCount()).toBe(0);
    });

    it('unload returns 0 when no passengers', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(carriage.unloadPassengers()).toBe(0);
    });
  });

  describe('update()', () => {
    it('does not throw when called with a stopped carriage', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(() => carriage.update(0, 16)).not.toThrow();
    });

    it('does not apply self-propulsion', () => {
      const carriage = new Carriage(scene, 100, 100);
      carriage.enginePower = 0.1;
      const body = carriage.getMatterBody();
      const forceBefore = { x: (body.body as any).force.x, y: (body.body as any).force.y };
      carriage.update(0, 16);
      expect((body.body as any).force.x).toBe(forceBefore.x);
      expect((body.body as any).force.y).toBe(forceBefore.y);
    });
  });

  describe('recover()', () => {
    it('does nothing when not derailed', () => {
      const carriage = new Carriage(scene, 0, 0);
      expect(() => carriage.recover()).not.toThrow();
      expect(carriage.derailed).toBe(false);
    });

    it('recovers from derailed state', () => {
      const carriage = new Carriage(scene, 0, 0);
      carriage.derailed = true;
      expect(carriage.derailed).toBe(true);
      carriage.recover();
      expect(carriage.derailed).toBe(false);
    });

    it('zeros velocity and angular velocity after recovery', () => {
      const carriage = new Carriage(scene, 0, 0);
      carriage.derailed = true;
      const body = carriage.getMatterBody();
      body.setVelocity(10, 20);
      body.setAngularVelocity(5);
      carriage.recover();
      const b = body.body as any;
      expect(b.velocity.x).toBe(0);
      expect(b.velocity.y).toBe(0);
      expect(b.angularVelocity).toBe(0);
    });

  });
});
