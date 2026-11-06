import { errorResponse } from '@/lib/admin-auth';
import { PLAN_TIERS, buildPlanFilter, parsePlanQuery, toPlanRow, toTierCounts } from '@/lib/admin-plans';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listEnvelope, type Doc } from '@/lib/admin-stores';
import { assertCan, SubscriptionPlanModel } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/subscription-plans. The subscription plans for the operator console, oldest first, in the list
 * envelope: search by name and filter by tier. The answer also holds the number of plans per tier, for the tier
 * filter. Read only: plan editing arrives in AF3 with its own policy tests.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'read', 'subscriptionPlans'));

    const parsed = parsePlanQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: 'Invalid request', issues: parsed.issues }, { status: 422, headers: NO_STORE });
    const { query } = parsed;
    const filter = buildPlanFilter(query) as never;

    const [rows, totalDocs, tierCounts] = await Promise.all([
      SubscriptionPlanModel.find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      SubscriptionPlanModel.countDocuments(filter),
      Promise.all(PLAN_TIERS.map((tier) => SubscriptionPlanModel.countDocuments({ tier } as never))),
    ]);
    const envelope = listEnvelope(
      (rows as unknown as Doc[]).map((doc) => toPlanRow(doc)),
      { page: query.page, limit: query.limit, totalDocs },
    );
    return Response.json({ ...envelope, counts: toTierCounts(tierCounts) }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
