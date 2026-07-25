import { TrainSerializer } from '../../src/utils/TrainSerializer';
import type { IVehicle } from '../../src/config/VehicleTypes';

describe('TrainSerializer', () => {
  describe('toTrainDef', () => {
    it('returns null when train has no currentTrack', () => {
      const train = {
        vehicleType: 'locomotive',
        getUUID: () => 'train-1',
        currentTrack: null,
        getMatterBody: () => ({ x: 0, y: 0 }),
        getPassengerCount: () => 0,
      } as unknown as IVehicle;

      expect(TrainSerializer.toTrainDef(train)).toBeNull();
    });

    it('serialises a train on a track with correct fields', () => {
      const train = {
        vehicleType: 'locomotive',
        getUUID: () => 'train-abc',
        currentTrack: {
          getUUID: () => 'track-xyz',
          getTrackPosition: () => 0.75,
        },
        getMatterBody: () => ({ x: 100, y: 200 }),
        getPassengerCount: () => 12,
      } as unknown as IVehicle;

      const def = TrainSerializer.toTrainDef(train);
      expect(def).not.toBeNull();
      expect(def!.id).toBe('train-abc');
      expect(def!.trackUUID).toBe('track-xyz');
      expect(def!.trackT).toBe(0.75);
      expect(def!.passengers).toBe(12);
      expect(def!.type).toBe('locomotive');
    });

    it('computes trackT from the track position method', () => {
      const trackPosition = jest.fn().mockReturnValue(0.33);
      const train = {
        vehicleType: 'locomotive',
        getUUID: () => 't1',
        currentTrack: {
          getUUID: () => 'trk1',
          getTrackPosition: trackPosition,
        },
        getMatterBody: () => ({ x: 50, y: 50 }),
        getPassengerCount: () => 0,
      } as unknown as IVehicle;

      TrainSerializer.toTrainDef(train);
      expect(trackPosition).toHaveBeenCalledWith({ x: 50, y: 50 });
    });

    it('serialises the declared vehicle type without constructor-name inspection', () => {
      const carriage = {
        vehicleType: 'passenger-carriage',
        getUUID: () => 'carriage-1',
        currentTrack: {
          getUUID: () => 'track-1',
          getTrackPosition: () => 0.4,
        },
        getMatterBody: () => ({ x: 40, y: 50 }),
        getPassengerCount: () => 8,
      } as unknown as IVehicle;

      expect(TrainSerializer.toTrainDef(carriage)?.type).toBe('passenger-carriage');
    });
  });
});
