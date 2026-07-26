import type { ProductDefinition } from '../../src/economy/EconomyData';
import { getProduct } from '../../src/economy/ProductCatalog';
import {
  capacityForProduct,
  FreightSetDefinition,
  getFreightSet,
  OPERATING_RESERVE,
  STARTER_ROUTE_RESERVE,
  TIMBER_FREIGHT_SET_ID,
  TIMBER_FREIGHT_SETS,
  TIMBER_TRAIN_PURCHASE_PRICE,
  validateFreightSetContent,
} from '../../src/freight/FreightSetCatalog';

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key];
};

type MutableFreightSetDefinition =
  Omit<Mutable<FreightSetDefinition>, 'compatibleProductIds'> & {
    compatibleProductIds: string[];
  };

const cloneTimberSet = (): MutableFreightSetDefinition => ({
  ...TIMBER_FREIGHT_SETS[0],
  compatibleProductIds: [
    ...TIMBER_FREIGHT_SETS[0].compatibleProductIds,
  ],
});

const logs = (): ProductDefinition => getProduct('logs')!;

describe('timber freight set catalogue', () => {
  it('contains exactly the approved timber freight set and reserves', () => {
    expect(TIMBER_FREIGHT_SET_ID).toBe('timber-freight-set');
    expect(TIMBER_TRAIN_PURCHASE_PRICE).toBe(90_000);
    expect(OPERATING_RESERVE).toBe(20_000);
    expect(STARTER_ROUTE_RESERVE).toBe(110_000);
    expect(TIMBER_FREIGHT_SETS).toEqual([{
      id: 'timber-freight-set',
      displayName: 'Timber Freight Set',
      compatibleProductIds: ['logs'],
      payloadMassKg: 60_000,
      payloadVolumeLitres: 96_000,
      purchasePrice: 90_000,
      runningCostPerActiveTick: 20,
    }]);
  });

  it('derives the exact log capacity from mass and volume', () => {
    expect(capacityForProduct(
      getFreightSet('timber-freight-set')!,
      logs(),
    )).toEqual({ ok: true, capacityUnits: 60 });
  });

  it('returns the same immutable definition on repeated lookup', () => {
    const first = getFreightSet(TIMBER_FREIGHT_SET_ID)!;
    const second = getFreightSet(TIMBER_FREIGHT_SET_ID)!;

    expect(first).toBe(second);
    expect(first).toBe(TIMBER_FREIGHT_SETS[0]);
    expect(Object.isFrozen(TIMBER_FREIGHT_SETS)).toBe(true);
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
      getFreightSet(TIMBER_FREIGHT_SET_ID)!,
      getProduct('structural-timber')!,
    )).toEqual({ ok: false, code: 'incompatible-product' });
  });
});

describe('validateFreightSetContent', () => {
  it('accepts the timber freight set catalogue', () => {
    expect(validateFreightSetContent(
      TIMBER_FREIGHT_SETS,
      [logs()],
    )).toEqual({ valid: true });
  });

  it('rejects duplicate freight set IDs', () => {
    const duplicate = cloneTimberSet();

    expect(validateFreightSetContent(
      [cloneTimberSet(), duplicate],
      [logs()],
    )).toMatchObject({
      valid: false,
      referenceId: TIMBER_FREIGHT_SET_ID,
    });
  });

  it('rejects duplicate compatible product IDs', () => {
    const set = cloneTimberSet();
    set.compatibleProductIds.push('logs');

    expect(validateFreightSetContent([set], [logs()])).toMatchObject({
      valid: false,
      referenceId: 'logs',
    });
  });

  it('rejects unknown compatible product IDs', () => {
    const set = cloneTimberSet();
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
    const set = cloneTimberSet();
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
    const set = cloneTimberSet();
    mutate(set);

    expect(validateFreightSetContent([set], [logs()])).toMatchObject({
      valid: false,
      referenceId: TIMBER_FREIGHT_SET_ID,
    });
  });
});
