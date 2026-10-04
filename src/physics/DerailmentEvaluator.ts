import type { DerailmentPhysicsConfig } from './TrainPhysicsConfig';

export interface DerailmentHazardState {
  episodeId: number;
  accumulatedHazard: number;
  seededThreshold: number;
}

export type DerailmentCause =
  | 'lateral-acceleration'
  | 'coupler-overload'
  | 'collision'
  | 'route-discontinuity';

export interface DerailmentInputs {
  speedMps: number;
  curvature: number;
  peakCouplerForceN: number;
  collisionImpulseNs: number;
  routeContinuous: boolean;
  conditionModifier: number;
}

export type DerailmentDecision =
  | { kind: 'safe'; hazard: DerailmentHazardState }
  | { kind: 'warning'; hazard: DerailmentHazardState; ratio: number }
  | { kind: 'derail'; hazard: DerailmentHazardState; cause: DerailmentCause };

function thresholdFromSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return 0.75 + ((hash >>> 0) / 0xffffffff) * 0.5;
}

export function createDerailmentHazardState(seed: string): DerailmentHazardState {
  return {
    episodeId: 0,
    accumulatedHazard: 0,
    seededThreshold: thresholdFromSeed(seed),
  };
}

function recoveredHazard(previous: Readonly<DerailmentHazardState>): DerailmentHazardState {
  if (previous.accumulatedHazard === 0) return { ...previous };
  const episodeId = previous.episodeId + 1;
  return {
    episodeId,
    accumulatedHazard: 0,
    seededThreshold: thresholdFromSeed(`${previous.seededThreshold}:${episodeId}`),
  };
}

export function evaluateDerailment(
  previous: Readonly<DerailmentHazardState>,
  inputs: Readonly<DerailmentInputs>,
  config: Readonly<DerailmentPhysicsConfig>,
  dtSeconds: number,
): DerailmentDecision {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    throw new Error('Derailment evaluation duration must be a positive finite number');
  }
  if (!Number.isFinite(inputs.conditionModifier) || inputs.conditionModifier <= 0) {
    throw new Error('Derailment condition modifier must be a positive finite number');
  }

  if (!inputs.routeContinuous) {
    return { kind: 'derail', hazard: { ...previous }, cause: 'route-discontinuity' };
  }
  const condition = inputs.conditionModifier;
  if (inputs.collisionImpulseNs >= config.hardCollisionImpulseNs * condition) {
    return { kind: 'derail', hazard: { ...previous }, cause: 'collision' };
  }
  if (inputs.peakCouplerForceN >= config.hardCouplerForceN * condition) {
    return { kind: 'derail', hazard: { ...previous }, cause: 'coupler-overload' };
  }

  const lateralAcceleration = inputs.speedMps ** 2 * Math.abs(inputs.curvature);
  const warningLateral = config.warningLateralAccelerationMps2 * condition;
  const hardLateral = config.hardLateralAccelerationMps2 * condition;
  if (lateralAcceleration >= hardLateral - 1e-12) {
    return { kind: 'derail', hazard: { ...previous }, cause: 'lateral-acceleration' };
  }

  const warningCoupler = config.hardCouplerForceN
    * config.warningCouplerLoadRatio
    * condition;
  const hardCoupler = config.hardCouplerForceN * condition;
  const lateralExposure = lateralAcceleration > warningLateral
    ? (lateralAcceleration - warningLateral) / (hardLateral - warningLateral)
    : 0;
  const couplerExposure = inputs.peakCouplerForceN > warningCoupler
    ? (inputs.peakCouplerForceN - warningCoupler) / (hardCoupler - warningCoupler)
    : 0;
  const exposure = Math.max(lateralExposure, couplerExposure);
  if (exposure <= 0) {
    return { kind: 'safe', hazard: recoveredHazard(previous) };
  }

  const hazard: DerailmentHazardState = {
    ...previous,
    accumulatedHazard: previous.accumulatedHazard
      + exposure * config.hazardPerSecondAtHardBoundary * dtSeconds,
  };
  if (hazard.accumulatedHazard >= hazard.seededThreshold) {
    return {
      kind: 'derail',
      hazard,
      cause: lateralExposure >= couplerExposure
        ? 'lateral-acceleration'
        : 'coupler-overload',
    };
  }
  return { kind: 'warning', hazard, ratio: exposure };
}
