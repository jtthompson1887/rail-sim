import { degToRad } from '../model/CabCoordinate';
import { CabConfig } from '../CabConfig';

export interface CabRideParams {
  /** Elapsed simulation time in seconds. */
  readonly elapsedSecs: number;
  /** Train speed in metres per second. */
  readonly speedMps: number;
  /** Signed track curvature at the eye (1 / radius). */
  readonly curvature: number;
  /** Grade at the eye (rise over run, dimensionless). */
  readonly grade: number;
  /** Multiplier applied to the resulting position and rotation offsets. */
  readonly motionScale?: number;
}

export interface CabRideState {
  /** Local position offset, in cab-local metres (+X right, +Y up, +Z forward). */
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  /** Local rotation, in radians (+X pitch nose up, +Y yaw right, +Z roll left). */
  readonly rotation: {
    readonly roll: number;
    readonly pitch: number;
    readonly yaw: number;
  };
}

/**
 * Pure cab ride-motion model.
 *
 * Produces local position and rotation offsets for the driver's viewpoint:
 * - vertical bounce and rail-joint impulses
 * - lateral sway
 * - curve roll
 * - grade pitch
 */
export class CabRideModel {
  /** Distance travelled along the rail since construction, in metres. */
  private distanceTravelled = 0;
  /** Accumulated vertical rail-joint impulse, in metres. */
  private jointImpulse = 0;
  /** Previous integer rail-joint crossing, to detect new joints. */
  private previousJointPhase = 0;

  /**
   * Compute the next ride-state given the time step and current track params.
   *
   * @param deltaMs  Frame time in milliseconds.
   * @param params   Track and train parameters at the eye.
   */
  update(deltaMs: number, params: CabRideParams): CabRideState {
    const dt = Math.max(1, deltaMs) / 1000;
    const t = params.elapsedSecs;

    // Per-frame distance is speed in m/s * dt (s).
    const distanceDelta = params.speedMps * dt;
    this.distanceTravelled += Math.abs(distanceDelta);

    // Rail joint impulse: every 18.29 m add 0.004 m and decay with tau = 0.09 s.
    const jointSpacing = CabConfig.RAIL_JOINT_SPACING_M;
    const jointPhase = Math.floor(this.distanceTravelled / jointSpacing);
    if (jointPhase > this.previousJointPhase) {
      this.jointImpulse += CabConfig.RAIL_JOINT_IMPULSE_M;
      this.previousJointPhase = jointPhase;
    }
    this.jointImpulse *= Math.exp(-dt / CabConfig.RAIL_JOINT_DECAY_TAU_S);

    const verticalBounce =
      CabConfig.BOUNCE_AMP_M * Math.sin(2 * Math.PI * CabConfig.BOUNCE_FREQ_HZ * t)
      + CabConfig.BOUNCE_AMP_M * CabConfig.BOUNCE_HARMONIC_AMP
        * Math.sin(2 * Math.PI * CabConfig.BOUNCE_HARMONIC_FREQ_HZ * t);

    const lateralSway =
      CabConfig.SWAY_AMP_M * Math.sin(2 * Math.PI * CabConfig.SWAY_FREQ_HZ * t);

    const rollLimit = degToRad(CabConfig.CURVE_ROLL_MAX_DEG);
    const curveRoll = clamp(
      CabConfig.CURVE_ROLL_FACTOR * params.curvature * params.speedMps * params.speedMps,
      -rollLimit,
      rollLimit,
    );

    const pitchLimit = degToRad(CabConfig.GRADE_PITCH_MAX_DEG);
    const gradePitch = clamp(Math.atan(params.grade), -pitchLimit, pitchLimit);

    const scale = params.motionScale ?? 1;

    return {
      position: {
        x: lateralSway * scale,
        y: (verticalBounce + this.jointImpulse) * scale,
        z: 0,
      },
      rotation: {
        roll: curveRoll * scale,
        pitch: gradePitch * scale,
        yaw: 0,
      },
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
