import { SceneryManager } from '../../src/managers/SceneryManager';
import { WorldManager } from '../../src/managers/WorldManager';
import type { SceneryObjectDef } from '../../src/config/WorldData';

const { makeScene } = require('../../__mocks__/phaser');

function definition(id: string, x: number, y: number): SceneryObjectDef {
  return {
    id,
    type: 'terrain_mound',
    x,
    y,
    rotation: 0,
    scale: 1,
    variant: 0,
  };
}

function moundGraphics() {
  const gfx: any = {};
  gfx.fillStyle = jest.fn(() => gfx);
  gfx.fillEllipse = jest.fn(() => gfx);
  return gfx;
}

describe('SceneryManager persistence and streaming contracts', () => {
  beforeEach(() => {
    WorldManager.reset();
    WorldManager.createNew('Scenery manager fixture', 'manager-seed');
  });

  afterEach(() => WorldManager.reset());

  it('prefers persisted placements within a chunk and procedurally fills only empty chunks', () => {
    const scene = makeScene();
    WorldManager.world!.scenery.push(
      definition('in-zero', 100, 200),
      definition('in-negative', -100, 200),
      definition('out-of-world', 9000, 200),
    );
    const manager = new SceneryManager(scene, {} as any, 'alpine', 'seed-value');
    const generate = jest.spyOn((manager as any).generator, 'generateForChunk')
      .mockReturnValue([definition('generated', 4200, 100)]);

    expect(manager.getSceneryDefsForChunk(0, 0).map((def) => def.id))
      .toEqual(['in-zero']);
    expect(generate).not.toHaveBeenCalled();

    expect(manager.getSceneryDefsForChunk(1, 0).map((def) => def.id))
      .toEqual(['generated']);
    expect(generate).toHaveBeenCalledWith(4096, 0, 'seed-value', 'alpine');

    expect(manager.getSceneryDefsForChunk(2, 0)).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('loads each visible in-bounds chunk once and avoids duplicates on a stationary update', () => {
    const scene = makeScene();
    scene.add.graphics.mockImplementation(() => moundGraphics());
    const manager = new SceneryManager(scene, {} as any, 'temperate', 'stream-seed');
    const generate = jest.spyOn((manager as any).generator, 'generateForChunk')
      .mockImplementation((chunkX: number, chunkY: number) => [
        definition(`${chunkX}:${chunkY}`, chunkX + 10, chunkY + 10),
      ]);

    manager.update(-4096, -4096, 1);

    expect(manager.activeObjectCount).toBe(16);
    expect(generate).toHaveBeenCalledTimes(16);
    expect(scene.add.existing).toHaveBeenCalledTimes(16);

    manager.update(-4096, -4096, 1);
    expect(manager.activeObjectCount).toBe(16);
    expect(generate).toHaveBeenCalledTimes(16);

    manager.destroyAll();
  });

  it('destroys objects leaving the streamed neighbourhood and clears all remaining objects', () => {
    const scene = makeScene();
    scene.add.graphics.mockImplementation(() => moundGraphics());
    const manager = new SceneryManager(scene, {} as any, 'temperate', 'stream-seed');
    jest.spyOn((manager as any).generator, 'generateForChunk')
      .mockImplementation((chunkX: number, chunkY: number) => [
        definition(`${chunkX}:${chunkY}`, chunkX + 10, chunkY + 10),
      ]);

    manager.update(-4096, -4096, Number.NaN);
    const leavingObject = (manager as any).chunkObjects.get('-2:-2')[0];
    expect(leavingObject._active).toBe(true);

    manager.update(4096, 4096, 1);
    expect(leavingObject._active).toBe(false);
    expect(manager.activeObjectCount).toBe(9);

    const remaining = Array.from((manager as any).chunkObjects.values())
      .flat() as Array<{ _active: boolean }>;
    manager.destroyAll();

    expect(manager.activeObjectCount).toBe(0);
    expect(remaining.every((object) => object._active === false)).toBe(true);
  });
});
