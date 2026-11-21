import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';

/** Sprint 6 EP-14: the plan request schemas, read through the CommonJS wrapper like the other admin contracts (see admin-account.ts). */
const contracts = unwrapCjs(contractsNs) as typeof contractsNs;
export const { createPlanRequestSchema, updatePlanRequestSchema, archivePlanRequestSchema } = contracts;
