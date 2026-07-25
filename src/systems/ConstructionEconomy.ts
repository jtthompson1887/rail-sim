import {
  DEMOLITION_REFUND_RATE,
  startingCashForDifficulty,
} from '../config/ConstructionConfig';
import type { CompanyConstructionState } from '../config/WorldData';

export { startingCashForDifficulty };
export type { CompanyConstructionState };

export interface ConstructionTransaction {
  amount: number;
  beforeCash: number;
  afterCash: number;
}

interface TransactionMetadata {
  state: 'applied' | 'reversed';
}

function isValidCash(cash: number): boolean {
  return Number.isSafeInteger(cash) && cash >= 0;
}

function isValidAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount !== 0;
}

export function demolitionRefund(paidBuildCost: number): number {
  if (!Number.isSafeInteger(paidBuildCost) || paidBuildCost < 0) return 0;
  return Math.floor(paidBuildCost * DEMOLITION_REFUND_RATE);
}

/**
 * Pure construction-cash state machine. It mutates only the injected company
 * state and tracks transaction identity in memory for command undo/redo.
 */
export class ConstructionEconomy {
  private readonly transactionMetadata =
    new WeakMap<ConstructionTransaction, TransactionMetadata>();

  constructor(private readonly company: CompanyConstructionState) {}

  canAfford(amount: number): boolean {
    if (!isValidCash(this.company.cash)
      || !Number.isSafeInteger(amount)
      || amount <= 0) {
      return false;
    }
    return this.company.cash - amount >= 0;
  }

  purchase(amount: number): ConstructionTransaction | null {
    if (!this.canAfford(amount)) return null;
    return this.applySignedAmount(amount);
  }

  refundDemolition(paidBuildCost: number): ConstructionTransaction | null {
    const refund = demolitionRefund(paidBuildCost);
    if (refund === 0) return null;
    return this.applySignedAmount(-refund);
  }

  private applySignedAmount(amount: number): ConstructionTransaction | null {
    if (!isValidCash(this.company.cash)
      || !isValidAmount(amount)
      || !Number.isSafeInteger(this.company.cash - amount)
      || this.company.cash - amount < 0) {
      return null;
    }
    const beforeCash = this.company.cash;
    const transaction = Object.freeze({
      amount,
      beforeCash,
      afterCash: beforeCash - amount,
    });
    this.company.cash = transaction.afterCash;
    this.transactionMetadata.set(transaction, { state: 'applied' });
    return transaction;
  }

  reverse(transaction: ConstructionTransaction): boolean {
    if (!this.isKnownValidTransaction(transaction, 'applied')
      || this.company.cash !== transaction.afterCash) {
      return false;
    }
    const metadata = this.transactionMetadata.get(transaction)!;
    this.company.cash = transaction.beforeCash;
    metadata.state = 'reversed';
    return true;
  }

  reapply(transaction: ConstructionTransaction): boolean {
    if (!this.isKnownValidTransaction(transaction, 'reversed')
      || this.company.cash !== transaction.beforeCash) {
      return false;
    }
    const metadata = this.transactionMetadata.get(transaction)!;
    this.company.cash = transaction.afterCash;
    metadata.state = 'applied';
    return true;
  }

  private isKnownValidTransaction(
    transaction: ConstructionTransaction,
    expectedState: TransactionMetadata['state'],
  ): boolean {
    return this.transactionMetadata.get(transaction)?.state === expectedState
      && isValidAmount(transaction.amount)
      && isValidCash(transaction.beforeCash)
      && isValidCash(transaction.afterCash)
      && transaction.afterCash === transaction.beforeCash - transaction.amount;
  }
}
