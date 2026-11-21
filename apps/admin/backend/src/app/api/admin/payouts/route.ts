import { errorResponse } from '@/lib/admin-auth';
import { listHistory, makePayout, readAdminQuery } from '@/lib/admin-payouts';
import { readAdminBody } from '@/lib/admin-account';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { createPayoutRequestSchema, payoutListQuerySchema } from '@/lib/payout-contracts';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/payouts?page&limit&storeId&status (Sprint 4 EP-05.US03, D-090): the payout history across stores. A payout
 * stuck in pending_settle is in it, with its status, so it can be finished or released.
 *
 * POST /api/admin/payouts { storeId, expectedBalance, method, reference, note? }: records that the store was paid its whole
 * balance. expectedBalance is the balance the operator saw; if it moved, the answer is 409 PAYOUT_BALANCE_CHANGED (reload).
 *   200 { payout }   400 ACCOUNT_BODY_INVALID { field }   401 no session   403 not an admin, or the seller's email is not verified
 *   404 unknown store   409 balance changed, another payout in progress, nothing to pay, or no payout details   503 seller backend
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'payouts.manage');
    requirePolicy(() => assertCan('admin', 'read', 'payouts'));
    const query = readAdminQuery(request, payoutListQuerySchema);
    return Response.json(await listHistory(userId, query), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'payouts.manage');
    requirePolicy(() => assertCan('admin', 'create', 'payouts'));
    const body = await readAdminBody(request, createPayoutRequestSchema);
    return Response.json({ payout: await makePayout(userId, body) }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
