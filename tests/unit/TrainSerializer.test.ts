import { TrainSerializer } from '../../src/utils/TrainSerializer';
import type { IVehicle } from '../../src/config/VehicleTypes';
import Train from '../../src/entities/Train';

const { makeScene } = require('../../__mocks__/phaser');

describe('TrainSerializer', () => {
  describe('toTrainDef', () => {
    it('returns null when a vehicle has neither persisted dynamics nor a current track', () => {
      const train = {
        vehicleType: 'locomotive',
        getUUID: () => 'train-1',
        currentTrack: null,
        persistedDynamics: null,
        getMatterBody: () => ({ x: 0, y: 0 }),
        getPassengerCount: () => 0,
      } as unknown as IVehicle;

      expect(TrainSerializer.toTrainDef(train)).toBeNull();
    });

    it('serialises exact on-rail dynamics including consist order and speed', () => {
      const train = {
        vehicleType: 'locomotive',
        getUUID: () => 'train-abc',
        currentTrack: null,
        persistedDynamics: {
          mode: 'on-rail',
          trackUUID: 'track-xyz',
          distance: 750,
          direction: -1,
          speedMps: 18.5,
          consistId: 'express-7',
          consistOrder: 3,
        },
        getMatterBody: () => ({ x: 100, y: 200 }),
        getPassengerCount: () => 12,
      } as unknown as IVehicle;

      const def = TrainSerializer.toTrainDef(train);
      expect(def).not.toBeNull();
      expect(def!.id).toBe('train-abc');
      expect(def!.dynamics).toEqual({
        mode: 'on-rail',
        trackUUID: 'track-xyz',
        distance: 750,
        direction: -1,
        speedMps: 18.5,
        consistId: 'express-7',
        consistOrder: 3,
      });
      expect(def!.passengers).toBe(12);
      expect(def!.type).toBe('locomotive');
    });

    it('serialises exact free-body crash state without rail fields', () => {
      const train = {
        vehicleType: 'locomotive',
        getUUID: () => 't1',
        currentTrack: null,
        persistedDynamics: {
          mode: 'free-body',
          x: 50,
          y: 75,
          angleRad: 0.25,
          velocityX: 9,
          velocityY: -4,
          angularVelocityRadPerSec: 1.5,
        },
        getMatterBody: () => ({ x: 50, y: 75 }),
        getPassengerCount: () => 0,
      } as unknown as IVehicle;

      expect(TrainSerializer.toTrainDef(train)?.dynamics).toEqual({
        mode: 'free-body',
        x: 50,
        y: 75,
        angleRad: 0.25,
        velocityX: 9,
        velocityY: -4,
        angularVelocityRadPerSec: 1.5,
      });
    });

    it('serialises the declared vehicle type without constructor-name inspection', () => {
      const carriage = {
        vehicleType: 'passenger-carriage',
        getUUID: () => 'carriage-1',
        currentTrack: {
          getUUID: () => 'track-1',
          getArcLengthIndex: () => ({ distanceForPoint: () => 40 }),
        },
        persistedDynamics: null,
        getMatterBody: () => ({ x: 40, y: 50 }),
        getPassengerCount: () => 8,
      } as unknown as IVehicle;

      expect(TrainSerializer.toTrainDef(carriage)?.type).toBe('passenger-carriage');
    });

    it('serialises a concrete Train instance as a locomotive', () => {
      const train = new Train(makeScene(), 10, 20, 'concrete-train');
      train.currentTrack = {
        getUUID: () => 'track-1',
        getArcLengthIndex: () => ({ distanceForPoint: () => 50 }),
      } as any;

      expect(train.vehicleType).toBe('locomotive');
      expect(TrainSerializer.toTrainDef(train)?.type).toBe('locomotive');
    });
  });
});
