export interface CouplerPhysicsConfig {
  slackMetres: number;
  stiffnessNPerMetre: number;
  dampingNsPerMetre: number;
  maxCompressionMetres: number;
  maxTensionMetres: number;
  breakForceN: number;
}

export interface DerailmentPhysicsConfig {
  warningLateralAccelerationMps2: number;
  hardLateralAccelerationMps2: number;
  warningCouplerLoadRatio: number;
  hazardPerSecondAtHardBoundary: number;
}

export interface TrainPhysicsConfig {
  fixedStepSeconds: number;
  worldUnitsPerMetre: number;
  arcSampleSpacing: number;
  bogieTolerance: number;
  transitionTolerance: number;
  rollingResistancePerKg: number;
  aerodynamicDrag: number;
  coupler: CouplerPhysicsConfig;
  derailment: DerailmentPhysicsConfig;
}

export const TRAIN_PHYSICS_CONFIG: Readonly<TrainPhysicsConfig> = Object.freeze({
  fixedStepSeconds: 1 / 120,
  worldUnitsPerMetre: 10,
  arcSampleSpacing: 4,
  bogieTolerance: 0.01,
  transitionTolerance: 0.1,
  rollingResistancePerKg: 0.01962,
  aerodynamicDrag: 6,
  coupler: {
    slackMetres: 0.08,
    stiffnessNPerMetre: 1_200_000,
    dampingNsPerMetre: 80_000,
    maxCompressionMetres: 0.35,
    maxTensionMetres: 0.45,
    breakForceN: 4_000_000,
  },
  derailment: {
    warningLateralAccelerationMps2: 4,
    hardLateralAccelerationMps2: 6,
    warningCouplerLoadRatio: 0.85,
    hazardPerSecondAtHardBoundary: 2,
  },
});
