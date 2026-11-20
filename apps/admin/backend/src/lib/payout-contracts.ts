import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';

// @markaz/contracts is CommonJS: read it through the default object (see admin-account.ts), so the ES module test runner and
// the Next bundler agree. Sprint 4 EP-05.US03, US06: the payout and commission report request shapes.
const contracts = unwrapCjs(contractsNs) as typeof contractsNs;

export const {
  PAYOUT_CODES,
  commissionReportQuerySchema,
  commissionReportSchema,
  createPayoutRequestSchema,
  finishPayoutRequestSchema,
  payoutBalanceListQuerySchema,
  payoutDetailsRequestSchema,
  payoutListQuerySchema,
  voidPayoutRequestSchema,
} = contracts;
