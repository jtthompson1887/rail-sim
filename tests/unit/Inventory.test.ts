import { InventorySlotDef } from '../../src/economy/EconomyData';
import { transferProduct } from '../../src/economy/Inventory';

const makeSlot = (
  overrides: Partial<InventorySlotDef> = {},
): InventorySlotDef => ({
  productId: 'logs',
  quantity: 0,
  reservedQuantity: 0,
  capacity: 100,
  recentInflow: 0,
  recentOutflow: 0,
  targetStock: 50,
  ...overrides,
});

describe('transferProduct', () => {
  it('moves only the destination free capacity and conserves stock', () => {
    const source = makeSlot({ quantity: 80 });
    const destination = makeSlot({ quantity: 70 });

    const result = transferProduct(source, destination, 50);

    expect(result).toMatchObject({
      movedUnits: 30,
      reason: 'moved',
      source: { quantity: 50, recentOutflow: 30 },
      destination: { quantity: 100, recentInflow: 30 },
    });
    expect(result.source.quantity + result.destination.quantity)
      .toBe(source.quantity + destination.quantity);
    expect(source).toEqual(makeSlot({ quantity: 80 }));
    expect(destination).toEqual(makeSlot({ quantity: 70 }));
  });

  it('does not move reserved stock', () => {
    const source = makeSlot({
      quantity: 80,
      reservedQuantity: 65,
    });
    const destination = makeSlot();

    const result = transferProduct(source, destination, 50);

    expect(result).toMatchObject({
      movedUnits: 15,
      reason: 'moved',
      source: { quantity: 65, reservedQuantity: 65 },
      destination: { quantity: 15 },
    });
  });

  it('reports no available stock without changing either slot', () => {
    const source = makeSlot({
      quantity: 20,
      reservedQuantity: 20,
      recentOutflow: 4,
    });
    const destination = makeSlot({ recentInflow: 3 });

    const result = transferProduct(source, destination, 10);

    expect(result).toEqual({
      movedUnits: 0,
      reason: 'no-available-stock',
      source,
      destination,
    });
    expect(source).toEqual(makeSlot({
      quantity: 20,
      reservedQuantity: 20,
      recentOutflow: 4,
    }));
    expect(destination).toEqual(makeSlot({ recentInflow: 3 }));
  });

  it('reports a full destination without changing either slot', () => {
    const source = makeSlot({ quantity: 50 });
    const destination = makeSlot({ quantity: 100 });

    expect(transferProduct(source, destination, 10)).toEqual({
      movedUnits: 0,
      reason: 'destination-full',
      source,
      destination,
    });
  });

  it('rejects different products without transforming stock', () => {
    const source = makeSlot({ quantity: 50 });
    const destination = makeSlot({
      productId: 'structural-timber',
      quantity: 20,
    });

    expect(transferProduct(source, destination, 10)).toEqual({
      movedUnits: 0,
      reason: 'invalid',
      source,
      destination,
    });
    expect(source.quantity).toBe(50);
    expect(destination.quantity).toBe(20);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid requested units %s atomically', (requestedUnits) => {
    const source = makeSlot({ quantity: 50, recentOutflow: 7 });
    const destination = makeSlot({ quantity: 20, recentInflow: 6 });
    const openingSource = { ...source };
    const openingDestination = { ...destination };

    expect(transferProduct(source, destination, requestedUnits)).toEqual({
      movedUnits: 0,
      reason: 'invalid',
      source,
      destination,
    });
    expect(source).toEqual(openingSource);
    expect(destination).toEqual(openingDestination);
  });

  it.each([
    {
      name: 'null source',
      source: null,
      destination: makeSlot(),
    },
    {
      name: 'null destination',
      source: makeSlot({ quantity: 10 }),
      destination: null,
    },
  ])('rejects a malformed runtime slot: $name', ({ source, destination }) => {
    expect(transferProduct(
      source as any,
      destination as any,
      5,
    )).toEqual({
      movedUnits: 0,
      reason: 'invalid',
      source,
      destination,
    });
  });
});
