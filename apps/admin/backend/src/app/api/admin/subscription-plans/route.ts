import { errorResponse } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { createPlanRequestSchema } from '@/lib/admin-plan-contracts';
import { PLAN_CREATE_FIELDS, PLAN_TIERS, buildPlanFilter, parsePlanQuery, toPlanRow, toTierCounts } from '@/lib/admin-plans';
import { createPlan } from '@/lib/admin-plan-writes';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listEnvelope, type Doc } from '@/lib/admin-stores';
import { assertCan, SubscriptionPlanModel } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/subscription-plans. The subscription plans for the operator console, oldest first, in the list
 * envelope: search by name and filter by tier. The answer also holds the number of plans per tier, for the tier
 * filter. Plans are edited through POST (create), PATCH .../:id and POST .../:id/archive (Sprint 6 EP-14, D-118).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request, 'plans.read');
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

/**
 * POST /api/admin/subscription-plans   (Sprint 6 EP-14.US01, D-118)
 *
 * Creates a plan: key (a unique slug), name, priceRs (whole rupees, 0 allowed), limits (null is unlimited), features, sortOrder, an optional
 * Stripe price id, and a reason of 3 to 300 characters that goes to the audit entry. The new plan is active at revision 0.
 *
 *   201 { plan }   400 ACCOUNT_BODY_INVALID { field }   401 no session   403 not an admin   409 PLAN_KEY_TAKEN
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'plans.write');
    requirePolicy(() => assertCan('admin', 'create', 'subscriptionPlans', PLAN_CREATE_FIELDS));
    const body = await readAdminBody(request, createPlanRequestSchema);
    const plan = await createPlan(userId, body);
    return Response.json({ plan }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
