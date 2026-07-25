import { GameConfig } from '../../src/config/GameConfig';
import { LEVELS } from '../../src/config/LevelData';
import { createEmptyWorld, validateWorldData } from '../../src/config/WorldData';
import { makeStarterOpportunity } from '../fixtures/StarterOpportunityFixture';

describe('GameConfig', () => {
  it('has valid resolution settings', () => {
    expect(GameConfig.RESOLUTION.WIDTH).toBe(1920);
    expect(GameConfig.RESOLUTION.HEIGHT).toBe(1080);
  });

  it('has valid camera configuration', () => {
    expect(GameConfig.CAMERA.MIN_ZOOM).toBeLessThan(GameConfig.CAMERA.MAX_ZOOM);
    expect(GameConfig.CAMERA.ZOOM_AMOUNT).toBeGreaterThan(0);
    expect(GameConfig.CAMERA.MAX_SPEED).toBeGreaterThan(0);
  });

  it('has no gravity (top-down game)', () => {
    expect(GameConfig.PHYSICS.GRAVITY_Y).toBe(0);
  });

  it('has valid train settings', () => {
    expect(GameConfig.TRAIN.REALISTIC_MASS_KG).toBeGreaterThan(0);
    expect(GameConfig.TRAIN.MAX_ACCELERATION_MPS2).toBeGreaterThan(0);
    expect(GameConfig.TRAIN.DEFAULT_MASS).toBeGreaterThan(0);
    expect(GameConfig.TRAIN.ENGINE_POWER).toBeGreaterThan(0);
    expect(GameConfig.TRAIN.SCALE_X).toBeGreaterThan(0);
    expect(GameConfig.TRAIN.SCALE_Y).toBeGreaterThan(0);
  });

  it('has valid track configuration', () => {
    expect(GameConfig.TRACK.RAIL_TRACK_WIDTH).toBeGreaterThan(0);
    expect(GameConfig.TRACK.SCALE).toBeGreaterThan(0);
    expect(GameConfig.TRACK.MAX_CLOSE_DISTANCE).toBeGreaterThan(0);
  });

  it('has valid junction angles', () => {
    expect(GameConfig.JUNCTION.LEFT_ANGLE_DEG).toBeLessThan(0);
    expect(GameConfig.JUNCTION.RIGHT_ANGLE_DEG).toBeGreaterThan(0);
    expect(GameConfig.JUNCTION.LENGTH).toBeGreaterThan(0);
  });

  it('has valid PID coefficients', () => {
    expect(GameConfig.PID.KP).toBeGreaterThan(0);
    expect(GameConfig.PID.KI).toBeGreaterThanOrEqual(0);
    expect(GameConfig.PID.KD).toBeGreaterThan(0);
  });

  it('has valid audio volumes between 0 and 1', () => {
    expect(GameConfig.AUDIO.BGM_VOLUME).toBeGreaterThan(0);
    expect(GameConfig.AUDIO.BGM_VOLUME).toBeLessThanOrEqual(1);
    expect(GameConfig.AUDIO.SFX_VOLUME).toBeGreaterThan(0);
    expect(GameConfig.AUDIO.SFX_VOLUME).toBeLessThanOrEqual(1);
  });

  it('has a non-empty SAVE_KEY', () => {
    expect(GameConfig.SAVE_KEY).toBeTruthy();
  });

  it('has valid track generation parameters', () => {
    expect(GameConfig.GENERATION.MAIN.SECTIONS).toBeGreaterThan(0);
    expect(GameConfig.GENERATION.MAIN.MIN_LENGTH).toBeLessThan(GameConfig.GENERATION.MAIN.MAX_LENGTH);
    expect(GameConfig.GENERATION.BRANCH.SECTIONS).toBeGreaterThan(0);
  });

  it('DEBUG flag is a boolean', () => {
    expect(typeof GameConfig.DEBUG).toBe('boolean');
  });

  // ── WORLD section ──────────────────────────────────────────────────────────

  it('has a positive WORLD.CHUNK_SIZE', () => {
    expect(GameConfig.WORLD.CHUNK_SIZE).toBeGreaterThan(0);
  });

  it('has a positive WORLD.MAX_UNDO_STEPS', () => {
    expect(GameConfig.WORLD.MAX_UNDO_STEPS).toBeGreaterThan(0);
  });

  it('has a positive WORLD.SNAP_GRID_SIZE', () => {
    expect(GameConfig.WORLD.SNAP_GRID_SIZE).toBeGreaterThan(0);
  });

  it('has MAX_CURVE_TOLERANCE_DEG in (0, 90]', () => {
    expect(GameConfig.WORLD.MAX_CURVE_TOLERANCE_DEG).toBeGreaterThan(0);
    expect(GameConfig.WORLD.MAX_CURVE_TOLERANCE_DEG).toBeLessThanOrEqual(90);
  });

  it('has a non-empty WORLD.WORLDS_SAVE_KEY', () => {
    expect(GameConfig.WORLD.WORLDS_SAVE_KEY).toBeTruthy();
  });

  it('has a positive WORLD.AUTO_SAVE_INTERVAL_SECS', () => {
    expect(GameConfig.WORLD.AUTO_SAVE_INTERVAL_SECS).toBeGreaterThan(0);
  });

  // ── TOOLS section ──────────────────────────────────────────────────────────

  it('has a positive TOOLS.COMPLETER_SEARCH_BUDGET', () => {
    expect(GameConfig.TOOLS.COMPLETER_SEARCH_BUDGET).toBeGreaterThan(0);
  });

  it('has a positive TOOLS.JUNCTION_OPTIMISATION_ITERATIONS', () => {
    expect(GameConfig.TOOLS.JUNCTION_OPTIMISATION_ITERATIONS).toBeGreaterThan(0);
  });

  it('has a positive TOOLS.JUNCTION_SAMPLE_POINTS', () => {
    expect(GameConfig.TOOLS.JUNCTION_SAMPLE_POINTS).toBeGreaterThan(0);
  });

  it('has a positive TOOLS.COMPLETER_SAMPLE_RESOLUTION', () => {
    expect(GameConfig.TOOLS.COMPLETER_SAMPLE_RESOLUTION).toBeGreaterThan(0);
  });

  it('has TOOLS.GHOST_ALPHA in (0, 1]', () => {
    expect(GameConfig.TOOLS.GHOST_ALPHA).toBeGreaterThan(0);
    expect(GameConfig.TOOLS.GHOST_ALPHA).toBeLessThanOrEqual(1);
  });
});

