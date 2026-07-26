const { makeScene } = require('../../__mocks__/phaser');
const Phaser = require('phaser');

import { PhaserCabSnapshotSource } from '../../src/cab3d/adapters/PhaserCabSnapshotSource';
import { GameConfig } from '../../src/config/GameConfig';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator';
import type TrackManager from '../../src/managers/TrackManager';
import type { TrainManager } from '../../src/managers/TrainManager';
import type { BiomeType } from '../../src/cab3d/model/CabWorldSnapshot';
import RailTrack from '../../src/entities/RailTrack';

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
        body: { position: { x, y }, velocity: { x: vx, y: vy } },
      }),
      enginePower,
      derailed,
      currentTrack,
    };
  }

  function createSource(
    selectedTrain: unknown,
    seed = 's1',
    biome: BiomeType = 'arid',
  ): PhaserCabSnapshotSource {
    return new PhaserCabSnapshotSource(
      {} as any,
      {} as TrackManager,
      { selectedTrain } as unknown as TrainManager,
      {} as TerrainGenerator,
      seed,
      biome,
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
    const source = createSource(train, 's1', 'temperate');
    // Use delta = 1000 ms so 10 units/frame * 1000/1000 = 10 m/s.
    const result = source.capture(1000, 1000);

    expect(result.valid).toBe(true);
    expect(result.seed).toBe('s1');
    expect(result.biome).toBe('temperate');
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
    const result = source.capture(0, 1000);

    expect(result.vehicle!.speedMps).toBe(30);
    expect(result.vehicle!.throttle).toBe(-1);
  });

  it('reports off-track when the train has no current track', () => {
    const train = createTrain({ currentTrack: null });
    const source = createSource(train);
    const result = source.capture(0, 1000);

    expect(result.vehicle!.onTrack).toBe(false);
  });

  it('reports derailed and clamps throttle outside [-1, 1]', () => {
    const train = createTrain({
      derailed: true,
      enginePower: GameConfig.TRAIN.ENGINE_POWER * 5,
    });
    const source = createSource(train);
    const result = source.capture(0, 1000);

    expect(result.vehicle!.derailed).toBe(true);
    expect(result.vehicle!.onTrack).toBe(false);
    expect(result.vehicle!.throttle).toBe(1);
  });

  it('builds a sampled path when the train is on a real RailTrack', () => {
    const scene = makeScene();
    const p0 = new Phaser.Math.Vector2(0, 0);
    const p1 = new Phaser.Math.Vector2(166, 0);
    const p2 = new Phaser.Math.Vector2(333, 0);
    const p3 = new Phaser.Math.Vector2(500, 0);
    const track = new RailTrack(scene, p0, p1, p2, p3);
    track.setConstructionData(
      { profileVersion: 1, knots: [{ t: 0, elevation: 0 }, { t: 1, elevation: 10 }] },
      [],
      0,
    );

    const train = createTrain({ x: 250, y: 0, rotation: 0, currentTrack: track });
    const terrain = new TerrainGenerator('s1');
    const source = new PhaserCabSnapshotSource(
      scene,
      {} as TrackManager,
      { selectedTrain: train } as unknown as TrainManager,
      terrain,
      's1',
      'arid',
    );
    const result = source.capture(1000, 1000);

    expect(result.path.length).toBeGreaterThan(0);
    const atEye = result.path.find((s) => s.distance === 0);
    expect(atEye).toBeDefined();
    expect(atEye!.x).toBeCloseTo(250, 1);
    expect(atEye!.elevation).toBeCloseTo(5, 1);
    expect(result.vehicle!.onTrack).toBe(true);
  });
});
