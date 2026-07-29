import {
  REGIONAL_DEVELOPMENT_GRANT,
  REGIONAL_DEVELOPMENT_GRANT_REFERENCE,
} from '../config/FreightProgression';
import type { CompanyStateDef } from '../economy/EconomyData';

export const countForwardRegionalDevelopmentGrants = (
  company: CompanyStateDef,
): number => company.ledger.filter((entry) =>
  entry.category === 'contract-bonus'
  && entry.ledgerClass === 'revenue'
  && entry.amount === REGIONAL_DEVELOPMENT_GRANT
  && entry.referenceId === REGIONAL_DEVELOPMENT_GRANT_REFERENCE
  && entry.reversalOf === undefined).length;
