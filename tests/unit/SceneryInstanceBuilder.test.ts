import {
  buildSceneryMatrixBuffers,
  computeSceneryMatrixFloats,
} from '../../src/cab3d/world/SceneryMatrices';
import type { SceneryObjectDef } from '../../src/cab3d/model/CabWorldSnapshot';

/**
 * SceneryInstanceBuilder cannot load Babylon in a jsdom test environment, so
 * these tests exercise the pure matrix helper that builds the Float32Array
 * buffers consumed by the builder's `thinInstanceSetBuffer` calls.
 */

describe('SceneryInstanceBuilder matrix helper', () => {
  const getHeightAt = jest.fn().mockReturnValue(5);

  beforeEach(() => {
    getHeightAt.mockClear();
  });

  function makeDef(overrides: Partial<SceneryObjectDef> = {}): SceneryObjectDef {
    return {
      id: 's1',
      type: 'tree_oak',
      x: 10,
      y: -20,
      rotation: 0,
      scale: 1,
      variant: 0,
      ...overrides,
    } as SceneryObjectDef;
  }

  it('builds a 16-float matrix for a single scenery instance', () => {
    const def = makeDef();
    const floats = computeSceneryMatrixFloats(def, getHeightAt);

    expect(floats).toHaveLength(16);
    expect(getHeightAt).toHaveBeenCalledWith(10, -20);

    // translation column
    expect(floats[12]).toBe(10);   // world x
    expect(floats[13]).toBe(5);    // terrain height
    expect(floats[14]).toBe(20);   // -world y
  });

  it('applies scale and a negative world rotation as Babylon yaw', () => {
    const def = makeDef({ rotation: Math.PI / 2, scale: 2 });
    const floats = computeSceneryMatrixFloats(def, getHeightAt);

    // yaw = -PI/2 -> cos ~ 0, sin = -1
    expect(floats[0]).toBeCloseTo(0, 5);
    expect(floats[2]).toBeCloseTo(2, 5);   // -scale * sin(-PI/2) = 2
    expect(floats[8]).toBeCloseTo(-2, 5);  // scale * sin(-PI/2) = -2
    expect(floats[10]).toBeCloseTo(0, 5);
  });

  it('groups matrices by scenery type', () => {
    const scenery: SceneryObjectDef[] = [
      makeDef({ id: 'a', type: 'tree_oak' }),
      makeDef({ id: 'b', type: 'tree_oak' }),
      makeDef({ id: 'c', type: 'tree_pine' }),
    ];

    const buffers = buildSceneryMatrixBuffers(scenery, getHeightAt);

    expect(buffers.size).toBe(2);
    expect(buffers.get('tree_oak')!.length).toBe(16 * 2);
    expect(buffers.get('tree_pine')!.length).toBe(16);
  });

  it('uses getHeightAt for every placement', () => {
    const scenery: SceneryObjectDef[] = [
      makeDef({ id: 'a', x: 1, y: 2 }),
      makeDef({ id: 'b', x: 3, y: 4, type: 'tree_pine' }),
    ];

    buildSceneryMatrixBuffers(scenery, getHeightAt);

    expect(getHeightAt).toHaveBeenCalledWith(1, 2);
    expect(getHeightAt).toHaveBeenCalledWith(3, 4);
  });
});
