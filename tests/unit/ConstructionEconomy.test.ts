import {
  ConstructionEconomy,
  demolitionRefund,
  startingCashForDifficulty,
  type CompanyConstructionState,
  type ConstructionTransaction,
} from '../../src/systems/ConstructionEconomy';

describe('ConstructionEconomy', () => {
  it('returns one deterministic starting balance for the authoritative standard difficulty', () => {
    expect(startingCashForDifficulty('standard')).toBe(1_000_000);
    expect(startingCashForDifficulty('standard')).toBe(1_000_000);
  });

  it('accepts an explicit affordable integer purchase amount', () => {
    const company: CompanyConstructionState = { cash: 100 };
    const economy = new ConstructionEconomy(company);
    expect(economy.canAfford(40)).toBe(true);
    expect(economy.purchase(40)).toEqual({ amount: 40, beforeCash: 100, afterCash: 60 });
    expect(company.cash).toBe(60);
  });

  it.each([101, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid or unaffordable amount %p without changing cash',
    (amount) => {
      const company: CompanyConstructionState = { cash: 100 };
      const economy = new ConstructionEconomy(company);
      expect(economy.purchase(amount)).toBeNull();
      expect(company.cash).toBe(100);
    },
  );

  it('conserves exact cash across purchase undo and redo', () => {
    const company: CompanyConstructionState = { cash: 100 };
    const economy = new ConstructionEconomy(company);
    const purchase = economy.purchase(37)!;
    expect(economy.reverse(purchase)).toBe(true);
    expect(company.cash).toBe(100);
    expect(economy.reapply(purchase)).toBe(true);
    expect(company.cash).toBe(63);
  });

  it('conserves exact cash across a signed demolition refund undo and redo', () => {
    const company: CompanyConstructionState = { cash: 63 };
    const economy = new ConstructionEconomy(company);
    const refund = economy.refundDemolition({}, 35)!;
    expect(refund).toEqual({ amount: -17, beforeCash: 63, afterCash: 80 });
    expect(economy.reverse(refund)).toBe(true);
    expect(company.cash).toBe(63);
    expect(economy.reapply(refund)).toBe(true);
    expect(company.cash).toBe(80);
  });

  it('rejects a second refund for the same demolition lifecycle', () => {
    const company: CompanyConstructionState = { cash: 100 };
    const economy = new ConstructionEconomy(company);
    const demolition = {};
    const refund = economy.refundDemolition(demolition, 100)!;

    expect(economy.refundDemolition(demolition, 100)).toBeNull();
    expect(company.cash).toBe(150);
    expect(economy.reapply(refund)).toBe(false);
    expect(company.cash).toBe(150);
    expect(economy.reverse(refund)).toBe(true);
    expect(company.cash).toBe(100);
    expect(economy.reapply(refund)).toBe(true);
    expect(company.cash).toBe(150);
    expect(economy.reapply(refund)).toBe(false);
    expect(company.cash).toBe(150);
  });

  it('rejects double application and double reversal without mutating cash', () => {
    const company: CompanyConstructionState = { cash: 100 };
    const economy = new ConstructionEconomy(company);
    const transaction = economy.purchase(25)!;
    expect(economy.reapply(transaction)).toBe(false);
    expect(company.cash).toBe(75);
    expect(economy.reverse(transaction)).toBe(true);
    expect(company.cash).toBe(100);
    expect(economy.reverse(transaction)).toBe(false);
    expect(company.cash).toBe(100);
  });

  it('rejects foreign transactions and invalid company state', () => {
    const company: CompanyConstructionState = { cash: 100 };
    const economy = new ConstructionEconomy(company);
    const foreign: ConstructionTransaction = { amount: 10, beforeCash: 100, afterCash: 90 };
    expect(economy.reverse(foreign)).toBe(false);
    expect(company.cash).toBe(100);
    company.cash = 99.5;
    expect(economy.purchase(1)).toBeNull();
    expect(company.cash).toBe(99.5);
  });

  it('rejects a refund whose result would exceed safe-integer cash', () => {
    const company: CompanyConstructionState = { cash: Number.MAX_SAFE_INTEGER - 10 };
    const economy = new ConstructionEconomy(company);
    expect(economy.refundDemolition({}, 100)).toBeNull();
    expect(company.cash).toBe(Number.MAX_SAFE_INTEGER - 10);
  });

  it.each([[0, 0], [1, 0], [99, 49], [100, 50], [101, 50]])(
    'floors the 50%% demolition refund for paid cost %i',
    (paidCost, expected) => expect(demolitionRefund(paidCost)).toBe(expected),
  );
});
