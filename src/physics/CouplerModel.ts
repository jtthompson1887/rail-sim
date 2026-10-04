import type { CouplerPhysicsConfig } from './TrainPhysicsConfig';

export interface CouplerState {
  id: string;
  leadingVehicleId: string;
  trailingVehicleId: string;
  extension: number;
  relativeSpeed: number;
  forceN: number;
  broken: boolean;
}

export interface CouplerEvaluation {
  state: CouplerState;
  forceOnLeadingN: number;
  forceOnTrailingN: number;
  brokeThisStep: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function evaluateCoupler(
  state: Readonly<CouplerState>,
  config: Readonly<CouplerPhysicsConfig>,
): CouplerEvaluation {
  if (state.broken) {
    return {
      state: { ...state, forceN: 0 },
      forceOnLeadingN: 0,
      forceOnTrailingN: 0,
      brokeThisStep: false,
    };
  }

  const workingExtension = clamp(
    state.extension,
    -config.maxCompressionMetres,
    config.maxTensionMetres,
  );
  let forceN = 0;
  if (workingExtension > config.slackMetres) {
    forceN = config.stiffnessNPerMetre * (workingExtension - config.slackMetres)
      + config.dampingNsPerMetre * state.relativeSpeed;
  } else if (workingExtension < -config.slackMetres) {
    forceN = config.stiffnessNPerMetre * (workingExtension + config.slackMetres)
      + config.dampingNsPerMetre * state.relativeSpeed;
  }

  const broken = Math.abs(forceN) > config.breakForceN;
  return {
    state: { ...state, forceN, broken },
    forceOnLeadingN: broken || forceN === 0 ? 0 : -forceN,
    forceOnTrailingN: broken || forceN === 0 ? 0 : forceN,
    brokeThisStep: broken,
  };
}
