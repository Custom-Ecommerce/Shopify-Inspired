import { errorResponse } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { viewPayoutDetails } from '@/lib/admin-payouts';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { payoutDetailsRequestSchema } from '@/lib/payout-contracts';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/payouts/details { storeId } (Sprint 4 EP-05.US03, D-088): the FULL payout account of one store, so the
 * operator can send the money. It is a POST so it is never cached or prefetched. Admin only; every call is audited as
 * payout_details_viewed BEFORE the number is fetched (no entry, no number), and the entry never holds the number.
 *   200 { details: { storeId, method, accountTitle, accountNumber, bankName } }   404 no payout details   503 not recorded
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'payouts.manage');
    requirePolicy(() => assertCan('admin', 'read', 'payoutDetails'));
    const body = await readAdminBody(request, payoutDetailsRequestSchema);
    return Response.json({ details: await viewPayoutDetails(userId, body.storeId) }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
