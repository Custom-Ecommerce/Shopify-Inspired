import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';

const contracts = unwrapCjs(contractsNs) as typeof contractsNs;
export const { retryRequestSchema, retentionRunRequestSchema, RETRY_CAP } = contracts;
