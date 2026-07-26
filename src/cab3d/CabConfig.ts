/**
 * Frozen cab-view tunables.
 *
 * These values are duplicated in {@link ../config/GameConfig} for the public
 * `CAB3D` block that `WorldScene` reads before construction.
 */
export const CabConfig = Object.freeze({
  /** Master switch. When false the cab view host is never created. */
  ENABLED: true,

  /** Keyboard shortcut that toggles the cab view. */
  TOGGLE_KEY: 'C',

  /** Distance from the camera eye to the front bogie centre, in metres. */
  EYE_FORWARD_OFFSET_M: 8.5,

  /** Multiplier applied to the physics speed for motion effects. */
  SPEED_SCALE: 1.0,

  /** When true, random motion (grain, windscreen drops) becomes deterministic. */
  DETERMINISTIC: false,

  /** Height of the driver's eye above the rail head, in metres. */
  EYE_HEIGHT_M: 2.40,

  /** Vertical field of view of the cab camera, in degrees. */
  FOV_DEG: 50,

  /** Near clip plane for the cab camera, in metres. */
  MIN_Z: 0.15,

  /** Far clip plane for the cab camera, in metres. */
  MAX_Z: 6000,

  /** Distance ahead of the eye to sample for the track mesh, in metres. */
  FAR_DISTANCE_M: 800,

  /** Distance behind the eye to retain for the track mesh, in metres. */
  NEAR_DISTANCE_M: -120,

  /** Arc-length spacing between samples on the track path, in metres. */
  SAMPLE_SPACING_M: 2,

  /** Distance the eye must travel before the track mesh is rebuilt. */
  PATH_REBUILD_DISTANCE_M: 64,

  /** Sleeper / rail joint spacing, in metres. */
  RAIL_JOINT_SPACING_M: 18.29,
  /** Vertical impulse magnitude when a wheel crosses a rail joint. */
  RAIL_JOINT_IMPULSE_M: 0.004,
  /** Exponential decay time constant for a rail-joint impulse, in seconds. */
  RAIL_JOINT_DECAY_TAU_S: 0.09,

  /** Fundamental bounce frequency, in hertz. */
  BOUNCE_FREQ_HZ: 2.1,
  /** Fundamental bounce amplitude, in metres. */
  BOUNCE_AMP_M: 0.012,
  /** Bounce harmonic frequency, in hertz. */
  BOUNCE_HARMONIC_FREQ_HZ: 4.3,
  /** Relative amplitude of the bounce harmonic. */
  BOUNCE_HARMONIC_AMP: 0.7,

  /** Lateral sway frequency, in hertz. */
  SWAY_FREQ_HZ: 1.3,
  /** Lateral sway amplitude, in metres. */
  SWAY_AMP_M: 0.009,

  /** Curve roll coefficient: roll = factor * curvature * speed^2. */
  CURVE_ROLL_FACTOR: -0.055,
  /** Maximum curve roll, in degrees. */
  CURVE_ROLL_MAX_DEG: 2.5,
  /** Maximum grade pitch, in degrees. */
  GRADE_PITCH_MAX_DEG: 1.5,

  /** Maximum look yaw, in degrees. */
  LOOK_YAW_MAX_DEG: 120,
  /** Minimum look pitch, in degrees. */
  LOOK_PITCH_MIN_DEG: -35,
  /** Maximum look pitch, in degrees. */
  LOOK_PITCH_MAX_DEG: 25,
  /** Look-controller spring frequency, in radians per second. */
  LOOK_OMEGA: 10,
} as const);
