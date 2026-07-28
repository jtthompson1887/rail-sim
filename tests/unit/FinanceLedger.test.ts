import type {
  CompanyStateDef,
  LedgerCategory,
} from '../../src/economy/EconomyData';
import {
  createCompanyState,
  LedgerPostRequest,
  LedgerPostResult,
  postLedgerEntry,
  summariseProfitAndLoss,
} from '../../src/economy/FinanceLedger';

const requireAccepted = (
  result: LedgerPostResult,
): Extract<LedgerPostResult, { ok: true }> => {
  expect(result.ok).toBe(true);
  if (result.ok === false) {
    throw new Error(`Expected an accepted ledger entry, received ${result.code}`);
  }
  return result;
};

const post = (
  company: CompanyStateDef,
  request: Partial<LedgerPostRequest> = {},
): LedgerPostResult => postLedgerEntry(company, {
  category: 'delivery-revenue',
  magnitude: 100,
  tick: 1,
  referenceId: 'delivery-1',
  direction: 'forward',
  ...request,
});

const cloneCompany = (company: CompanyStateDef): CompanyStateDef =>
  JSON.parse(JSON.stringify(company));

describe('createCompanyState', () => {
  it('creates a frozen opening balance at tick zero with the next monotonic ID', () => {
    const company = createCompanyState(25_000);

    expect(company).toEqual({
      cash: 25_000,
      nextLedgerId: 2,
      ledger: [{
        id: 1,
        tick: 0,
        category: 'opening-balance',
        ledgerClass: 'opening',
        amount: 25_000,
        referenceId: 'opening-balance',
      }],
    });
    expect(Object.isFrozen(company)).toBe(true);
    expect(Object.isFrozen(company.ledger)).toBe(true);
    expect(Object.isFrozen(company.ledger[0])).toBe(true);
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects unsafe or negative starting cash %s', (startingCash) => {
    expect(() => createCompanyState(startingCash)).toThrow(RangeError);
  });
});

