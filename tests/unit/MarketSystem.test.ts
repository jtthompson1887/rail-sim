import type {
  InventorySlotDef,
  ProductDefinition,
} from '../../src/economy/EconomyData';
import * as ProductCatalog from '../../src/economy/ProductCatalog';
import {
  advanceMarketTick,
  quoteLocalProduct,
} from '../../src/economy/MarketSystem';

const makeMarket = (
  constructionIndexBps = 10_000,
  regionalDemandBps = 10_000,
  productId = 'logs',
) => ({
  constructionIndexBps,
  regionalDemandBpsByProduct: {
    [productId]: regionalDemandBps,
  },
});

const makeSlot = (
  productId = 'logs',
  overrides: Partial<InventorySlotDef> = {},
): InventorySlotDef => ({
  productId,
  quantity: 50,
  reservedQuantity: 0,
  capacity: 100,
  recentInflow: 0,
  recentOutflow: 0,
  targetStock: 50,
  ...overrides,
});

describe('quoteLocalProduct', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the base price and the three ordered neutral factors at target stock', () => {
    expect(quoteLocalProduct(
      'logs',
      makeMarket(),
      makeSlot(),
    )).toEqual({
      ok: true,
      productId: 'logs',
      unitPrice: 90,
      factors: [
        { id: 'global-construction', basisPoints: 10_000 },
        { id: 'regional-demand', basisPoints: 10_000 },
        { id: 'inventory-pressure', basisPoints: 10_000 },
      ],
    });
  });

  it('raises empty-stock pressure to the inclusive upper bound', () => {
    expect(quoteLocalProduct(
      'logs',
      makeMarket(),
      makeSlot('logs', { quantity: 0 }),
    )).toEqual({
      ok: true,
      productId: 'logs',
      unitPrice: 117,
      factors: [
        { id: 'global-construction', basisPoints: 10_000 },
        { id: 'regional-demand', basisPoints: 10_000 },
        { id: 'inventory-pressure', basisPoints: 13_000 },
      ],
    });
  });

  it('clamps stock at twice target to the inclusive lower pressure bound', () => {
    expect(quoteLocalProduct(
      'logs',
      makeMarket(),
      makeSlot('logs', { quantity: 100 }),
    )).toEqual({
      ok: true,
      productId: 'logs',
      unitPrice: 68,
      factors: [
        { id: 'global-construction', basisPoints: 10_000 },
        { id: 'regional-demand', basisPoints: 10_000 },
        { id: 'inventory-pressure', basisPoints: 7_500 },
      ],
    });
  });

  it('rounds after every factor in construction, regional, pressure order', () => {
    expect(quoteLocalProduct(
      'limestone-aggregate',
      makeMarket(8_500, 8_000, 'limestone-aggregate'),
      makeSlot('limestone-aggregate'),
    )).toEqual({
      ok: true,
      productId: 'limestone-aggregate',
      unitPrice: 30,
      factors: [
        { id: 'global-construction', basisPoints: 8_500 },
        { id: 'regional-demand', basisPoints: 8_000 },
        { id: 'inventory-pressure', basisPoints: 10_000 },
      ],
    });
  });

  it('rounds non-integral inventory pressure before pricing', () => {
    expect(quoteLocalProduct(
      'building-modules',
      makeMarket(10_000, 10_000, 'building-modules'),
      makeSlot('building-modules', {
        quantity: 79,
        capacity: 160,
        targetStock: 80,
      }),
    )).toEqual({
      ok: true,
      productId: 'building-modules',
      unitPrice: 6_023,
      factors: [
        { id: 'global-construction', basisPoints: 10_000 },
        { id: 'regional-demand', basisPoints: 10_000 },
        { id: 'inventory-pressure', basisPoints: 10_038 },
      ],
    });
  });

  it('accepts every inclusive factor endpoint', () => {
    expect(quoteLocalProduct(
      'logs',
      makeMarket(8_500, 8_000),
      makeSlot('logs', { quantity: 100 }),
    )).toMatchObject({
      ok: true,
      factors: [
        { id: 'global-construction', basisPoints: 8_500 },
        { id: 'regional-demand', basisPoints: 8_000 },
        { id: 'inventory-pressure', basisPoints: 7_500 },
      ],
    });
    expect(quoteLocalProduct(
      'logs',
      makeMarket(11_500, 12_000),
      makeSlot('logs', { quantity: 0 }),
    )).toMatchObject({
      ok: true,
      factors: [
        { id: 'global-construction', basisPoints: 11_500 },
        { id: 'regional-demand', basisPoints: 12_000 },
        { id: 'inventory-pressure', basisPoints: 13_000 },
      ],
    });
  });

  it('returns unknown-product for an id outside the catalogue', () => {
    expect(quoteLocalProduct(
      'unobtainium',
      makeMarket(10_000, 10_000, 'unobtainium'),
      makeSlot('unobtainium'),
    )).toEqual({
      ok: false,
      code: 'unknown-product',
    });
  });

  it('returns product-slot-mismatch before using another product slot', () => {
    expect(quoteLocalProduct(
      'logs',
      makeMarket(),
      makeSlot('steel'),
    )).toEqual({
      ok: false,
      code: 'product-slot-mismatch',
    });
  });

  it.each([
    ['construction below bound', makeMarket(8_499)],
    ['construction above bound', makeMarket(11_501)],
    ['fractional construction', makeMarket(10_000.5)],
    ['regional below bound', makeMarket(10_000, 7_999)],
    ['regional above bound', makeMarket(10_000, 12_001)],
    ['fractional regional', makeMarket(10_000, 10_000.5)],
    [
      'missing regional product',
      {
        constructionIndexBps: 10_000,
        regionalDemandBpsByProduct: {},
      },
    ],
    [
      'malformed regional collection',
      {
        constructionIndexBps: 10_000,
        regionalDemandBpsByProduct: null,
      },
    ],
  ])('rejects an invalid market state: %s', (_name, market) => {
    expect(quoteLocalProduct(
      'logs',
      market as any,
      makeSlot(),
    )).toEqual({
      ok: false,
      code: 'invalid-market-state',
    });
  });

  it.each([
    ['zero target', { targetStock: 0 }],
    ['target above capacity', { targetStock: 101 }],
    ['negative quantity', { quantity: -1 }],
    ['fractional quantity', { quantity: 1.5 }],
    ['quantity above capacity', { quantity: 101 }],
    ['reserved above quantity', { reservedQuantity: 51 }],
    ['zero capacity', { capacity: 0 }],
    ['negative recent inflow', { recentInflow: -1 }],
    ['unsafe recent outflow', { recentOutflow: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects invalid inventory: %s', (_name, overrides) => {
    expect(quoteLocalProduct(
      'logs',
      makeMarket(),
      makeSlot('logs', overrides),
    )).toEqual({
      ok: false,
      code: 'invalid-inventory',
    });
  });

  it('rejects inventory pressure multiplication before it becomes unsafe', () => {
    expect(quoteLocalProduct(
      'logs',
      makeMarket(),
      makeSlot('logs', {
        quantity: 0,
        capacity: Number.MAX_SAFE_INTEGER,
        targetStock: Number.MAX_SAFE_INTEGER,
      }),
    )).toEqual({
      ok: false,
      code: 'invalid-inventory',
    });
  });

  it('returns price-overflow before multiplying an unsafe intermediate', () => {
    const oversizedProduct: ProductDefinition = {
      id: 'oversized',
      displayName: 'Oversized',
      category: 'test',
      cargoClass: 'flatbed',
      unitLabel: 'unit',
      unitMassKg: 1,
      unitVolumeLitres: 1,
      basePrice: Number.MAX_SAFE_INTEGER,
      marketSector: 'construction',
    };
    jest.spyOn(ProductCatalog, 'getProduct')
      .mockReturnValue(oversizedProduct);

    expect(quoteLocalProduct(
      'oversized',
      makeMarket(8_500, 10_000, 'oversized'),
      makeSlot('oversized'),
    )).toEqual({
      ok: false,
      code: 'price-overflow',
    });
  });
});

