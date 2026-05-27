const TRAIN_REAL_MASS_KG = 180_000;
const TRAIN_MAX_ACCELERATION_MPS2 = 0.75;
const TRAIN_SIM_MASS_SCALE = 1 / 180;
const TRAIN_SIM_FORCE_SCALE = 2.6e-6;

export const GameConfig = {
  DEBUG: false,
  RESOLUTION: { WIDTH: 1920, HEIGHT: 1080 },
  CAMERA: { MIN_ZOOM: 0.1, MAX_ZOOM: 2.0, ZOOM_AMOUNT: 0.03, ACCELERATION: 0.06, DRAG: 0.0015, MAX_SPEED: 3.0 },
  PHYSICS: { GRAVITY_Y: 0, FRICTION_AIR: 0.015 },
  TRAIN: {
    REALISTIC_MASS_KG: TRAIN_REAL_MASS_KG,
    MAX_ACCELERATION_MPS2: TRAIN_MAX_ACCELERATION_MPS2,
    DEFAULT_MASS: TRAIN_REAL_MASS_KG * TRAIN_SIM_MASS_SCALE,
    ENGINE_POWER: TRAIN_REAL_MASS_KG * TRAIN_MAX_ACCELERATION_MPS2 * TRAIN_SIM_FORCE_SCALE,
    SCALE_X: 0.15,
    SCALE_Y: 0.15,
    DERAIL_SCALE: 0.4,
  },
  TRACK: {
    RAIL_TRACK_WIDTH: 866 * 0.85,
    SCALE: 0.05,
    MAX_CLOSE_DISTANCE: 100,
    /** Minimum distance advantage (px) a candidate track must have over the current track before a switch is allowed. */
    SWITCH_HYSTERESIS: 20,
    /** Minimum time (ms) that must elapse between automatic track switches to prevent rapid oscillation. */
    SWITCH_COOLDOWN_MS: 250,
    /** Minimum lateral separation (px) below which a candidate track is ignored when the train is already on a track. */
    PARALLEL_DEADBAND: 30,
    /** Minimum allowed Bézier curve radius in world-units (px). Tighter curves fail validation. */
    MIN_CURVE_RADIUS_PX: 150,
    /** Maximum angle difference (degrees) allowed at a track–track join before flagging as misaligned. */
    ALIGNMENT_ANGLE_DEG: 5,
  },
  JUNCTION: { LENGTH: 400, LEFT_ANGLE_DEG: -15, RIGHT_ANGLE_DEG: 15 },
  FORCE: { GUIDE_CONSTANT: 0.002 },
  PID: { KP: 0.5, KI: 0.0, KD: 0.7 },
  GENERATION: {
    MAIN: { SECTIONS: 4, MIN_LENGTH: 400, MAX_LENGTH: 800, CURVE_PROB: 0.4, MIN_ANGLE: 15, MAX_ANGLE: 45, SMOOTHNESS: 0.8 },
    BRANCH: { SECTIONS: 4, MIN_LENGTH: 300, MAX_LENGTH: 600, CURVE_PROB: 0.6, MIN_ANGLE: 20, MAX_ANGLE: 60, SMOOTHNESS: 0.7 }
  },
  AUDIO: { BGM_VOLUME: 0.5, SFX_VOLUME: 0.8 },
  SAVE_KEY: 'rail-sim-save',
  WORLD: {
    CHUNK_SIZE: 4096,
    MAX_UNDO_STEPS: 50,
    SNAP_GRID_SIZE: 50,
    MAX_CURVE_TOLERANCE_DEG: 60,
    WORLDS_SAVE_KEY: 'rail-sim-worlds',
    AUTO_SAVE_INTERVAL_SECS: 60,
  },
  TOOLS: {
    COMPLETER_SEARCH_BUDGET: 2000,
    JUNCTION_OPTIMISATION_ITERATIONS: 200,
    JUNCTION_SAMPLE_POINTS: 40,
    COMPLETER_SAMPLE_RESOLUTION: 20,
    GHOST_ALPHA: 0.4,
  },
  /** Procedural terrain generation parameters. */
  TERRAIN: {
    /** Total world size in world-units (centred at 0,0). */
    WORLD_WIDTH: 16384,
    WORLD_HEIGHT: 16384,
    /** Spacing between heightmap sample points in world-units. */
    SAMPLE_STEP: 128,
    /** fBm noise octaves. */
    OCTAVES: 6,
    /** Base noise frequency (higher = more tightly packed hills). */
    FREQUENCY: 0.0004,
    /** Peak terrain height in world-units (range is ±AMPLITUDE). */
    AMPLITUDE: 380,
    /** Lacunarity – frequency multiplier per octave. */
    LACUNARITY: 2.0,
    /** Persistence – amplitude multiplier per octave. */
    PERSISTENCE: 0.5,
    /** Maximum rail gradient as a percentage (rise/run × 100). */
    MAX_SLOPE_PERCENT: 2.5,
    /** Minimum vertical clearance for a tunnel (world-units above terrain). */
    MIN_TUNNEL_CLEARANCE: 50,
    /** Slope angle above which a section is considered a cliff (degrees). */
    CLIFF_SLOPE_DEG: 28,
    /** Fraction of valid Poisson-disk candidate points that become scenery objects. */
    SCENERY_DENSITY: 0.45,
    /** Number of Poisson-disk cells along each side of a chunk. */
    CHUNK_SCENERY_GRID: 20,
    /** Minimum world-unit separation between adjacent scenery objects. */
    SCENERY_MIN_DIST: 180,
    /** Number of Poisson-disk candidates tried per active point. */
    POISSON_K: 30,
    /** Height bands (height thresholds in world-units, base renderer colours). */
    BANDS: {
      WATER:    { max:   0, color: 0x1e4d7a },
      LOWLAND:  { max: 110, color: 0x3a6e2e },
      MIDLAND:  { max: 220, color: 0x5a7a3a },
      HIGHLAND: { max: 340, color: 0x7a6a50 },
      PEAK:     { max: Infinity, color: 0xd0cfc8 },
    },
    /** How many world-units around a band boundary to blend colours. */
    BAND_BLEND_RANGE: 20,
    /** Strength of ambient-occlusion darkening [0–1]. */
    AO_STRENGTH: 0.4,
    /** Sun direction for AO (normalised XY; Z=1 is "up"). */
    SUN_DIR_X: -0.6,
    SUN_DIR_Y: -0.8,
  },
} as const;
