import { clonePlainData, equalPlainData } from '../../src/utils/PlainData';

describe('lossless plain-data authority helpers', () => {
  it('clones Infinity, negative Infinity, NaN, and negative zero losslessly', () => {
    const source = {
      values: [Infinity, -Infinity, NaN, -0],
      nested: { finite: 42 },
    };
    const cloned = clonePlainData(source);
    expect(cloned).not.toBe(source);
    expect(cloned.nested).not.toBe(source.nested);
    expect(cloned.values[0]).toBe(Infinity);
    expect(cloned.values[1]).toBe(-Infinity);
    expect(Number.isNaN(cloned.values[2])).toBe(true);
    expect(Object.is(cloned.values[3], -0)).toBe(true);
  });

  it('distinguishes special numeric values that JSON collapses', () => {
    expect(equalPlainData({ value: Infinity }, { value: null })).toBe(false);
    expect(equalPlainData({ value: NaN }, { value: null })).toBe(false);
    expect(equalPlainData({ value: Infinity }, { value: Infinity })).toBe(true);
    expect(equalPlainData({ value: NaN }, { value: NaN })).toBe(true);
    expect(equalPlainData({ value: -0 }, { value: 0 })).toBe(false);
  });
});
