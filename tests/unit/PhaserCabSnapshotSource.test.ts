import { PhaserCabSnapshotSource } from '../../src/cab3d/adapters/PhaserCabSnapshotSource';
import { GameConfig } from '../../src/config/GameConfig';
import type { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import type TrackManager from '../../src/managers/TrackManager';
import type { TrainManager } from '../../src/managers/TrainManager';

describe('PhaserCabSnapshotSource', () => {
  function createTrain(overrides: Partial<{
    x: number;
    y: number;
    rotation: number;
    vx: number;
    vy: number;
    enginePower: number;
    derailed: boolean;
    currentTrack: unknown;
  }> = {}) {
    const {
      x = 100,
      y = 200,
      rotation = 0.5,
      vx = 10,
      vy = 0,
      enginePower = GameConfig.TRAIN.ENGINE_POWER * 0.5,
      derailed = false,
      currentTrack = {},
    } = overrides;

    return {
      getUUID: jest.fn().mockReturnValue('train-1'),
      getMatterBody: jest.fn().mockReturnValue({
        x,
        y,
        rotation,
        body: { velocity: { x: vx, y: vy } },
      }),
      enginePower,
      derailed,
      currentTrack,
    };
  }

  function createSource(selectedTrain: unknown): PhaserCabSnapshotSource {
    return new PhaserCabSnapshotSource(
      {} as any,
      {} as TrackManager,
      { selectedTrain } as unknown as TrainManager,
      {} as TerrainGenerator,
    );
  }

  it('returns INVALID_SNAPSHOT when no train is selected', () => {
    const source = createSource(null);
    const result = source.capture(0, 16);
    expect(result.valid).toBe(false);
    expect(result.vehicle).toBeNull();
    expect(result.path).toEqual([]);
  });

  it('produces a valid vehicle snapshot from the selected train', () => {
    const train = createTrain();
    const source = createSource(train);
    const result = source.capture(1000, 16);

    expect(result.valid).toBe(true);
    expect(result.vehicle).not.toBeNull();
    expect(result.vehicle!.id).toBe('train-1');
    expect(result.vehicle!.x).toBe(100);
    expect(result.vehicle!.y).toBe(200);
    expect(result.vehicle!.headingRad).toBe(0.5);
    expect(result.vehicle!.speedMps).toBe(10);
    expect(result.vehicle!.throttle).toBe(0.5);
    expect(result.vehicle!.derailed).toBe(false);
    expect(result.vehicle!.onTrack).toBe(true);
    expect(result.elapsedSecs).toBe(1);
  });

  it('computes speed and throttle from the physics body', () => {
    const train = createTrain({
      vx: 0,
      vy: -30,
      enginePower: -GameConfig.TRAIN.ENGINE_POWER,
    });
    const source = createSource(train);
    const result = source.capture(0, 16);

    expect(result.vehicle!.speedMps).toBe(30);
    expect(result.vehicle!.throttle).toBe(-1);
  });

  it('reports off-track when the train has no current track', () => {
    const train = createTrain({ currentTrack: null });
    const source = createSource(train);
    const result = source.capture(0, 16);

    expect(result.vehicle!.onTrack).toBe(false);
  });

  it('reports derailed and clamps throttle outside [-1, 1]', () => {
    const train = createTrain({
      derailed: true,
      enginePower: GameConfig.TRAIN.ENGINE_POWER * 5,
    });
    const source = createSource(train);
    const result = source.capture(0, 16);

    expect(result.vehicle!.derailed).toBe(true);
    expect(result.vehicle!.onTrack).toBe(false);
    expect(result.vehicle!.throttle).toBe(1);
  });
});