describe('postLedgerEntry', () => {
  it.each([
    ['construction-capex', 'capital-expenditure', -100],
    ['construction-refund', 'capital-expenditure', 100],
    ['vehicle-capex', 'capital-expenditure', -100],
    ['delivery-revenue', 'revenue', 100],
    ['contract-bonus', 'revenue', 100],
    ['train-running-cost', 'operating-expense', -100],
    ['port-handling', 'operating-expense', -100],
  ] as const)(
    'derives the %s class and forward sign',
    (category, ledgerClass, amount) => {
      const company = createCompanyState(1_000);
      const accepted = requireAccepted(post(company, {
        category,
        referenceId: `reference-${category}`,
      }));

      expect(accepted.entry).toEqual({
        id: 2,
        tick: 1,
        category,
        ledgerClass,
        amount,
        referenceId: `reference-${category}`,
      });
      expect(accepted.company.cash).toBe(1_000 + amount);
      expect(accepted.company.nextLedgerId).toBe(3);
    },
  );

  it('reserves opening balance entries for company creation', () => {
    const company = createCompanyState(1_000);

    expect(post(company, {
      category: 'opening-balance',
    })).toEqual({
      ok: false,
      code: 'opening-balance-reserved',
      company,
    });
  });

  it('returns a new frozen state and entry without mutating the original', () => {
    const company = createCompanyState(1_000);
    const openingSnapshot = JSON.parse(JSON.stringify(company));

    const accepted = requireAccepted(post(company));

    expect(company).toEqual(openingSnapshot);
    expect(accepted.company).not.toBe(company);
    expect(accepted.company.ledger).not.toBe(company.ledger);
    expect(accepted.company.ledger[0]).not.toBe(company.ledger[0]);
    expect(accepted.company.ledger).toHaveLength(2);
    expect(Object.isFrozen(accepted.company)).toBe(true);
    expect(Object.isFrozen(accepted.company.ledger)).toBe(true);
    expect(Object.isFrozen(accepted.company.ledger[0])).toBe(true);
    expect(Object.isFrozen(accepted.entry)).toBe(true);
    expect(accepted.company.ledger[1]).toBe(accepted.entry);
  });

  it('detaches and freezes entries loaded from a mutable persisted alias', () => {
    const persisted = cloneCompany(createCompanyState(1_000));
    const accepted = requireAccepted(post(persisted));

    persisted.ledger[0].amount = 1;
    persisted.ledger[0].referenceId = 'corrupted';

    expect(accepted.company.ledger[0]).toEqual({
      id: 1,
      tick: 0,
      category: 'opening-balance',
      ledgerClass: 'opening',
      amount: 1_000,
      referenceId: 'opening-balance',
    });
    expect(Object.isFrozen(accepted.company.ledger[0])).toBe(true);
  });

  it('assigns monotonic IDs across accepted entries', () => {
    const company = createCompanyState(1_000);
    const first = requireAccepted(post(company));
    const second = requireAccepted(post(first.company, {
      category: 'contract-bonus',
      tick: 2,
      referenceId: 'bonus-1',
    }));

    expect(second.company.ledger.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(second.company.nextLedgerId).toBe(4);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid magnitude %s atomically', (magnitude) => {
    const company = createCompanyState(1_000);

    expect(post(company, { magnitude })).toEqual({
      ok: false,
      code: 'invalid-magnitude',
      company,
    });
  });

  it.each([
    {
      name: 'negative tick',
      request: { tick: -1 },
      code: 'invalid-tick',
    },
    {
      name: 'fractional tick',
      request: { tick: 1.5 },
      code: 'invalid-tick',
    },
    {
      name: 'unsafe tick',
      request: { tick: Number.MAX_SAFE_INTEGER + 1 },
      code: 'invalid-tick',
    },
    {
      name: 'empty reference',
      request: { referenceId: '' },
      code: 'invalid-reference',
    },
    {
      name: 'unknown category',
      request: { category: 'tax' as LedgerCategory },
      code: 'invalid-category',
    },
    {
      name: 'unknown direction',
      request: { direction: 'backward' as 'forward' },
      code: 'invalid-direction',
    },
  ])('rejects $name without mutation', ({ request, code }) => {
    const company = createCompanyState(1_000);

    expect(post(company, request)).toEqual({
      ok: false,
      code,
      company,
    });
  });

  it('rejects a debit that would make cash negative without clamping', () => {
    const company = createCompanyState(99);

    expect(post(company, {
      category: 'vehicle-capex',
      magnitude: 100,
    })).toEqual({
      ok: false,
      code: 'insufficient-cash',
      company,
    });
    expect(company.cash).toBe(99);
    expect(company.ledger).toHaveLength(1);
  });

  it('rejects cash and ledger ID overflow atomically', () => {
    const fullCompany = createCompanyState(Number.MAX_SAFE_INTEGER);
    expect(post(fullCompany)).toEqual({
      ok: false,
      code: 'unsafe-balance',
      company: fullCompany,
    });

    const unsafeNextId = {
      ...createCompanyState(1_000),
      nextLedgerId: Number.MAX_SAFE_INTEGER,
    };
    expect(post(unsafeNextId)).toEqual({
      ok: false,
      code: 'unsafe-ledger-id',
      company: unsafeNextId,
    });
  });

  it('reverses an earlier matching entry with the opposite sign and same class', () => {
    const company = createCompanyState(1_000);
    const purchase = requireAccepted(post(company, {
      category: 'construction-capex',
      magnitude: 500,
      tick: 4,
      referenceId: 'track-build-7',
    }));

    const reversal = requireAccepted(post(purchase.company, {
      category: 'construction-capex',
      magnitude: 500,
      tick: 5,
      referenceId: 'track-build-7',
      direction: 'reversal',
      reversalOf: purchase.entry.id,
    }));

    expect(reversal.entry).toEqual({
      id: 3,
      tick: 5,
      category: 'construction-capex',
      ledgerClass: 'capital-expenditure',
      amount: 500,
      referenceId: 'track-build-7',
      reversalOf: 2,
    });
    expect(reversal.entry.amount).toBe(-purchase.entry.amount);
    expect(reversal.company.cash).toBe(1_000);
  });

  it.each([
    {
      name: 'missing reversal target',
      request: {
        category: 'construction-capex' as const,
        direction: 'reversal' as const,
        referenceId: 'track-build-7',
      },
      code: 'reversal-target-required',
    },
    {
      name: 'opening balance reversal',
      request: {
        category: 'opening-balance' as const,
        direction: 'reversal' as const,
        referenceId: 'opening-balance',
        magnitude: 1_000,
        reversalOf: 1,
      },
      code: 'opening-balance-reversal',
    },
    {
      name: 'unknown target',
      request: {
        category: 'construction-capex' as const,
        direction: 'reversal' as const,
        referenceId: 'track-build-7',
        reversalOf: 999,
      },
      code: 'reversal-target-not-found',
    },
    {
      name: 'forward entry carrying a reversal target',
      request: {
        category: 'construction-capex' as const,
        direction: 'forward' as const,
        referenceId: 'track-build-7',
        reversalOf: 2,
      },
      code: 'unexpected-reversal-target',
    },
  ])('rejects $name atomically', ({ request, code }) => {
    const company = createCompanyState(1_000);

    expect(post(company, request)).toEqual({
      ok: false,
      code,
      company,
    });
  });

  it.each([
    ['category', { category: 'vehicle-capex' as const }],
    ['reference', { referenceId: 'different-reference' }],
    ['magnitude', { magnitude: 499 }],
  ])('rejects a reversal with a mismatched %s', (_field, overrides) => {
    const company = createCompanyState(1_000);
    const purchase = requireAccepted(post(company, {
      category: 'construction-capex',
      magnitude: 500,
      tick: 4,
      referenceId: 'track-build-7',
    }));

    expect(post(purchase.company, {
      category: 'construction-capex',
      magnitude: 500,
      tick: 5,
      referenceId: 'track-build-7',
      direction: 'reversal',
      reversalOf: purchase.entry.id,
      ...overrides,
    })).toEqual({
      ok: false,
      code: 'reversal-mismatch',
      company: purchase.company,
    });
  });

  it('rejects replaying a reversal target that was already referenced', () => {
    const company = createCompanyState(1_000);
    const purchase = requireAccepted(post(company, {
      category: 'construction-capex',
      magnitude: 500,
      referenceId: 'track-build-7',
    }));
    const reversal = requireAccepted(post(purchase.company, {
      category: 'construction-capex',
      magnitude: 500,
      tick: 2,
      referenceId: 'track-build-7',
      direction: 'reversal',
      reversalOf: purchase.entry.id,
    }));

    expect(post(reversal.company, {
      category: 'construction-capex',
      magnitude: 500,
      tick: 3,
      referenceId: 'track-build-7',
      direction: 'reversal',
      reversalOf: purchase.entry.id,
    })).toEqual({
      ok: false,
      code: 'reversal-target-already-reversed',
      company: reversal.company,
    });
  });

  it('rejects reversing a reversal entry', () => {
    const company = createCompanyState(1_000);
    const purchase = requireAccepted(post(company, {
      category: 'construction-capex',
      magnitude: 500,
      referenceId: 'track-build-7',
    }));
    const reversal = requireAccepted(post(purchase.company, {
      category: 'construction-capex',
      magnitude: 500,
      tick: 2,
      referenceId: 'track-build-7',
      direction: 'reversal',
      reversalOf: purchase.entry.id,
    }));

    expect(post(reversal.company, {
      category: 'construction-capex',
      magnitude: 500,
      tick: 3,
      referenceId: 'track-build-7',
      direction: 'reversal',
      reversalOf: reversal.entry.id,
    })).toEqual({
      ok: false,
      code: 'reversal-target-is-reversal',
      company: reversal.company,
    });
  });

  it.each([
    {
      name: 'duplicate entry IDs',
      mutate: (company: CompanyStateDef) => {
        company.ledger[1].id = 1;
      },
    },
    {
      name: 'nonsequential next ID',
      mutate: (company: CompanyStateDef) => {
        company.nextLedgerId = 99;
      },
    },
    {
      name: 'unsafe entry tick',
      mutate: (company: CompanyStateDef) => {
        company.ledger[1].tick = Number.MAX_SAFE_INTEGER + 1;
      },
    },
    {
      name: 'fractional entry amount',
      mutate: (company: CompanyStateDef) => {
        company.ledger[1].amount = 1.5;
        company.cash = 1_001.5;
      },
    },
    {
      name: 'wrong ledger class policy',
      mutate: (company: CompanyStateDef) => {
        company.ledger[1].ledgerClass = 'operating-expense';
      },
    },
    {
      name: 'wrong forward sign policy',
      mutate: (company: CompanyStateDef) => {
        company.ledger[1].amount = -100;
        company.cash = 900;
      },
    },
    {
      name: 'malformed reference',
      mutate: (company: CompanyStateDef) => {
        company.ledger[1].referenceId = '';
      },
    },
    {
      name: 'cash that differs from the ledger sum',
      mutate: (company: CompanyStateDef) => {
        company.cash = 1_099;
      },
    },
  ])('rejects a company with $name before posting', ({ mutate }) => {
    const accepted = requireAccepted(post(createCompanyState(1_000)));
    const malformed = cloneCompany(accepted.company);
    mutate(malformed);

    expect(post(malformed)).toEqual({
      ok: false,
      code: 'invalid-company',
      company: malformed,
    });
  });

  it('rejects a ledger whose running cash becomes negative', () => {
    const malformed = cloneCompany(createCompanyState(100));
    malformed.ledger.push(
      {
        id: 2,
        tick: 1,
        category: 'vehicle-capex',
        ledgerClass: 'capital-expenditure',
        amount: -200,
        referenceId: 'vehicle-1',
      },
      {
        id: 3,
        tick: 2,
        category: 'construction-refund',
        ledgerClass: 'capital-expenditure',
        amount: 200,
        referenceId: 'refund-1',
      },
    );
    malformed.nextLedgerId = 4;

    expect(post(malformed)).toEqual({
      ok: false,
      code: 'invalid-company',
      company: malformed,
    });
  });

  it.each([
    {
      name: 'a reversal pointing forward',
      makeCompany: () => {
        const company = cloneCompany(createCompanyState(1_000));
        company.ledger.push({
          id: 2,
          tick: 1,
          category: 'construction-capex',
          ledgerClass: 'capital-expenditure',
          amount: 100,
          referenceId: 'track-1',
          reversalOf: 3,
        });
        company.nextLedgerId = 3;
        company.cash = 1_100;
        return company;
      },
    },
    {
      name: 'a reversal with a non-opposite amount',
      makeCompany: () => {
        const purchase = requireAccepted(post(createCompanyState(1_000), {
          category: 'construction-capex',
          referenceId: 'track-1',
        }));
        const company = cloneCompany(purchase.company);
        company.ledger.push({
          id: 3,
          tick: 2,
          category: 'construction-capex',
          ledgerClass: 'capital-expenditure',
          amount: -100,
          referenceId: 'track-1',
          reversalOf: 2,
        });
        company.nextLedgerId = 4;
        company.cash = 800;
        return company;
      },
    },
    {
      name: 'two reversals referencing one target',
      makeCompany: () => {
        const purchase = requireAccepted(post(createCompanyState(1_000), {
          category: 'construction-capex',
          referenceId: 'track-1',
        }));
        const reversal = requireAccepted(post(purchase.company, {
          category: 'construction-capex',
          tick: 2,
          referenceId: 'track-1',
          direction: 'reversal',
          reversalOf: purchase.entry.id,
        }));
        const company = cloneCompany(reversal.company);
        company.ledger.push({
          ...company.ledger[2],
          id: 4,
          tick: 3,
        });
        company.nextLedgerId = 5;
        company.cash = 1_100;
        return company;
      },
    },
    {
      name: 'a reversal of a reversal',
      makeCompany: () => {
        const purchase = requireAccepted(post(createCompanyState(1_000), {
          category: 'construction-capex',
          referenceId: 'track-1',
        }));
        const reversal = requireAccepted(post(purchase.company, {
          category: 'construction-capex',
          tick: 2,
          referenceId: 'track-1',
          direction: 'reversal',
          reversalOf: purchase.entry.id,
        }));
        const company = cloneCompany(reversal.company);
        company.ledger.push({
          id: 4,
          tick: 3,
          category: 'construction-capex',
          ledgerClass: 'capital-expenditure',
          amount: -100,
          referenceId: 'track-1',
          reversalOf: 3,
        });
        company.nextLedgerId = 5;
        company.cash = 900;
        return company;
      },
    },
  ])('rejects persisted state containing $name', ({ makeCompany }) => {
    const malformed = makeCompany();

    expect(post(malformed)).toEqual({
      ok: false,
      code: 'invalid-company',
      company: malformed,
    });
  });
});

describe('summariseProfitAndLoss', () => {
  it('separates contract bonuses from railway operating profit and includes every entry in cash flow', () => {
    let company = createCompanyState(5_000);
    company = requireAccepted(post(company, {
      category: 'delivery-revenue',
      magnitude: 1_000,
      tick: 1,
      referenceId: 'delivery-1',
    })).company;
    company = requireAccepted(post(company, {
      category: 'contract-bonus',
      magnitude: 250_000,
      tick: 2,
      referenceId: 'contract-1',
    })).company;
    company = requireAccepted(post(company, {
      category: 'train-running-cost',
      magnitude: 300,
      tick: 3,
      referenceId: 'train-1',
    })).company;
    company = requireAccepted(post(company, {
      category: 'construction-capex',
      magnitude: 2_000,
      tick: 24,
      referenceId: 'track-1',
    })).company;

    expect(summariseProfitAndLoss(company, 1, 24)).toEqual({
      deliveryRevenue: 1_000,
      contractBonuses: 250_000,
      operatingExpenses: 300,
      railwayOperatingProfit: 700,
      capitalExpenditure: 2_000,
      cashFlow: 248_700,
    });
  });

  it('includes the opening entry only when tick zero is requested', () => {
    const company = createCompanyState(5_000);

    expect(summariseProfitAndLoss(company, 1, 1).cashFlow).toBe(0);
    expect(summariseProfitAndLoss(company, 0, 0)).toEqual({
      deliveryRevenue: 0,
      contractBonuses: 0,
      operatingExpenses: 0,
      railwayOperatingProfit: 0,
      capitalExpenditure: 0,
      cashFlow: 5_000,
    });
  });

  it('nets reversals into the matching P&L class', () => {
    let company = createCompanyState(2_000);
    const revenue = requireAccepted(post(company, {
      category: 'delivery-revenue',
      magnitude: 700,
      tick: 1,
      referenceId: 'delivery-1',
    }));
    company = revenue.company;
    const runningCost = requireAccepted(post(company, {
      category: 'train-running-cost',
      magnitude: 200,
      tick: 1,
      referenceId: 'train-1',
    }));
    company = runningCost.company;
    company = requireAccepted(post(company, {
      category: 'delivery-revenue',
      magnitude: 700,
      tick: 2,
      referenceId: 'delivery-1',
      direction: 'reversal',
      reversalOf: revenue.entry.id,
    })).company;
    company = requireAccepted(post(company, {
      category: 'train-running-cost',
      magnitude: 200,
      tick: 2,
      referenceId: 'train-1',
      direction: 'reversal',
      reversalOf: runningCost.entry.id,
    })).company;

    expect(summariseProfitAndLoss(company, 1, 2)).toEqual({
      deliveryRevenue: 0,
      contractBonuses: 0,
      operatingExpenses: 0,
      railwayOperatingProfit: 0,
      capitalExpenditure: 0,
      cashFlow: 0,
    });
  });

  it.each([
    [-1, 1],
    [0.5, 1],
    [0, Number.MAX_SAFE_INTEGER + 1],
    [2, 1],
  ])('rejects an invalid inclusive period %s through %s', (fromTick, throughTick) => {
    expect(() => summariseProfitAndLoss(
      createCompanyState(1_000),
      fromTick,
      throughTick,
    )).toThrow(RangeError);
  });

  it('rejects unsafe category totals instead of rounding them', () => {
    let company = createCompanyState(Number.MAX_SAFE_INTEGER);
    company = requireAccepted(post(company, {
      category: 'vehicle-capex',
      magnitude: Number.MAX_SAFE_INTEGER,
      tick: 1,
    })).company;
    company = requireAccepted(post(company, {
      magnitude: Number.MAX_SAFE_INTEGER,
      tick: 2,
    })).company;
    company = requireAccepted(post(company, {
      category: 'vehicle-capex',
      magnitude: Number.MAX_SAFE_INTEGER,
      tick: 3,
    })).company;
    company = requireAccepted(post(company, {
      magnitude: Number.MAX_SAFE_INTEGER,
      tick: 4,
    })).company;

    expect(() => summariseProfitAndLoss(company, 1, 4)).toThrow(RangeError);
  });

  it.each([
    {
      name: 'a cash mismatch',
      mutate: (company: CompanyStateDef) => {
        company.cash += 1;
      },
    },
    {
      name: 'a duplicate ID',
      mutate: (company: CompanyStateDef) => {
        company.ledger[1].id = 1;
      },
    },
    {
      name: 'an invalid category policy',
      mutate: (company: CompanyStateDef) => {
        company.ledger[1].ledgerClass = 'operating-expense';
      },
    },
  ])('deliberately rejects invalid company state with $name', ({ mutate }) => {
    const accepted = requireAccepted(post(createCompanyState(1_000)));
    const malformed = cloneCompany(accepted.company);
    mutate(malformed);

    expect(() => summariseProfitAndLoss(malformed, 0, 1))
      .toThrow(new RangeError('Company ledger state is invalid.'));
  });
});
