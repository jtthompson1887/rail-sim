import { GameConfig } from '../../src/config/GameConfig';
import { SceneryManager } from '../../src/managers/SceneryManager';
import { SceneryGenerator } from '../../src/systems/SceneryGenerator';

const { makeScene } = require('../../__mocks__/phaser');
const HALF_W = GameConfig.TERRAIN.WORLD_WIDTH / 2;
const CHUNK = GameConfig.WORLD.CHUNK_SIZE;

describe('finite-world scenery bounds', () => {
  it('does not generate scenery for a chunk fully outside the finite world', () => {
    const manager = new SceneryManager(makeScene(), {} as any, 'temperate', 'seed');
    const generate = jest.spyOn((manager as any).generator, 'generateForChunk');

    expect(manager.getSceneryDefsForChunk(HALF_W / CHUNK, 0)).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('filters boundary-chunk candidates before sampling terrain', () => {
    const terrain = {
      getBandAt: jest.fn().mockReturnValue('LOWLAND'),
      slopeAt: jest.fn().mockReturnValue(0),
    };
    const generator = new SceneryGenerator(terrain as any);
    jest.spyOn(generator, 'poissonDisk').mockReturnValue([
      { x: HALF_W - 1, y: 0 },
      { x: HALF_W + 1, y: 0 },
    ]);
    jest.spyOn(generator, 'pickAsset').mockReturnValue({
      type: 'tree_oak',
      preferredBands: ['LOWLAND'],
      maxSlopeDeg: 90,
      weight: 1,
      freeRotation: true,
      minScale: 1,
      maxScale: 1,
      variantCount: 1,
    } as any);
    jest.spyOn(require('phaser').Math.RandomDataGenerator.prototype, 'frac').mockReturnValue(0);

    const defs = generator.generateForChunk(HALF_W - CHUNK, 0, 'seed', 'temperate');

    expect(defs).toHaveLength(1);
    expect(defs[0].x).toBe(HALF_W - 1);
    expect(terrain.getBandAt).toHaveBeenCalledTimes(1);
    expect(terrain.getBandAt).not.toHaveBeenCalledWith(HALF_W + 1, 0);
  });
});
