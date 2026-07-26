import {
  DEMOLITION_REFUND_RATE,
  startingCashForDifficulty,
} from '../config/ConstructionConfig';
import type { CompanyStateDef } from '../economy/EconomyData';
import {
  postLedgerEntry,
  type LedgerPostResult,
} from '../economy/FinanceLedger';

export { startingCashForDifficulty };

export type ConstructionTransactionResult = LedgerPostResult;

export interface ConstructionTransactionRequest {
  kind: 'purchase' | 'demolition-refund';
  magnitude: number;
  referenceId: string;
  direction: 'forward' | 'reversal';
  reversalOf?: number;
}

export function demolitionRefund(paidBuildCost: number): number {
  if (!Number.isSafeInteger(paidBuildCost) || paidBuildCost < 0) return 0;
  return Math.floor(paidBuildCost * DEMOLITION_REFUND_RATE);
}

export function applyConstructionTransaction(
  company: CompanyStateDef,
  request: ConstructionTransactionRequest,
  tick: number,
): ConstructionTransactionResult {
  return postLedgerEntry(company, {
    category: request.kind === 'purchase'
      ? 'construction-capex'
      : 'construction-refund',
    magnitude: request.magnitude,
    tick,
    referenceId: request.referenceId,
    direction: request.direction,
    ...(request.reversalOf === undefined
      ? {}
      : { reversalOf: request.reversalOf }),
  });
}
