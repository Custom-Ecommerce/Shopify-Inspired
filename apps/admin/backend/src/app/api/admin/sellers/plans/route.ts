import { errorResponse } from '@/lib/admin-auth';
import { parseSellerIds, sellerPlansFor } from '@/lib/admin-seller-plans';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sellers/plans?ids=<id>,<id>   (Sprint 6 EP-14.US02.T08, D-118)
 *
 * The plan, status and usage of the sellers on the page, read in the seller database through a signed call (D-093 pattern). Read only. It is a
 * separate call from the seller list on purpose: if the seller backend is down the list still shows, and only the plan column is missing (503).
 *
 *   200 { plans: [{ sellerId, plan, status, periodEnd, daysLeft, limits, used }] }
 *   400 ACCOUNT_BODY_INVALID { field: ids }   401 no session   403 not an admin   503 the seller backend is not reachable
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'subscriptions');
      assertCan('admin', 'read', 'users', ['name', 'email', 'storeLimitOverride']);
    });
    const ids = parseSellerIds(new URL(request.url).searchParams.get('ids'));
    return Response.json(await sellerPlansFor(userId, ids), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
