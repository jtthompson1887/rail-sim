import { InventorySlotDef } from './EconomyData';

export type InventoryTransferResult =
  | {
    movedUnits: number;
    reason: 'moved';
    source: InventorySlotDef;
    destination: InventorySlotDef;
  }
  | {
    movedUnits: 0;
    reason: 'invalid' | 'no-available-stock' | 'destination-full';
    source: InventorySlotDef;
    destination: InventorySlotDef;
  };

const isNonNegativeSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const isValidSlot = (value: unknown): value is InventorySlotDef => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const slot = value as InventorySlotDef;
  return typeof slot.productId === 'string'
  && slot.productId.length > 0
  && isNonNegativeSafeInteger(slot.quantity)
  && isNonNegativeSafeInteger(slot.reservedQuantity)
  && Number.isSafeInteger(slot.capacity)
  && slot.capacity > 0
  && isNonNegativeSafeInteger(slot.recentInflow)
  && isNonNegativeSafeInteger(slot.recentOutflow)
  && isNonNegativeSafeInteger(slot.targetStock)
  && slot.reservedQuantity <= slot.quantity
  && slot.quantity <= slot.capacity
  && slot.targetStock <= slot.capacity;
};

export const transferProduct = (
  source: InventorySlotDef,
  destination: InventorySlotDef,
  requestedUnits: number,
): InventoryTransferResult => {
  if (!Number.isSafeInteger(requestedUnits)
    || requestedUnits <= 0
    || !isValidSlot(source)
    || !isValidSlot(destination)
    || source.productId !== destination.productId) {
    return {
      movedUnits: 0,
      reason: 'invalid',
      source,
      destination,
    };
  }

  const availableStock = source.quantity - source.reservedQuantity;
  if (availableStock === 0) {
    return {
      movedUnits: 0,
      reason: 'no-available-stock',
      source,
      destination,
    };
  }

  const freeCapacity = destination.capacity - destination.quantity;
  if (freeCapacity === 0) {
    return {
      movedUnits: 0,
      reason: 'destination-full',
      source,
      destination,
    };
  }

  const movedUnits = Math.min(requestedUnits, availableStock, freeCapacity);
  const recentOutflow = source.recentOutflow + movedUnits;
  const recentInflow = destination.recentInflow + movedUnits;
  if (!Number.isSafeInteger(recentOutflow) || !Number.isSafeInteger(recentInflow)) {
    return {
      movedUnits: 0,
      reason: 'invalid',
      source,
      destination,
    };
  }

  return {
    movedUnits,
    reason: 'moved',
    source: {
      ...source,
      quantity: source.quantity - movedUnits,
      recentOutflow,
    },
    destination: {
      ...destination,
      quantity: destination.quantity + movedUnits,
      recentInflow,
    },
  };
};