describe('advanceMarketTick', () => {
  it('normalizes a non-record root before a non-cadence tick', () => {
    expect(advanceMarketTick(null as any, 'alpha', 23)).toEqual({
      constructionIndexBps: 10_000,
      regionalDemandBpsByProduct: {},
    });
  });

  it.each([
    ['NaN', Number.NaN, 10_000],
    ['fractional', 10_000.5, 10_000],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1, 10_000],
    ['below range', 8_000, 8_500],
    ['above range', 12_000, 11_500],
  ])(
    'normalizes a %s construction index before a non-cadence tick',
    (_name, constructionIndexBps, expectedIndex) => {
      expect(advanceMarketTick(
        makeMarket(constructionIndexBps),
        'alpha',
        23,
      )).toEqual({
        constructionIndexBps: expectedIndex,
        regionalDemandBpsByProduct: { logs: 10_000 },
      });
    },
  );

  it('normalizes a non-record regional map to an empty record', () => {
    expect(advanceMarketTick({
      constructionIndexBps: 10_000,
      regionalDemandBpsByProduct: null,
    } as any, 'alpha', 23)).toEqual({
      constructionIndexBps: 10_000,
      regionalDemandBpsByProduct: {},
    });
  });

  it('clones a valid regional map', () => {
    const market = makeMarket();
    const result = advanceMarketTick(market, 'alpha', 23);

    expect(result).toEqual(market);
    expect(result.regionalDemandBpsByProduct)
      .not.toBe(market.regionalDemandBpsByProduct);
  });

  it.each([
    ['below range', 7_999, 8_000],
    ['above range', 12_001, 12_000],
    ['NaN', Number.NaN, 10_000],
    ['fractional', 10_000.5, 10_000],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1, 10_000],
    ['non-number', '10_000', 10_000],
  ])(
    'normalizes a %s regional demand value',
    (_name, storedDemand, expectedDemand) => {
      expect(advanceMarketTick({
        constructionIndexBps: 10_000,
        regionalDemandBpsByProduct: {
          logs: storedDemand,
        },
      } as any, 'alpha', 23)).toEqual({
        constructionIndexBps: 10_000,
        regionalDemandBpsByProduct: {
          logs: expectedDemand,
        },
      });
    },
  );

  it('normalizes multiple regional entries without filtering product ids', () => {
    expect(advanceMarketTick({
      constructionIndexBps: 10_000,
      regionalDemandBpsByProduct: {
        logs: 7_500,
        steel: 12_500,
        cement: 11_000,
        'future-product': Number.NaN,
      },
    }, 'alpha', 23)).toEqual({
      constructionIndexBps: 10_000,
      regionalDemandBpsByProduct: {
        logs: 8_000,
        steel: 12_000,
        cement: 11_000,
        'future-product': 10_000,
      },
    });
  });

  it('does not mutate the persisted regional map while normalizing it', () => {
    const regionalDemandBpsByProduct = {
      logs: 7_500,
      steel: 12_500,
      'future-product': Number.NaN,
    };
    const market = {
      constructionIndexBps: 10_000,
      regionalDemandBpsByProduct,
    };

    const result = advanceMarketTick(market, 'alpha', 23);

    expect(regionalDemandBpsByProduct).toEqual({
      logs: 7_500,
      steel: 12_500,
      'future-product': Number.NaN,
    });
    expect(result.regionalDemandBpsByProduct)
      .not.toBe(regionalDemandBpsByProduct);
  });

  it('applies cadence drift after resetting an invalid construction index', () => {
    expect(advanceMarketTick(
      makeMarket(Number.NaN),
      'alpha',
      24,
    )).toEqual({
      constructionIndexBps: 9_975,
      regionalDemandBpsByProduct: { logs: 10_000 },
    });
  });

  it('applies cadence drift after clamping an out-of-range index', () => {
    expect(advanceMarketTick(
      makeMarket(12_000),
      'alpha',
      24,
    )).toEqual({
      constructionIndexBps: 11_475,
      regionalDemandBpsByProduct: { logs: 10_000 },
    });
  });

  it.each([0, 1, 23, 25])(
    'does not drift outside a positive 24-tick cadence at tick %s',
    (economyTick) => {
      const market = makeMarket();

      expect(advanceMarketTick(market, 'alpha', economyTick)).toEqual(market);
    },
  );

  it.each([
    ['alpha', 10_000, 9_975],
    ['beta', 10_000, 10_000],
    ['gamma', 10_000, 10_025],
  ])(
    'uses the exact keyed seed for deterministic drift: %s',
    (seed, initialIndex, expectedIndex) => {
      const market = makeMarket(initialIndex);

      expect(advanceMarketTick(market, seed, 24)).toEqual({
        constructionIndexBps: expectedIndex,
        regionalDemandBpsByProduct: { logs: 10_000 },
      });
      expect(advanceMarketTick(market, seed, 24))
        .toEqual(advanceMarketTick(market, seed, 24));
      expect(market.constructionIndexBps).toBe(initialIndex);
    },
  );

  it('clamps deterministic downward drift at the construction lower bound', () => {
    expect(advanceMarketTick(makeMarket(8_500), 'alpha', 24))
      .toEqual(makeMarket(8_500));
  });

  it('clamps deterministic upward drift at the construction upper bound', () => {
    expect(advanceMarketTick(makeMarket(11_500), 'gamma', 24))
      .toEqual(makeMarket(11_500));
  });
});
