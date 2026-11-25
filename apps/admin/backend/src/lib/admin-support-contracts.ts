import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';

const contracts = unwrapCjs(contractsNs) as typeof contractsNs;
export const { ticketReplySchema, ticketStatusUpdateSchema, ticketListQuerySchema, contactListQuerySchema } = contracts;
