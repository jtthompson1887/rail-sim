import { degToRad } from '../model/CabCoordinate';
import { CabConfig } from '../CabConfig';

export interface CabLookState {
  /** Horizontal look angle in radians (positive = right). */
  readonly yaw: number;
  /** Vertical look angle in radians (positive = up). */
  readonly pitch: number;
}

/**
 * Critically damped spring look controller.
 *
 * Yaw is clamped to +/-120 degrees and pitch is clamped between -35 and +25
 * degrees.  The spring uses the natural frequency configured in
 * {@link CabConfig.LOOK_OMEGA} with zeta = 1 for critical damping.
 */
export class CabLookController {
  private yaw = 0;
  private pitch = 0;
  private yawVelocity = 0;
  private pitchVelocity = 0;

  private readonly omega = CabConfig.LOOK_OMEGA;
  private readonly yawMax = degToRad(CabConfig.LOOK_YAW_MAX_DEG);
  private readonly pitchMin = degToRad(CabConfig.LOOK_PITCH_MIN_DEG);
  private readonly pitchMax = degToRad(CabConfig.LOOK_PITCH_MAX_DEG);

  /**
   * Step the look controller toward the requested yaw/pitch.
   *
   * @param deltaMs      Frame time in milliseconds.
   * @param targetYaw    Desired yaw in radians (positive = right).
   * @param targetPitch  Desired pitch in radians (positive = up).
   */
  update(deltaMs: number, targetYaw: number, targetPitch: number): CabLookState {
    const dt = Math.max(1, deltaMs) / 1000;

    const yawResult = this.integrateSpring(
      this.yaw,
      this.yawVelocity,
      targetYaw,
      -this.yawMax,
      this.yawMax,
      dt,
    );
    this.yaw = yawResult.position;
    this.yawVelocity = yawResult.velocity;

    const pitchResult = this.integrateSpring(
      this.pitch,
      this.pitchVelocity,
      targetPitch,
      this.pitchMin,
      this.pitchMax,
      dt,
    );
    this.pitch = pitchResult.position;
    this.pitchVelocity = pitchResult.velocity;

    return { yaw: this.yaw, pitch: this.pitch };
  }

  private integrateSpring(
    position: number,
    velocity: number,
    target: number,
    min: number,
    max: number,
    dt: number,
  ): { position: number; velocity: number } {
    // Critically damped harmonic oscillator: zeta = 1.
    const k = this.omega * this.omega;
    const d = 2 * this.omega;

    const acceleration = k * (target - position) - d * velocity;
    let newVelocity = velocity + acceleration * dt;
    let newPosition = position + newVelocity * dt;

    if (newPosition > max) {
      newPosition = max;
      newVelocity = 0;
    } else if (newPosition < min) {
      newPosition = min;
      newVelocity = 0;
    }

    return { position: newPosition, velocity: newVelocity };
  }
}
