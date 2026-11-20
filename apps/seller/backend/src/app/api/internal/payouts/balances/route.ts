import type { NextRequest } from 'next/server';
import { payoutBalanceListQuerySchema } from '@/lib/contracts';
import { signedQuery } from '@/lib/internal-query';
import { listBalances } from '@/lib/payouts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/internal/payouts/balances?page&limit&q (signed by the admin backend). The balance of every store with unsettled
 * ledger entries: signed whole rupees, the entry count, the payout method and last 4, and whether the owner's email is verified.
 */
export function GET(request: NextRequest): Promise<Response> {
  return signedQuery(request, payoutBalanceListQuerySchema, (query) => listBalances(query));
}
