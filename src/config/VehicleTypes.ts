import type { PIDController } from '../utils/math';
import type RailTrack from '../entities/RailTrack';

/**
 * VehicleType – discriminated union of all placeable vehicle kinds.
 *
 * New types can be added here without touching the rest of the
 * placement / simulation code (open/closed principle).
 */
export type VehicleType =
  | 'locomotive'
  | 'passenger-carriage';

/**
 * Metadata describing a vehicle type for UI and spawning.
 */
export interface VehicleTypeInfo {
  id: VehicleType;
  displayName: string;
  texture: string;
  passengerCapacity: number;
  hasEnginePower: boolean;
  defaultMassScale: number;
}

/** Registry of known vehicle types.  Ordered for UI display. */
export const VEHICLE_TYPE_REGISTRY: VehicleTypeInfo[] = [
  {
    id: 'locomotive',
    displayName: 'Locomotive',
    texture: 'train1',
    passengerCapacity: 20,
    hasEnginePower: true,
    defaultMassScale: 1.0,
  },
  {
    id: 'passenger-carriage',
    displayName: 'Passenger Carriage',
    texture: 'train1', // placeholder — distinct art can be added later
    passengerCapacity: 40,
    hasEnginePower: false,
    defaultMassScale: 0.8,
  },
];

/** Lookup a VehicleTypeInfo by its id. */
export function getVehicleTypeInfo(type: VehicleType): VehicleTypeInfo | undefined {
  return VEHICLE_TYPE_REGISTRY.find((v) => v.id === type);
}

/**
 * ITrackFollower – contract for any physics body that can ride on a RailTrack.
 *
 * Implemented by Train and Carriage so TrackFlowSolver stays polymorphic.
 */
export interface ITrackFollower {
  /** Stable discriminator used for persistence and vehicle-specific behaviour. */
  readonly vehicleType: VehicleType;

  /** Unique identifier */
  getUUID(): string;

  /** The Phaser scene this follower lives in. */
  readonly scene: Phaser.Scene;

  /** Is the follower currently off the rails? */
  derailed: boolean;

  /** The track the follower is currently aligned to (null if derailed / not yet placed). */
  currentTrack: RailTrack | null;

  /** Self-propulsion multiplier [-1 … 1].  Only locomotives set this. */
  enginePower: number;

  /** Is the follower highlighted in the editor? */
  selected: boolean;

  /** Access the underlying Matter.js image for physics queries. */
  getMatterBody(): Phaser.Physics.Matter.Image;

  /** Front PID controller for track alignment. */
  pidControllerFront: PIDController;

  /** Rear PID controller for track alignment. */
  pidControllerRear: PIDController;

  /** Debug / force-arrow graphics target. */
  debugGraphics: Phaser.GameObjects.Graphics;

  /** Reset a derailed follower back to its normal running state. */
  recover(): void;

  /** Per-frame update called by the manager. */
  update(time: number, delta: number): void;
}

/**
 * IVehicle – extends ITrackFollower with passenger-carrying semantics.
 *
 * Both Train and Carriage implement this.
 */
export interface IVehicle extends ITrackFollower {
  readonly passengerCapacity: number;
  getPassengerCount(): number;
  boardPassengers(count: number): number;
  unloadPassengers(): number;
}
