import {
  CascadedShadowGenerator,
  ShadowGenerator,
  type AbstractMesh,
} from '@babylonjs/core';
import { CabShadowManager } from '../../src/cab3d/renderer/CabShadowManager';
import { CabConfig } from '../../src/cab3d/CabConfig';

describe('CabShadowManager', () => {
  let scene: any;
  let camera: any;
  let light: any;
  let manager: CabShadowManager;

  function makeMesh(): AbstractMesh {
    return { receiveShadows: false } as any;
  }

  beforeEach(() => {
    scene = {};
    camera = {};
    light = {};
    manager = new CabShadowManager(scene, camera);
  });

  afterEach(() => {
    manager.dispose();
  });

  it('can be constructed without creating a generator', () => {
    expect(manager).toBeDefined();
  });

  it('creates a configured CascadedShadowGenerator on attach', () => {
    manager.attach(light);

    const generator = (manager as any).generator as CascadedShadowGenerator;
    expect(generator).toBeDefined();
    expect(generator).toBeInstanceOf(CascadedShadowGenerator);
    expect(generator.numCascades).toBe(CabConfig.SHADOW_CASCADES);
    expect(generator.shadowMaxZ).toBe(CabConfig.SHADOW_MAX_Z_M);
    expect(generator.lambda).toBe(CabConfig.SHADOW_LAMBDA);
    expect(generator.usePercentageCloserFiltering).toBe(true);
    expect(generator.filteringQuality).toBe(ShadowGenerator.QUALITY_MEDIUM);
  });

  it('adds and removes shadow casters on sync', () => {
    manager.attach(light);
    const generator = (manager as any).generator as CascadedShadowGenerator;

    const rail = makeMesh();
    const sleeper = makeMesh();
    const tree = makeMesh();

    manager.sync([rail, sleeper], [tree]);
    expect(generator.addShadowCaster).toHaveBeenCalledWith(rail, true);
    expect(generator.addShadowCaster).toHaveBeenCalledWith(sleeper, true);
    expect(generator.addShadowCaster).toHaveBeenCalledWith(tree, true);
    expect(rail.receiveShadows).toBe(true);
    expect(sleeper.receiveShadows).toBe(true);
    expect(tree.receiveShadows).toBe(true);

    manager.sync([rail], []);
    expect(generator.removeShadowCaster).toHaveBeenCalledWith(sleeper);
    expect(generator.removeShadowCaster).toHaveBeenCalledWith(tree);
  });

  it('is safe to dispose without attach', () => {
    expect(() => manager.dispose()).not.toThrow();
  });

  it('removes all casters and disposes the generator on dispose', () => {
    manager.attach(light);
    const generator = (manager as any).generator as CascadedShadowGenerator;
    const mesh = makeMesh();
    manager.sync([mesh], []);

    manager.dispose();
    expect(generator.removeShadowCaster).toHaveBeenCalledWith(mesh);
    expect(generator.dispose).toHaveBeenCalled();
  });
});
