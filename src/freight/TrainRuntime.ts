import type Train from '../entities/Train';

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
}

export function captureTrainRuntime(train: Train): TrainRuntimeSnapshot {
  const body = train.getMatterBody();
  const velocity = body.body.velocity;
  const currentTrack = train.currentTrack;
  const trackT = currentTrack?.getTrackPosition(body) ?? null;
  let facing: 1 | -1 = 1;

  if (currentTrack && trackT !== null) {
    const tangent = currentTrack.getCurvePath().getTangent(trackT);
    const forwardX = Math.cos(body.rotation);
    const forwardY = Math.sin(body.rotation);
    facing = forwardX * tangent.x + forwardY * tangent.y >= 0 ? 1 : -1;
  }

  return {
    trainId: train.getUUID(),
    trackUUID: currentTrack?.getUUID() ?? null,
    trackT,
    facing,
    x: body.x,
    y: body.y,
    speedWorldUnitsPerSecond: Math.hypot(velocity.x, velocity.y) * 60,
    throttle: train.enginePower < 0 ? -1 : train.enginePower > 0 ? 1 : 0,
    derailed: train.derailed,
  };
}
