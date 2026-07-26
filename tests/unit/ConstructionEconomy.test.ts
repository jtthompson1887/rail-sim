import {
  applyConstructionTransaction,
  demolitionRefund,
  startingCashForDifficulty,
} from '../../src/systems/ConstructionEconomy';
import { createCompanyState } from '../../src/economy/FinanceLedger';

const ledgerCash = (
  company: ReturnType<typeof createCompanyState>,
): number => company.ledger.reduce(
  (cash, entry) => cash + entry.amount,
  0,
);

describe('ConstructionEconomy', () => {
  it('returns one deterministic starting balance for the authoritative standard difficulty', () => {
    expect(startingCashForDifficulty('standard')).toBe(1_000_000);
    expect(startingCashForDifficulty('standard')).toBe(1_000_000);
  });

  it('posts an affordable purchase as conserved construction capex', () => {
    const original = createCompanyState(100);
    const result = applyConstructionTransaction(original, {
      kind: 'purchase',
      magnitude: 40,
      referenceId: 'track-a',
      direction: 'forward',
    }, 12);

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      entry: {
        id: 2,
        tick: 12,
        category: 'construction-capex',
        ledgerClass: 'capital-expenditure',
        amount: -40,
        referenceId: 'track-a',
      },
    }));
    if (result.ok === false) throw new Error(result.code);
    expect(result.company.cash).toBe(60);
    expect(ledgerCash(result.company)).toBe(result.company.cash);
    expect(original.cash).toBe(100);
    expect(original.ledger).toHaveLength(1);
  });

  it('posts purchase undo and redo as real reversal and reapplication entries', () => {
    const built = applyConstructionTransaction(createCompanyState(100), {
      kind: 'purchase',
      magnitude: 37,
      referenceId: 'track-a',
      direction: 'forward',
    }, 1);
    if (built.ok === false) throw new Error(built.code);
    const undone = applyConstructionTransaction(built.company, {
      kind: 'purchase',
      magnitude: 37,
      referenceId: 'track-a',
      direction: 'reversal',
      reversalOf: built.entry.id,
    }, 2);
    if (undone.ok === false) throw new Error(undone.code);
    const redone = applyConstructionTransaction(undone.company, {
      kind: 'purchase',
      magnitude: 37,
      referenceId: 'track-a',
      direction: 'forward',
    }, 3);
    if (redone.ok === false) throw new Error(redone.code);

    expect(undone.entry).toEqual(expect.objectContaining({
      amount: 37,
      reversalOf: built.entry.id,
    }));
    expect(redone.entry).toEqual(expect.objectContaining({
      id: 4,
      amount: -37,
    }));
    expect(redone.company.cash).toBe(63);
    expect(ledgerCash(redone.company)).toBe(redone.company.cash);
  });

  it('posts a demolition refund and its undo as opposite conserved entries', () => {
    const refunded = applyConstructionTransaction(createCompanyState(63), {
      kind: 'demolition-refund',
      magnitude: demolitionRefund(35),
      referenceId: 'track-a',
      direction: 'forward',
    }, 4);
    if (refunded.ok === false) throw new Error(refunded.code);
    const undone = applyConstructionTransaction(refunded.company, {
      kind: 'demolition-refund',
      magnitude: 17,
      referenceId: 'track-a',
      direction: 'reversal',
      reversalOf: refunded.entry.id,
    }, 5);
    if (undone.ok === false) throw new Error(undone.code);

    expect(refunded.entry).toEqual(expect.objectContaining({
      category: 'construction-refund',
      amount: 17,
    }));
    expect(undone.entry).toEqual(expect.objectContaining({
      amount: -17,
      reversalOf: refunded.entry.id,
    }));
    expect(undone.company.cash).toBe(63);
    expect(ledgerCash(undone.company)).toBe(undone.company.cash);
  });

  it.each([101, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid or unaffordable purchase magnitude %p without mutation',
    (magnitude) => {
      const original = createCompanyState(100);
      const result = applyConstructionTransaction(original, {
        kind: 'purchase',
        magnitude,
        referenceId: 'track-a',
        direction: 'forward',
      }, 0);

      expect(result.ok).toBe(false);
      expect(result.company).toBe(original);
      expect(original.cash).toBe(100);
      expect(original.ledger).toHaveLength(1);
    },
  );

  it('rejects a refund whose result would exceed safe-integer cash', () => {
    const company = createCompanyState(Number.MAX_SAFE_INTEGER - 10);
    const result = applyConstructionTransaction(company, {
      kind: 'demolition-refund',
      magnitude: 50,
      referenceId: 'track-a',
      direction: 'forward',
    }, 0);
    expect(result.ok).toBe(false);
    expect(result.company).toBe(company);
  });

  it.each([[0, 0], [1, 0], [99, 49], [100, 50], [101, 50]])(
    'floors the 50%% demolition refund for paid cost %i',
    (paidCost, expected) => expect(demolitionRefund(paidCost)).toBe(expected),
  );
});
