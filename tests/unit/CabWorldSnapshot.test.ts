import {
  INVALID_SNAPSHOT,
  type CabWorldSnapshot,
} from '../../src/cab3d/model/CabWorldSnapshot';

describe('CabWorldSnapshot', () => {
  it('exports an invalid sentinel snapshot', () => {
    expect(INVALID_SNAPSHOT.valid).toBe(false);
    expect(INVALID_SNAPSHOT.vehicle).toBeNull();
    expect(INVALID_SNAPSHOT.path).toEqual([]);
    expect(INVALID_SNAPSHOT.biome).toBe('temperate');
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
});