describe('LevelData', () => {
  it('exports a non-empty array of levels', () => {
    expect(LEVELS.length).toBeGreaterThan(0);
  });

  it('each level has a unique id', () => {
    const ids = LEVELS.map((l) => l.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('first level is unlocked', () => {
    expect(LEVELS[0].locked).toBe(false);
  });

  it('each level has at least one station', () => {
    LEVELS.forEach((level) => {
      expect(level.stations.length).toBeGreaterThan(0);
    });
  });

  it('each level has at least one objective', () => {
    LEVELS.forEach((level) => {
      expect(level.objectives.length).toBeGreaterThan(0);
    });
  });

  it('station trackT values are in [0, 1]', () => {
    LEVELS.forEach((level) => {
      level.stations.forEach((station) => {
        expect(station.trackT).toBeGreaterThanOrEqual(0);
        expect(station.trackT).toBeLessThanOrEqual(1);
      });
    });
  });

  it('delivery objectives have a targetStationId', () => {
    LEVELS.forEach((level) => {
      level.objectives
        .filter((o) => o.type === 'delivery')
        .forEach((o) => {
          expect(o.targetStationId).toBeTruthy();
        });
    });
  });

  it('timed objectives have a timeLimitSecs', () => {
    LEVELS.forEach((level) => {
      level.objectives
        .filter((o) => o.type === 'timed')
        .forEach((o) => {
          expect(o.timeLimitSecs).toBeGreaterThan(0);
        });
    });
  });

  it('all objectives have a positive scoreReward', () => {
    LEVELS.forEach((level) => {
      level.objectives.forEach((o) => {
        expect(o.scoreReward).toBeGreaterThan(0);
      });
    });
  });

  it('all levels have a seed string', () => {
    LEVELS.forEach((level) => {
      expect(typeof level.seed).toBe('string');
      expect(level.seed.length).toBeGreaterThan(0);
    });
  });

  it('passenger spawn rates are positive', () => {
    LEVELS.forEach((level) => {
      level.stations.forEach((station) => {
        expect(station.passengerSpawnRate).toBeGreaterThan(0);
      });
    });
  });
});

describe('WorldData current-schema validation', () => {
  it('rejects a vehicle without a type instead of backfilling it', () => {
    const world = createEmptyWorld(
      'Current world',
      'current-seed',
      'temperate',
      makeStarterOpportunity('current-seed'),
    );
    (world.trains as any) = [{
        id: 'legacy-train',
        trackUUID: 'track-1',
        trackT: 0.5,
        passengers: 4,
    }];
    const result = validateWorldData(world);

    expect(result.compatible).toBe(false);
    expect(world.trains[0].type).toBeUndefined();
  });

  it('preserves an explicit passenger carriage type', () => {
    const world = createEmptyWorld(
      'Current world',
      'current-seed',
      'temperate',
      makeStarterOpportunity('current-seed'),
    );
    world.trains = [{
        id: 'carriage-1',
        trackUUID: 'track-1',
        trackT: 0.5,
        passengers: 8,
        type: 'passenger-carriage',
    }];
    const result = validateWorldData(world);

    expect(result.compatible).toBe(true);
    expect(world.trains[0].type).toBe('passenger-carriage');
  });
});
