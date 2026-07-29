import type { ProductDefinition } from '../../src/economy/EconomyData';
import { getProduct } from '../../src/economy/ProductCatalog';
import {
  AGGREGATE_HOPPER_SET_ID,
  capacityForProduct,
  COVERED_CEMENT_SET_ID,
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

const requireProduct = (id: string): ProductDefinition => {
  const product = getProduct(id);
  if (!product) throw new Error(`Missing product ${id}`);
  return product;
};

const logs = (): ProductDefinition => requireProduct('logs');
const structuralTimber = (): ProductDefinition =>
  requireProduct('structural-timber');
const limestoneAggregate = (): ProductDefinition =>
  requireProduct('limestone-aggregate');
const cement = (): ProductDefinition => requireProduct('cement');
const steel = (): ProductDefinition => requireProduct('steel');
const buildingModules = (): ProductDefinition =>
  requireProduct('building-modules');

describe('freight set catalogue', () => {
  it('contains exactly the three approved cargo-class-specific sets', () => {
    expect(FLATBED_FREIGHT_SET_ID).toBe('flatbed-freight-set');
    expect(AGGREGATE_HOPPER_SET_ID).toBe('aggregate-hopper-set');
    expect(COVERED_CEMENT_SET_ID).toBe('covered-cement-set');
    expect(FLATBED_TRAIN_PURCHASE_PRICE).toBe(90_000);
    expect(OPERATING_RESERVE).toBe(20_000);
    expect(STARTER_ROUTE_RESERVE).toBe(110_000);
    expect(FREIGHT_SETS).toEqual([
      {
        id: 'flatbed-freight-set',
        displayName: 'General Flatbed Set',
        cargoClass: 'flatbed',
        compatibleProductIds: [
          'logs',
          'structural-timber',
          'steel',
          'building-modules',
        ],
        payloadMassKg: 60_000,
        payloadVolumeLitres: 100_000,
        purchasePrice: 90_000,
        runningCostPerActiveTick: 20,
      },
      {
        id: 'aggregate-hopper-set',
        displayName: 'Aggregate Hopper Set',
        cargoClass: 'bulk',
        compatibleProductIds: ['limestone-aggregate'],
        payloadMassKg: 120_000,
        payloadVolumeLitres: 75_000,
        purchasePrice: 110_000,
        runningCostPerActiveTick: 20,
      },
      {
        id: 'covered-cement-set',
        displayName: 'Covered Cement Set',
        cargoClass: 'covered',
        compatibleProductIds: ['cement'],
        payloadMassKg: 80_000,
        payloadVolumeLitres: 64_000,
        purchasePrice: 105_000,
        runningCostPerActiveTick: 22,
      },
    ]);
  });

  it.each([
    ['flatbed-freight-set', 'logs', logs, 60],
    ['flatbed-freight-set', 'structural timber', structuralTimber, 60],
    ['flatbed-freight-set', 'steel', steel, 60],
    ['flatbed-freight-set', 'building modules', buildingModules, 4],
    ['aggregate-hopper-set', 'limestone aggregate', limestoneAggregate, 120],
    ['covered-cement-set', 'cement', cement, 80],
  ])('derives the exact %s %s capacity from mass and volume', (
    freightSetId,
    _description,
    product,
    expectedCapacity,
  ) => {
    expect(capacityForProduct(
      getFreightSet(freightSetId)!,
      product(),
    )).toEqual({ ok: true, capacityUnits: expectedCapacity });
  });

  it.each([
    FLATBED_FREIGHT_SET_ID,
    AGGREGATE_HOPPER_SET_ID,
    COVERED_CEMENT_SET_ID,
  ])('returns the same immutable %s definition on repeated lookup', (
    freightSetId,
  ) => {
    const first = getFreightSet(freightSetId)!;
    const second = getFreightSet(freightSetId)!;

    expect(first).toBe(second);
    expect(FREIGHT_SETS).toContain(first);
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
  it('accepts the complete cargo-class-matched catalogue', () => {
    expect(validateFreightSetContent(
      FREIGHT_SETS,
      [
        logs(),
        structuralTimber(),
        steel(),
        buildingModules(),
        limestoneAggregate(),
        cement(),
      ],
    )).toEqual({ valid: true });
  });

  it('rejects a compatible product from a different cargo class', () => {
    const set = cloneFlatbedSet();
    set.compatibleProductIds = ['limestone-aggregate'];

    expect(validateFreightSetContent(
      [set],
      [limestoneAggregate()],
    )).toEqual({
      valid: false,
      code: 'cargo-class-mismatch',
      referenceId: 'limestone-aggregate',
    });
  });

  it('rejects duplicate freight set IDs', () => {
    const duplicate = cloneFlatbedSet();

    expect(validateFreightSetContent(
      [cloneFlatbedSet(), duplicate],
      [logs(), structuralTimber(), steel(), buildingModules()],
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
      [logs(), structuralTimber(), steel(), buildingModules()],
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
