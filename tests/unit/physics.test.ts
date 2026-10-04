import { matterScaling } from '../../src/utils/physics';

describe('matterScaling()', () => {
  const { makeScene, MatterImage } = require('../../__mocks__/phaser');

  it('replaces the Matter body at the requested display scale', () => {
    const scene = makeScene();
    const object = new MatterImage(scene, 100, 200, 'train');
    const originalBody = object.body;

    matterScaling(object as any, 0.5, 0.75);

    expect(scene.matter.world.remove).toHaveBeenCalledWith(originalBody);
    expect(object.body).not.toBe(originalBody);
    expect(object.displayWidth).toBe(50);
    expect(object.displayHeight).toBe(37.5);
  });

  it('preserves collision-relevant body options and clears stale force', () => {
    const scene = makeScene();
    const object = new MatterImage(scene, 0, 0, 'train');
    object.body.isStatic = true;
    object.body.friction = 0.1;
    object.body.restitution = 0.5;
    object.body.frictionAir = 0.025;

    matterScaling(object as any, 1, 1);

    expect(object.body).toMatchObject({
      isStatic: true,
      friction: 0.1,
      restitution: 0.5,
      frictionAir: 0.025,
      force: { x: 0, y: 0 },
    });
  });
});
