import { errorResponse } from '@/lib/admin-auth';
import { listBalances, readAdminQuery } from '@/lib/admin-payouts';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { payoutBalanceListQuerySchema } from '@/lib/payout-contracts';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/payouts/balances?page&limit&q (Sprint 4 EP-05.US03): what the platform owes each store (signed whole rupees),
 * the unsettled entry count, the payout method and last 4, and whether the seller's email is verified. A zero or negative
 * balance is listed and cannot be paid: it carries forward.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'payouts.manage');
    requirePolicy(() => assertCan('admin', 'read', 'payouts'));
    const query = readAdminQuery(request, payoutBalanceListQuerySchema);
    return Response.json(await listBalances(userId, query), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
