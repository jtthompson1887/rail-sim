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

  /** Rail gauge: distance between inner faces of the rails, in metres. */
  RAIL_GAUGE_M: 1.435,
  /** Half-width of the rail head, in metres. */
  RAIL_HEAD_HALF_WIDTH_M: 0.0335,
  /** Lateral distance from track centreline to each rail centre, in metres. */
  RAIL_CENTRE_OFFSET_M: 0.7515,
  /** Width of the separate rail head cap, in metres. */
  RAIL_HEAD_CAP_WIDTH_M: 0.067,
  /** Height of the separate rail head cap, in metres. */
  RAIL_HEAD_CAP_HEIGHT_M: 0.004,
  /** Vertical centre of the rail head cap, in metres above the rail foot. */
  RAIL_HEAD_CAP_Y_M: 0.157,

  /** Sleeper length (across the track), in metres. */
  SLEEPER_LENGTH_M: 2.5,
  /** Sleeper height, in metres. */
  SLEEPER_HEIGHT_M: 0.2,
  /** Sleeper width (along the track), in metres. */
  SLEEPER_WIDTH_M: 0.25,
  /** Sleeper spacing, in metres. */
  SLEEPER_SPACING_M: 0.65,

  /** Ballast top width, in metres. */
  BALLAST_TOP_WIDTH_M: 3.6,
  /** Ballast bottom width, in metres. */
  BALLAST_BOTTOM_WIDTH_M: 5.6,
  /** Ballast depth, in metres. */
  BALLAST_DEPTH_M: 0.35,

  /** Bridge deck width, in metres. */
  BRIDGE_DECK_WIDTH_M: 5.0,
  /** Bridge deck depth, in metres. */
  BRIDGE_DECK_DEPTH_M: 0.6,
  /** Pier spacing along a bridge, in metres. */
  PIER_SPACING_M: 25.0,

  /** Tunnel bore radius, in metres. */
  TUNNEL_BORE_RADIUS_M: 3.2,

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

  /** LOD rings for the 3-D terrain mesh, innermost first. */
  TERRAIN_RINGS: [
    { extent: 1024, resolution: 8, innerExtent: 0 },
    { extent: 4096, resolution: 32, innerExtent: 1024 },
    { extent: 12288, resolution: 128, innerExtent: 4096 },
  ],

  /** Distance the eye must travel before the terrain rings are re-centred. */
  TERRAIN_REBUILD_DISTANCE_M: 64,

  /** How far the terrain skirt drops below the surface edge. */
  TERRAIN_SKIRT_DEPTH_M: 60,

  /** Water plane alpha. */
  TERRAIN_WATER_ALPHA: 0.72,

  /** Water roughness. */
  TERRAIN_WATER_ROUGHNESS: 0.08,

  /** Scrolling speed of the water normal map (UV offset per second). */
  TERRAIN_WATER_SCROLL_U: 0.02,
  TERRAIN_WATER_SCROLL_V: 0.03,

  /** Side length of the sky box, in metres. */
  SKY_BOX_SIZE_M: 10000,
  /** Overall luminance of the sky material in ]0, 1[. */
  SKY_LUMINANCE: 0.6,
  /** Amount of haze as opposed to molecules in the atmosphere. */
  SKY_TURBIDITY: 4.5,
  /** Sky appearance / light intensity. */
  SKY_RAYLEIGH: 2.0,
  /** Mie scattering coefficient in [0, 0.1]. */
  SKY_MIE_COEFFICIENT: 0.005,
  /** Amount of haze particles following the Mie scattering theory. */
  SKY_MIE_G: 0.82,

  /** Directional (sun) light intensity. */
  SUN_INTENSITY: 3.0,
  /** Hemispheric fill light intensity. */
  FILL_LIGHT_INTENSITY: 0.35,

  /** Cab-local X position of the interior point light, in metres. */
  CAB_INTERIOR_LIGHT_LOCAL_X_M: 0,
  /** Cab-local Y position of the interior point light, in metres. */
  CAB_INTERIOR_LIGHT_LOCAL_Y_M: 3.10,
  /** Cab-local Z position of the interior point light, in metres. */
  CAB_INTERIOR_LIGHT_LOCAL_Z_M: 0.20,
  /** Cab interior point light intensity. */
  CAB_INTERIOR_LIGHT_INTENSITY: 0.20,
  /** Cab interior point light range, in metres. */
  CAB_INTERIOR_LIGHT_RANGE_M: 4.0,

  /** Reflection probe resolution for image-based lighting. */
  SKY_IBL_RESOLUTION: 256,
  /** Re-render the IBL probe when the sun altitude changes by more than this many degrees. */
  SKY_IBL_ALTITUDE_THRESHOLD_DEG: 2,

  /** ACES tonemapping exposure. */
  TONEMAPPING_EXPOSURE: 1.1,
  /** ACES tonemapping contrast. */
  TONEMAPPING_CONTRAST: 1.25,

  /** Exponential-squared fog density. */
  FOG_DENSITY: 0.00022,
  /** Horizon colour used for scene fog (matches the sky horizon). */
  FOG_COLOR: Object.freeze({ r: 0.65, g: 0.75, b: 0.85 }),
} as const);
