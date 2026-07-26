import {
  INVALID_SNAPSHOT,
  type CabWorldSnapshot,
} from '../../src/cab3d/model/CabWorldSnapshot';

describe('CabWorldSnapshot', () => {
  it('exports an invalid sentinel snapshot', () => {
    expect(INVALID_SNAPSHOT.valid).toBe(false);
    expect(INVALID_SNAPSHOT.vehicle).toBeNull();
    expect(INVALID_SNAPSHOT.path).toEqual([]);
    expect(INVALID_SNAPSHOT.scenery).toEqual([]);
    expect(INVALID_SNAPSHOT.biome).toBe('temperate');
    expect(INVALID_SNAPSHOT.deterministic).toBe(false);
  });

  it('produces immutable snapshot objects', () => {
    const snapshot: CabWorldSnapshot = {
      valid: true,
      seed: 's1',
      biome: 'arid',
      vehicle: null,
      path: [],
      elapsedSecs: 12.5,
    };
    const frozen = Object.freeze(snapshot);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen.biome).toBe('arid');
  });

  it('carries a deterministic flag', () => {
    const snapshot: CabWorldSnapshot = {
      valid: true,
      seed: 's1',
      biome: 'arid',
      vehicle: null,
      path: [],
      deterministic: true,
      elapsedSecs: 0,
    };
    expect(snapshot.deterministic).toBe(true);
  });

  it('supports an optional scenery array', () => {
    const snapshot: CabWorldSnapshot = {
      valid: true,
      seed: 's1',
      biome: 'temperate',
      vehicle: null,
      path: [],
      scenery: Object.freeze([
        {
          id: 's1',
          type: 'tree_oak',
          x: 10,
          y: 20,
          rotation: 1,
          scale: 0.8,
          variant: 0,
        },
      ]),
      elapsedSecs: 0,
    };
    expect(snapshot.scenery).toHaveLength(1);
    expect(snapshot.scenery![0].type).toBe('tree_oak');
  });
});
