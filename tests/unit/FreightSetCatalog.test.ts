import type { ProductDefinition } from '../../src/economy/EconomyData';
import { getProduct } from '../../src/economy/ProductCatalog';
import {
  capacityForProduct,
  FreightSetDefinition,
  FLATBED_FREIGHT_SET_ID,
  FLATBED_TRAIN_PURCHASE_PRICE,
  FREIGHT_SETS,
  getFreightSet,
  OPERATING_RESERVE,
  STARTER_ROUTE_RESERVE,
  validateFreightSetContent,
} from '../../src/freight/FreightSetCatalog';

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key];
};

type MutableFreightSetDefinition =
  Omit<Mutable<FreightSetDefinition>, 'compatibleProductIds'> & {
    compatibleProductIds: string[];
  };

const cloneFlatbedSet = (): MutableFreightSetDefinition => ({
  ...FREIGHT_SETS[0],
  compatibleProductIds: [
    ...FREIGHT_SETS[0].compatibleProductIds,
  ],
});

const logs = (): ProductDefinition => getProduct('logs')!;
const structuralTimber = (): ProductDefinition =>
  getProduct('structural-timber')!;

describe('flatbed freight set catalogue', () => {
  it('contains exactly the approved general flatbed set and reserves', () => {
    expect(FLATBED_FREIGHT_SET_ID).toBe('flatbed-freight-set');
    expect(FLATBED_TRAIN_PURCHASE_PRICE).toBe(90_000);
    expect(OPERATING_RESERVE).toBe(20_000);
    expect(STARTER_ROUTE_RESERVE).toBe(110_000);
    expect(FREIGHT_SETS).toEqual([{
      id: 'flatbed-freight-set',
      displayName: 'General Flatbed Set',
      compatibleProductIds: ['logs', 'structural-timber'],
      payloadMassKg: 60_000,
      payloadVolumeLitres: 96_000,
      purchasePrice: 90_000,
      runningCostPerActiveTick: 20,
    }]);
  });

  it.each([
    ['logs', logs],
    ['structural timber', structuralTimber],
  ])('derives the exact 60-unit %s capacity from mass and volume', (
    _description,
    product,
  ) => {
    expect(capacityForProduct(
      getFreightSet('flatbed-freight-set')!,
      product(),
    )).toEqual({ ok: true, capacityUnits: 60 });
  });

  it('returns the same immutable definition on repeated lookup', () => {
    const first = getFreightSet(FLATBED_FREIGHT_SET_ID)!;
    const second = getFreightSet(FLATBED_FREIGHT_SET_ID)!;

    expect(first).toBe(second);
    expect(first).toBe(FREIGHT_SETS[0]);
    expect(Object.isFrozen(FREIGHT_SETS)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.compatibleProductIds)).toBe(true);
    expect(() => {
      (first as any).purchasePrice = 1;
    }).toThrow(TypeError);
    expect(() => {
      (first.compatibleProductIds as string[]).push('steel');
    }).toThrow(TypeError);
    expect(getFreightSet('unknown-freight-set')).toBeUndefined();
  });

  it('rejects products outside the explicit compatibility list', () => {
    expect(capacityForProduct(
      getFreightSet(FLATBED_FREIGHT_SET_ID)!,
      getProduct('cement')!,
    )).toEqual({ ok: false, code: 'incompatible-product' });
  });
});

describe('validateFreightSetContent', () => {
  it('accepts the general flatbed set catalogue', () => {
    expect(validateFreightSetContent(
      FREIGHT_SETS,
      [logs(), structuralTimber()],
    )).toEqual({ valid: true });
  });

  it('rejects duplicate freight set IDs', () => {
    const duplicate = cloneFlatbedSet();

    expect(validateFreightSetContent(
      [cloneFlatbedSet(), duplicate],
      [logs(), structuralTimber()],
    )).toMatchObject({
      valid: false,
      referenceId: FLATBED_FREIGHT_SET_ID,
    });
  });

  it('rejects duplicate compatible product IDs', () => {
    const set = cloneFlatbedSet();
    set.compatibleProductIds.push('logs');

    expect(validateFreightSetContent(
      [set],
      [logs(), structuralTimber()],
    )).toMatchObject({
      valid: false,
      referenceId: 'logs',
    });
  });

  it('rejects unknown compatible product IDs', () => {
    const set = cloneFlatbedSet();
    set.compatibleProductIds = ['unknown-product'];

    expect(validateFreightSetContent([set], [logs()])).toMatchObject({
      valid: false,
      referenceId: 'unknown-product',
    });
  });

  it.each([
    ['freight set ID', (set: MutableFreightSetDefinition) => {
      set.id = ' ';
    }],
    ['compatible product ID', (set: MutableFreightSetDefinition) => {
      set.compatibleProductIds = [''];
    }],
  ])('rejects an empty %s', (_description, mutate) => {
    const set = cloneFlatbedSet();
    mutate(set);

    expect(validateFreightSetContent([set], [logs()])).toMatchObject({
      valid: false,
    });
  });

  it.each([
    ['zero payload mass', (set: MutableFreightSetDefinition) => {
      set.payloadMassKg = 0;
    }],
    ['unsafe payload mass', (set: MutableFreightSetDefinition) => {
      set.payloadMassKg = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['zero payload volume', (set: MutableFreightSetDefinition) => {
      set.payloadVolumeLitres = 0;
    }],
    ['unsafe payload volume', (set: MutableFreightSetDefinition) => {
      set.payloadVolumeLitres = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['zero purchase price', (set: MutableFreightSetDefinition) => {
      set.purchasePrice = 0;
    }],
    ['unsafe purchase price', (set: MutableFreightSetDefinition) => {
      set.purchasePrice = Number.MAX_SAFE_INTEGER + 1;
    }],
    ['zero running cost', (set: MutableFreightSetDefinition) => {
      set.runningCostPerActiveTick = 0;
    }],
    ['unsafe running cost', (set: MutableFreightSetDefinition) => {
      set.runningCostPerActiveTick = Number.MAX_SAFE_INTEGER + 1;
    }],
  ])('rejects %s', (_description, mutate) => {
    const set = cloneFlatbedSet();
    mutate(set);

    expect(validateFreightSetContent([set], [logs()])).toMatchObject({
      valid: false,
      referenceId: FLATBED_FREIGHT_SET_ID,
    });
  });
});
