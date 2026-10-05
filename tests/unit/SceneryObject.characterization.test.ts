import { SceneryObject } from '../../src/entities/SceneryObject';
import type { SceneryObjectDef, SceneryType } from '../../src/config/WorldData';

const { makeScene } = require('../../__mocks__/phaser');

function drawingSurface() {
  const surface: Record<string, jest.Mock> = {};
  for (const method of [
    'fillStyle', 'fillRect', 'fillEllipse', 'fillTriangle', 'fillPoints',
    'lineStyle', 'beginPath', 'moveTo', 'lineTo', 'strokePath', 'strokeEllipse',
  ]) {
    surface[method] = jest.fn(() => surface);
  }
  return surface;
}

function definition(type: SceneryType, variant = 1): SceneryObjectDef {
  return {
    id: `fixture-${type}`,
    type,
    x: 120,
    y: 340,
    rotation: Math.PI / 5,
    scale: 1.25,
    variant,
  };
}

describe('SceneryObject rendering contract', () => {
  it('preserves authored transforms with a bounded overhead layer below the train fleet', () => {
    const scene = makeScene();
    const gfx = drawingSurface();
    scene.add.graphics.mockReturnValue(gfx);

    const object = new SceneryObject(scene, definition('tree_oak'));

    expect(scene.add.existing).toHaveBeenCalledWith(object);
    expect((object as any)._children).toContain(gfx);
    expect(object).toMatchObject({
      x: 120,
      y: 340,
      rotation: Math.PI / 5,
      _depth: 20.034,
      displayWidth: 125,
      displayHeight: 62.5,
    });
  });

  it.each(['tree_oak', 'tree_pine', 'tree_birch', 'tree_dead', 'rock_boulder', 'rock_outcrop',
    'rock_cluster', 'terrain_pond', 'terrain_cliff', 'terrain_mound'] as SceneryType[])(
    'draws %s without standing side-view tree triangles',
    (type) => {
      const scene = makeScene();
      const gfx = drawingSurface();
      scene.add.graphics.mockReturnValue(gfx);

      new SceneryObject(scene, definition(type));

      expect(gfx.fillStyle).toHaveBeenCalled();
      expect(gfx.fillTriangle).not.toHaveBeenCalled();
    },
  );

  it('keeps the tree shadow in the same world direction under authored rotation and scale', () => {
    for (const rotation of [0, Math.PI / 2, Math.PI]) {
      const scene = makeScene(), gfx = drawingSurface();
      scene.add.graphics.mockReturnValue(gfx);
      new SceneryObject(scene, { ...definition('tree_oak'), rotation, scale: 2 });
      const [sx, sy] = gfx.fillEllipse.mock.calls[1];
      const worldX = 2 * (sx * Math.cos(rotation) - sy * Math.sin(rotation));
      const worldY = 2 * (sx * Math.sin(rotation) + sy * Math.cos(rotation));
      expect(worldX).toBeCloseTo(8);
      expect(worldY).toBeCloseTo(10);
    }
  });
});
