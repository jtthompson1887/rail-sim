import type {
  CompanyStateDef,
  LedgerCategory,
  LedgerClass,
  LedgerEntryDef,
} from './EconomyData';

export interface LedgerPostRequest {
  category: LedgerCategory;
  magnitude: number;
  tick: number;
  referenceId: string;
  direction: 'forward' | 'reversal';
  reversalOf?: number;
}

export type LedgerRejectionCode =
  | 'invalid-company'
  | 'invalid-magnitude'
  | 'invalid-tick'
  | 'invalid-reference'
  | 'invalid-category'
  | 'invalid-direction'
  | 'unsafe-ledger-id'
  | 'unsafe-balance'
  | 'insufficient-cash'
  | 'opening-balance-reserved'
  | 'reversal-target-required'
  | 'unexpected-reversal-target'
  | 'opening-balance-reversal'
  | 'reversal-target-not-found'
  | 'reversal-target-already-reversed'
  | 'reversal-target-is-reversal'
  | 'reversal-mismatch';

export type LedgerPostResult =
  | {
    ok: true;
    company: CompanyStateDef;
    entry: LedgerEntryDef;
  }
  | {
    ok: false;
    code: LedgerRejectionCode;
    company: CompanyStateDef;
  };

export interface ProfitAndLoss {
  revenue: number;
  operatingExpenses: number;
  operatingProfit: number;
  capitalExpenditure: number;
  cashFlow: number;
}

interface CategoryPolicy {
  ledgerClass: LedgerClass;
  forwardSign: 1 | -1;
}

