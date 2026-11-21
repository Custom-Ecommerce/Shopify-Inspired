import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';

// @markaz/contracts is CommonJS: read it through the default object (see admin-account.ts), so the ES module test runner and the Next bundler agree.
// Sprint 6 EP-14 (S6-B4): the admin's subscription payment request shapes.
const contracts = unwrapCjs(contractsNs) as typeof contractsNs;

export const { adminPaymentListQuerySchema, confirmPaymentBodySchema, decidePaymentBodySchema } = contracts;
