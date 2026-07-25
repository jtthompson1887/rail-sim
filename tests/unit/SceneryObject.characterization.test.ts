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
  it('adds the procedural drawing to the scene with the persisted transform and painter depth', () => {
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
      _depth: 34,
      displayWidth: 125,
      displayHeight: 62.5,
    });
  });

  it.each([
    ['tree_oak', 'fillEllipse', 3],
    ['tree_pine', 'fillTriangle', 4],
    ['tree_birch', 'fillRect', 4],
    ['tree_dead', 'strokePath', 4],
    ['rock_boulder', 'fillPoints', 1],
    ['rock_outcrop', 'fillRect', 6],
    ['rock_cluster', 'fillEllipse', 4],
    ['terrain_pond', 'strokeEllipse', 1],
    ['terrain_cliff', 'strokePath', 5],
    ['terrain_mound', 'fillEllipse', 3],
  ] as Array<[SceneryType, string, number]>)(
    'draws %s with its distinguishing primitive and variant-dependent count',
    (type, primitive, expectedCalls) => {
      const scene = makeScene();
      const gfx = drawingSurface();
      scene.add.graphics.mockReturnValue(gfx);

      new SceneryObject(scene, definition(type));

      expect(gfx[primitive]).toHaveBeenCalledTimes(expectedCalls);
    },
  );
});
