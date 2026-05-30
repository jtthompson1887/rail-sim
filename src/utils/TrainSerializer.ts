import type Train from '../entities/Train';
import type { TrainDef } from '../config/WorldData';

/**
 * TrainSerializer – single source of truth for converting a live Train
 * to its serialised TrainDef representation (and vice-versa helpers).
 */
export class TrainSerializer {
  /** Convert a live Train to a serialisable TrainDef. Returns null if the train is not on a track. */
  static toTrainDef(train: Train): TrainDef | null {
    const track = train.currentTrack;
    if (!track) {
      return null;
    }
    const trackT = track.getTrackPosition(train.getMatterBody());
    return {
      id: train.getUUID(),
      trackUUID: track.getUUID(),
      trackT,
      passengers: train.getPassengerCount(),
    };
  }
}
