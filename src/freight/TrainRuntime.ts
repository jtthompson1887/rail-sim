import type Train from '../entities/Train';
import type { PersistedVehicleDynamics } from '../config/WorldData';
import { TRAIN_PHYSICS_CONFIG } from '../physics/TrainPhysicsConfig';

export interface TrainRuntimeSnapshot {
  readonly trainId: string;
  readonly trackUUID: string | null;
  readonly trackT: number | null;
  readonly facing: 1 | -1;
  readonly x: number;
  readonly y: number;
  readonly speedWorldUnitsPerSecond: number;
  readonly throttle: -1 | 0 | 1;
  readonly derailed: boolean;
  readonly dynamics?: PersistedVehicleDynamics | null;
}

export function freezeTrainRuntimeSnapshot(
  snapshot: TrainRuntimeSnapshot,
): TrainRuntimeSnapshot {
  return Object.freeze({ ...snapshot });
}

export function captureTrainRuntime(train: Train): TrainRuntimeSnapshot {
  const body = train.getMatterBody();
  const velocity = body.body.velocity;
  const currentTrack = train.currentTrack;
  const onRail = !train.derailed && train.persistedDynamics?.mode === 'on-rail' ? train.persistedDynamics : null;
  let trackT = currentTrack?.getTrackPosition(body) ?? null;
  if (onRail && currentTrack?.getUUID() === onRail.trackUUID) {
    let lo = 0; let hi = 1;
    const index = currentTrack.getArcLengthIndex();
    for (let i = 0; i < 24; i++) {
      const middle = (lo + hi) / 2;
      if (index.distanceAtParameter(middle) < onRail.distance) lo = middle; else hi = middle;
    }
    trackT = (lo + hi) / 2;
  }
  let facing: 1 | -1 = 1;

  if (currentTrack && trackT !== null) {
    const tangent = currentTrack.getCurvePath().getTangent(trackT);
    const forwardX = Math.cos(body.rotation);
    const forwardY = Math.sin(body.rotation);
    facing = forwardX * tangent.x + forwardY * tangent.y >= 0 ? 1 : -1;
  }

  return freezeTrainRuntimeSnapshot({
    trainId: train.getUUID(),
    trackUUID: currentTrack?.getUUID() ?? null,
    trackT,
    facing: onRail?.direction ?? facing,
    x: body.x,
    y: body.y,
    speedWorldUnitsPerSecond: onRail
      ? Math.abs(onRail.speedMps) * TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre
      : Math.hypot(velocity.x, velocity.y) * 60,
    throttle: train.enginePower < 0 ? -1 : train.enginePower > 0 ? 1 : 0,
    derailed: train.derailed,
    ...(train.persistedDynamics
      ? { dynamics: train.derailed ? { mode: 'free-body' as const, x: body.x, y: body.y, angleRad: body.rotation,
        velocityX: velocity.x * 60 / TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre,
        velocityY: velocity.y * 60 / TRAIN_PHYSICS_CONFIG.worldUnitsPerMetre,
        angularVelocityRadPerSec: (body.body as any).angularVelocity * 60 } : { ...train.persistedDynamics } }
      : {}),
  });
}
