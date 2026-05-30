import { TrainSerializer } from '../../src/utils/TrainSerializer';
import type Train from '../../src/entities/Train';

describe('TrainSerializer', () => {
  describe('toTrainDef', () => {
    it('returns null when train has no currentTrack', () => {
      const train = {
        getUUID: () => 'train-1',
        currentTrack: null,
        getMatterBody: () => ({ x: 0, y: 0 }),
        getPassengerCount: () => 0,
      } as unknown as Train;

      expect(TrainSerializer.toTrainDef(train)).toBeNull();
    });

    it('serialises a train on a track with correct fields', () => {
      const train = {
        getUUID: () => 'train-abc',
        currentTrack: {
          getUUID: () => 'track-xyz',
          getTrackPosition: () => 0.75,
        },
        getMatterBody: () => ({ x: 100, y: 200 }),
        getPassengerCount: () => 12,
      } as unknown as Train;

      const def = TrainSerializer.toTrainDef(train);
      expect(def).not.toBeNull();
      expect(def!.id).toBe('train-abc');
      expect(def!.trackUUID).toBe('track-xyz');
      expect(def!.trackT).toBe(0.75);
      expect(def!.passengers).toBe(12);
    });

    it('computes trackT from the track position method', () => {
      const trackPosition = jest.fn().mockReturnValue(0.33);
      const train = {
        getUUID: () => 't1',
        currentTrack: {
          getUUID: () => 'trk1',
          getTrackPosition: trackPosition,
        },
        getMatterBody: () => ({ x: 50, y: 50 }),
        getPassengerCount: () => 0,
      } as unknown as Train;

      TrainSerializer.toTrainDef(train);
      expect(trackPosition).toHaveBeenCalledWith({ x: 50, y: 50 });
    });
  });
});
