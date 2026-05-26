import { GameConfig } from '../../src/config/GameConfig';
import { LEVELS } from '../../src/config/LevelData';

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
