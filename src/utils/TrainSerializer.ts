import type { IVehicle } from '../config/VehicleTypes';
import type { TrainDef } from '../config/WorldData';

/**
 * TrainSerializer – single source of truth for converting a live vehicle
 * (Train or Carriage) to its serialised TrainDef representation.
 */
export class TrainSerializer {
  /** Convert a live vehicle to a serialisable TrainDef. Returns null if the vehicle is not on a track. */
  static toTrainDef(vehicle: IVehicle): TrainDef | null {
    if (vehicle.persistedDynamics) {
      return {
        id: vehicle.getUUID(),
        passengers: vehicle.getPassengerCount(),
        type: vehicle.vehicleType,
        dynamics: { ...vehicle.persistedDynamics },
      };
    }
    const track = vehicle.currentTrack;
    if (!track) {
      return null;
    }
    const distance = track.getArcLengthIndex().distanceForPoint(vehicle.getMatterBody());
    return {
      id: vehicle.getUUID(),
      passengers: vehicle.getPassengerCount(),
      type: vehicle.vehicleType,
      dynamics: {
        mode: 'on-rail',
        trackUUID: track.getUUID(),
        distance,
        direction: 1,
        speedMps: 0,
        consistId: `consist-${vehicle.getUUID()}`,
        consistOrder: 0,
      },
    };
  }
}
