import type { IVehicle } from '../config/VehicleTypes';
import type { TrainDef } from '../config/WorldData';

/**
 * TrainSerializer – single source of truth for converting a live vehicle
 * (Train or Carriage) to its serialised TrainDef representation.
 */
export class TrainSerializer {
  /** Convert a live vehicle to a serialisable TrainDef. Returns null if the vehicle is not on a track. */
  static toTrainDef(vehicle: IVehicle): TrainDef | null {
    const track = vehicle.currentTrack;
    if (!track) {
      return null;
    }
    const trackT = track.getTrackPosition(vehicle.getMatterBody());
    return {
      id: vehicle.getUUID(),
      trackUUID: track.getUUID(),
      trackT,
      passengers: vehicle.getPassengerCount(),
      type: vehicle.vehicleType,
    };
  }
}