const CATEGORY_POLICIES: Record<LedgerCategory, CategoryPolicy> = {
  'opening-balance': {
    ledgerClass: 'opening',
    forwardSign: 1,
  },
  'construction-capex': {
    ledgerClass: 'capital-expenditure',
    forwardSign: -1,
  },
  'construction-refund': {
    ledgerClass: 'capital-expenditure',
    forwardSign: 1,
  },
  'vehicle-capex': {
    ledgerClass: 'capital-expenditure',
    forwardSign: -1,
  },
  'delivery-revenue': {
    ledgerClass: 'revenue',
    forwardSign: 1,
  },
  'contract-bonus': {
    ledgerClass: 'revenue',
    forwardSign: 1,
  },
  'train-running-cost': {
    ledgerClass: 'operating-expense',
    forwardSign: -1,
  },
  'port-handling': {
    ledgerClass: 'operating-expense',
    forwardSign: -1,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isLedgerCategory = (value: unknown): value is LedgerCategory =>
  typeof value === 'string'
  && Object.prototype.hasOwnProperty.call(CATEGORY_POLICIES, value);

const freezeEntry = (entry: LedgerEntryDef): LedgerEntryDef =>
  Object.freeze(entry);

const freezeCompany = (
  cash: number,
  nextLedgerId: number,
  ledger: LedgerEntryDef[],
): CompanyStateDef => Object.freeze({
  cash,
  nextLedgerId,
  ledger: Object.freeze(ledger) as LedgerEntryDef[],
});

const rejected = (
  company: CompanyStateDef,
  code: LedgerRejectionCode,
): LedgerPostResult => ({
  ok: false,
  code,
  company,
});

const addSafe = (left: number, right: number): number | null => {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
};

type CompanyValidationResult =
  | { valid: true }
  | {
    valid: false;
    postCode: 'invalid-company' | 'unsafe-ledger-id';
  };

const validateCompanyState = (
  value: unknown,
): CompanyValidationResult => {
  if (!isRecord(value)
    || !isNonNegativeSafeInteger(value.cash)
    || !Array.isArray(value.ledger)
    || value.ledger.length === 0
    || !isPositiveSafeInteger(value.nextLedgerId)) {
    return { valid: false, postCode: 'invalid-company' };
  }
  if (value.nextLedgerId === Number.MAX_SAFE_INTEGER) {
    return { valid: false, postCode: 'unsafe-ledger-id' };
  }
  if (value.nextLedgerId !== value.ledger.length + 1) {
    return { valid: false, postCode: 'invalid-company' };
  }

  const reversedTargets = new Set<number>();
  let runningCash = 0;
  for (let index = 0; index < value.ledger.length; index += 1) {
    const candidate = value.ledger[index];
    if (!isRecord(candidate)
      || candidate.id !== index + 1
      || !isNonNegativeSafeInteger(candidate.tick)
      || !Number.isSafeInteger(candidate.amount)
      || typeof candidate.referenceId !== 'string'
      || candidate.referenceId.length === 0
      || !isLedgerCategory(candidate.category)) {
      return { valid: false, postCode: 'invalid-company' };
    }

    const entry = candidate as unknown as LedgerEntryDef;
    const policy = CATEGORY_POLICIES[entry.category];
    if (entry.ledgerClass !== policy.ledgerClass) {
      return { valid: false, postCode: 'invalid-company' };
    }

    if (index === 0) {
      if (entry.tick !== 0
        || entry.category !== 'opening-balance'
        || entry.referenceId !== 'opening-balance'
        || entry.reversalOf !== undefined
        || entry.amount < 0) {
        return { valid: false, postCode: 'invalid-company' };
      }
    } else if (entry.category === 'opening-balance' || entry.amount === 0) {
      return { valid: false, postCode: 'invalid-company' };
    } else if (entry.reversalOf === undefined) {
      if (Math.sign(entry.amount) !== policy.forwardSign) {
        return { valid: false, postCode: 'invalid-company' };
      }
    } else {
      if (!isPositiveSafeInteger(entry.reversalOf)
        || entry.reversalOf >= entry.id
        || reversedTargets.has(entry.reversalOf)) {
        return { valid: false, postCode: 'invalid-company' };
      }
      const target = value.ledger[entry.reversalOf - 1];
      if (!isRecord(target)
        || target.reversalOf !== undefined
        || target.category !== entry.category
        || target.ledgerClass !== entry.ledgerClass
        || target.referenceId !== entry.referenceId
        || target.amount !== -entry.amount) {
        return { valid: false, postCode: 'invalid-company' };
      }
      reversedTargets.add(entry.reversalOf);
    }

    const nextCash = addSafe(runningCash, entry.amount);
    if (nextCash === null || nextCash < 0) {
      return { valid: false, postCode: 'invalid-company' };
    }
    runningCash = nextCash;
  }

  return runningCash === value.cash
    ? { valid: true }
    : { valid: false, postCode: 'invalid-company' };
};

export const createCompanyState = (
  startingCash: number,
): CompanyStateDef => {
  if (!isNonNegativeSafeInteger(startingCash)) {
    throw new RangeError('Starting cash must be a non-negative safe integer.');
  }

  const openingEntry = freezeEntry({
    id: 1,
    tick: 0,
    category: 'opening-balance',
    ledgerClass: 'opening',
    amount: startingCash,
    referenceId: 'opening-balance',
  });
  return freezeCompany(startingCash, 2, [openingEntry]);
};

export const postLedgerEntry = (
  company: CompanyStateDef,
  request: LedgerPostRequest,
): LedgerPostResult => {
  const companyValidation = validateCompanyState(company);
  if (companyValidation.valid === false) {
    return rejected(company, companyValidation.postCode);
  }
  if (!isRecord(request) || !isPositiveSafeInteger(request.magnitude)) {
    return rejected(company, 'invalid-magnitude');
  }
  if (!isNonNegativeSafeInteger(request.tick)) {
    return rejected(company, 'invalid-tick');
  }
  if (typeof request.referenceId !== 'string'
    || request.referenceId.length === 0) {
    return rejected(company, 'invalid-reference');
  }
  if (!isLedgerCategory(request.category)) {
    return rejected(company, 'invalid-category');
  }
  if (request.direction !== 'forward' && request.direction !== 'reversal') {
    return rejected(company, 'invalid-direction');
  }
  if (request.category === 'opening-balance'
    && request.direction === 'forward') {
    return rejected(company, 'opening-balance-reserved');
  }

  const policy = CATEGORY_POLICIES[request.category];
  let amount = request.magnitude * policy.forwardSign;
  let ledgerClass = policy.ledgerClass;
  let reversalOf: number;

  if (request.direction === 'forward') {
    if (request.reversalOf !== undefined) {
      return rejected(company, 'unexpected-reversal-target');
    }
  } else {
    if (request.reversalOf === undefined) {
      return rejected(company, 'reversal-target-required');
    }
    if (request.category === 'opening-balance') {
      return rejected(company, 'opening-balance-reversal');
    }
    const target = company.ledger.find(
      (entry) => entry.id === request.reversalOf,
    );
    if (target === undefined || target.id >= company.nextLedgerId) {
      return rejected(company, 'reversal-target-not-found');
    }
    if (target.reversalOf !== undefined) {
      return rejected(company, 'reversal-target-is-reversal');
    }
    if (company.ledger.some(
      (entry) => entry.reversalOf === target.id,
    )) {
      return rejected(company, 'reversal-target-already-reversed');
    }
    if (target.category !== request.category
      || target.referenceId !== request.referenceId
      || Math.abs(target.amount) !== request.magnitude) {
      return rejected(company, 'reversal-mismatch');
    }
    amount = -target.amount;
    ledgerClass = target.ledgerClass;
    reversalOf = target.id;
  }

  const nextCash = addSafe(company.cash, amount);
  if (nextCash === null) {
    return rejected(company, 'unsafe-balance');
  }
  if (nextCash < 0) {
    return rejected(company, 'insufficient-cash');
  }

  const entry = freezeEntry({
    id: company.nextLedgerId,
    tick: request.tick,
    category: request.category,
    ledgerClass,
    amount,
    referenceId: request.referenceId,
    ...(reversalOf === undefined ? {} : { reversalOf }),
  });
  const existingEntries = company.ledger.map(
    (existingEntry) => freezeEntry({ ...existingEntry }),
  );
  const nextCompany = freezeCompany(
    nextCash,
    company.nextLedgerId + 1,
    [...existingEntries, entry],
  );
  return {
    ok: true,
    company: nextCompany,
    entry,
  };
};

const checkedTotal = (current: number, amount: number): number => {
  const total = addSafe(current, amount);
  if (total === null) {
    throw new RangeError('Ledger summary exceeds safe integer bounds.');
  }
  return total;
};

export const summariseProfitAndLoss = (
  company: CompanyStateDef,
  fromTick: number,
  throughTick: number,
): ProfitAndLoss => {
  if (validateCompanyState(company).valid === false) {
    throw new RangeError('Company ledger state is invalid.');
  }
  if (!isNonNegativeSafeInteger(fromTick)
    || !isNonNegativeSafeInteger(throughTick)
    || fromTick > throughTick) {
    throw new RangeError('Ledger period must use ordered safe integer ticks.');
  }

  let revenue = 0;
  let operatingExpenses = 0;
  let capitalExpenditure = 0;
  let cashFlow = 0;

  company.ledger.forEach((entry) => {
    if (entry.tick < fromTick || entry.tick > throughTick) return;

    cashFlow = checkedTotal(cashFlow, entry.amount);
    if (entry.ledgerClass === 'revenue') {
      revenue = checkedTotal(revenue, entry.amount);
    } else if (entry.ledgerClass === 'operating-expense') {
      operatingExpenses = checkedTotal(operatingExpenses, -entry.amount);
    } else if (entry.ledgerClass === 'capital-expenditure') {
      capitalExpenditure = checkedTotal(
        capitalExpenditure,
        -entry.amount,
      );
    }
  });

  return {
    revenue,
    operatingExpenses,
    operatingProfit: checkedTotal(revenue, -operatingExpenses),
    capitalExpenditure,
    cashFlow,
  };
};
