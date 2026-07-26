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
} as const);
