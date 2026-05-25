/**
 * Tests for Station entity.
 */

import { Station } from '../../src/entities/Station';
import { EventBus } from '../../src/services/EventBus';
import type { StationDef } from '../../src/config/LevelData';
import RailTrack from '../../src/entities/RailTrack';

const { makeScene } = require('../../__mocks__/phaser');

function makeTrack(scene: any): RailTrack {
  const Phaser = require('phaser');
  const p0 = new Phaser.Math.Vector2(0, 0);
  const p1 = new Phaser.Math.Vector2(50, 0);
  const p2 = new Phaser.Math.Vector2(100, 0);
  const p3 = new Phaser.Math.Vector2(150, 0);
  return new RailTrack(scene, p0, p1, p2, p3);
}

function makeStationDef(overrides: Partial<StationDef> = {}): StationDef {
  return {
    id: 'st_test',
    name: 'Test Station',
    trackSectionIndex: 0,
    trackT: 0.5,
    passengerSpawnRate: 1, // 1 passenger per second
    ...overrides,
  };
}

describe('Station', () => {
  let scene: any;
  let track: RailTrack;

  beforeEach(() => {
    scene = makeScene();
    track = makeTrack(scene);
  });

  describe('constructor', () => {
    it('creates a Station without throwing', () => {
      expect(() => new Station(scene, makeStationDef(), track)).not.toThrow();
    });

    it('sets stationId from the def', () => {
      const station = new Station(scene, makeStationDef({ id: 'st_abc' }), track);
      expect(station.stationId).toBe('st_abc');
    });

    it('sets stationName from the def', () => {
      const station = new Station(scene, makeStationDef({ name: 'North Station' }), track);
      expect(station.stationName).toBe('North Station');
    });

    it('starts with zero waiting passengers', () => {
      const station = new Station(scene, makeStationDef(), track);
      expect(station.getWaiting()).toBe(0);
    });

    it('getTrack() returns the provided track', () => {
      const station = new Station(scene, makeStationDef(), track);
      expect(station.getTrack()).toBe(track);
    });

    it('getTrackT() returns the trackT from def', () => {
      const station = new Station(scene, makeStationDef({ trackT: 0.75 }), track);
      expect(station.getTrackT()).toBe(0.75);
    });
  });

  describe('update()', () => {
    it('spawns passengers over time', () => {
      const station = new Station(scene, makeStationDef({ passengerSpawnRate: 2 }), track);
      station.update(1000); // 1 second
      // At 2 passengers/sec, 1 second should spawn 2
      expect(station.getWaiting()).toBeGreaterThanOrEqual(1);
    });

    it('does not spawn passengers with delta=0', () => {
      const station = new Station(scene, makeStationDef({ passengerSpawnRate: 5 }), track);
      station.update(0);
      expect(station.getWaiting()).toBe(0);
    });

    it('accumulates passengers over multiple update calls', () => {
      const station = new Station(scene, makeStationDef({ passengerSpawnRate: 1 }), track);
      // Need 1000ms total for 1 passenger
      station.update(500);
      station.update(500);
      expect(station.getWaiting()).toBeGreaterThanOrEqual(1);
    });

    it('spawns multiple passengers in a long delta', () => {
      const station = new Station(scene, makeStationDef({ passengerSpawnRate: 1 }), track);
      station.update(5000); // 5 seconds → 5 passengers
      expect(station.getWaiting()).toBeGreaterThanOrEqual(5);
    });
  });

  describe('boardPassengers()', () => {
    it('returns 0 when no passengers are waiting', () => {
      const station = new Station(scene, makeStationDef(), track);
      expect(station.boardPassengers(10)).toBe(0);
    });

    it('boards available passengers', () => {
      const station = new Station(scene, makeStationDef({ passengerSpawnRate: 10 }), track);
      station.update(3000); // spawn ~30 passengers
      const boarded = station.boardPassengers(20);
      expect(boarded).toBeGreaterThan(0);
    });

    it('emits passenger:boarded event when passengers board', () => {
      const cb = jest.fn();
      EventBus.on('passenger:boarded', cb);
      const station = new Station(scene, makeStationDef({ id: 'st_emit', passengerSpawnRate: 5 }), track);
      station.update(3000); // spawn 15 passengers
      station.boardPassengers(5);
      expect(cb).toHaveBeenCalledWith({ stationId: 'st_emit', count: 5 });
      EventBus.off('passenger:boarded', cb);
    });

    it('does not emit passenger:boarded when 0 passengers board', () => {
      const cb = jest.fn();
      EventBus.on('passenger:boarded', cb);
      const station = new Station(scene, makeStationDef(), track);
      station.boardPassengers(5); // 0 waiting
      expect(cb).not.toHaveBeenCalled();
      EventBus.off('passenger:boarded', cb);
    });

    it('boards only as many as are waiting', () => {
      const station = new Station(scene, makeStationDef({ passengerSpawnRate: 1 }), track);
      station.update(3000); // ~3 passengers
      const waiting = station.getWaiting();
      const boarded = station.boardPassengers(100);
      expect(boarded).toBe(waiting);
    });

    it('reduces waiting count after boarding', () => {
      const station = new Station(scene, makeStationDef({ passengerSpawnRate: 5 }), track);
      station.update(3000);
      const before = station.getWaiting();
      station.boardPassengers(2);
      expect(station.getWaiting()).toBe(before - 2);
    });
  });

  describe('deliverPassengers()', () => {
    it('emits passenger:delivered event', () => {
      const cb = jest.fn();
      EventBus.on('passenger:delivered', cb);
      const station = new Station(scene, makeStationDef({ id: 'st_deliver' }), track);
      station.deliverPassengers(7);
      expect(cb).toHaveBeenCalledWith({ stationId: 'st_deliver', count: 7 });
      EventBus.off('passenger:delivered', cb);
    });

    it('does not emit when count is 0', () => {
      const cb = jest.fn();
      EventBus.on('passenger:delivered', cb);
      const station = new Station(scene, makeStationDef(), track);
      station.deliverPassengers(0);
      expect(cb).not.toHaveBeenCalled();
      EventBus.off('passenger:delivered', cb);
    });
  });
});
