import { worldToBabylon, worldHeadingToBabylonYaw } from '../model/CabCoordinate';
import { CabConfig } from '../CabConfig';
import { CAB_DRIVER_EYE } from '../cab/CabPartLibrary';
import { CabRideModel } from './CabRideModel';
import { CabLookController } from './CabLookController';
import type { CabWorldSnapshot, CabTrackSample, CabVehicleSnapshot } from '../model/CabWorldSnapshot';

export interface CabTransform {
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotation: {
    x: number;
    y: number;
    z: number;
  };
}

export interface CabEyeTransform extends CabTransform {
  /** Body transform (train motion without head look). */
  body: CabTransform;
}

/**
 * Cab camera rig.
 *
 * Builds the node chain bogie -> body -> head -> eye and produces a Babylon
 * position and Euler rotation.  The rig is pure: it does not touch the DOM or
 * any Babylon types.
 */
export class CabCameraRig {
  private readonly ride = new CabRideModel();
  private readonly look = new CabLookController();

  update(deltaMs: number, snapshot: CabWorldSnapshot): CabEyeTransform {
    if (!snapshot.valid || !snapshot.vehicle) {
      return this.zeroTransform();
    }

    const vehicle = snapshot.vehicle;
    const eyeDistance = CabConfig.EYE_FORWARD_OFFSET_M;
    const bogieDistance = 0;

    const eyeSample = this.interpolateSample(snapshot.path, eyeDistance)
      ?? this.fallbackSample(vehicle);
    const bogieSample = this.interpolateSample(snapshot.path, bogieDistance)
      ?? this.fallbackSample(vehicle);

    const heading = eyeSample.headingRad;
    const speed = vehicle.speedMps;
    const grade = this.computeGrade(bogieSample, eyeSample, eyeDistance);

    const rideState = this.ride.update(deltaMs, {
      elapsedSecs: snapshot.elapsedSecs,
      speedMps: speed,
      curvature: eyeSample.curvature,
      grade,
    });

    // No external look input yet; spring back to centre.
    const lookState = this.look.update(deltaMs, 0, 0);

    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);

    // Cab-local frame: +X right, +Y up, +Z forward.
    const rideX = rideState.position.x;
    const rideY = rideState.position.y;
    const rideZ = rideState.position.z;

    // Body node sits at the cab origin: rail head, track centreline, eye station.
    const bodyLocalX = rideX;
    const bodyLocalY = rideY;
    const bodyLocalZ = rideZ;

    // Eye node is offset to the driver's eye within the cab.
    const eyeLocalX = rideX + CAB_DRIVER_EYE.x;
    const eyeLocalY = rideY + CAB_DRIVER_EYE.y;
    const eyeLocalZ = rideZ + CAB_DRIVER_EYE.z;

    // Convert cab-local offsets to world (game) XY.
    const bodyWorldX = eyeSample.x + (-bodyLocalX * sinH) + (bodyLocalZ * cosH);
    const bodyWorldY = eyeSample.y + (bodyLocalX * cosH) + (bodyLocalZ * sinH);
    const bodyElevation = eyeSample.elevation + bodyLocalY;

    const eyeWorldX = eyeSample.x + (-eyeLocalX * sinH) + (eyeLocalZ * cosH);
    const eyeWorldY = eyeSample.y + (eyeLocalX * cosH) + (eyeLocalZ * sinH);
    const eyeElevation = eyeSample.elevation + eyeLocalY;

    const baseYaw = worldHeadingToBabylonYaw(cosH, sinH);

    const bodyRotation = {
      // Positive physical pitch (nose up) is a negative pitch in Babylon.
      x: -rideState.rotation.pitch,
      y: baseYaw,
      z: rideState.rotation.roll,
    };

    const rotation = {
      // Eye carries ride pitch plus look pitch.
      x: bodyRotation.x - lookState.pitch,
      // Positive look yaw (right) subtracts from the base yaw.
      y: bodyRotation.y - lookState.yaw,
      z: bodyRotation.z,
    };

    return {
      position: worldToBabylon(eyeWorldX, eyeWorldY, eyeElevation),
      rotation,
      body: {
        position: worldToBabylon(bodyWorldX, bodyWorldY, bodyElevation),
        rotation: bodyRotation,
      },
    };
  }

  private computeGrade(
    fromSample: CabTrackSample,
    toSample: CabTrackSample,
    distance: number,
  ): number {
    if (distance === 0) return 0;
    return (toSample.elevation - fromSample.elevation) / distance;
  }

  private interpolateSample(
    path: ReadonlyArray<CabTrackSample>,
    distance: number,
  ): CabTrackSample | null {
    if (path.length === 0) return null;
    if (path.length === 1) return path[0];

    if (distance <= path[0].distance) return path[0];
    const last = path[path.length - 1];
    if (distance >= last.distance) return last;

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (distance >= a.distance && distance <= b.distance) {
        const range = b.distance - a.distance;
        const t = range > 0 ? (distance - a.distance) / range : 0;
        return {
          x: lerp(a.x, b.x, t),
          y: lerp(a.y, b.y, t),
          elevation: lerp(a.elevation, b.elevation, t),
          headingRad: lerpAngle(a.headingRad, b.headingRad, t),
          curvature: lerp(a.curvature, b.curvature, t),
          structure: t < 0.5 ? a.structure : b.structure,
          distance,
        };
      }
    }

    return last;
  }

  private fallbackSample(vehicle: CabVehicleSnapshot): CabTrackSample {
    return {
      x: vehicle.x,
      y: vehicle.y,
      elevation: 0,
      headingRad: vehicle.headingRad,
      curvature: 0,
      structure: 'surface',
      distance: 0,
    };
  }

  private zeroTransform(): CabEyeTransform {
    const zero = { x: 0, y: 0, z: 0 };
    return {
      position: zero,
      rotation: zero,
      body: {
        position: zero,
        rotation: zero,
      },
    };
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return a + delta * t;
}
