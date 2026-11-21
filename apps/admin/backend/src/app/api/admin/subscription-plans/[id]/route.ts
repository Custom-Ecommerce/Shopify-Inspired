import mongoose from 'mongoose';
import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { updatePlanRequestSchema } from '@/lib/admin-plan-contracts';
import { PLAN_WRITE_FIELDS } from '@/lib/admin-plans';
import { updatePlan } from '@/lib/admin-plan-writes';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/subscription-plans/:id   (Sprint 6 EP-14.US01, D-118)
 *
 * Changes the fields sent (name, priceRs, limits, features, sortOrder, stripePriceId, isActive). The key never changes. The body carries the
 * revision the admin saw and a reason of 3 to 300 characters. The write applies only if the revision is still that one (409), advances it,
 * and is audited with the reason and the values before and after. Archiving is a separate call (POST .../archive).
 *
 *   200 { plan }   400 ACCOUNT_BODY_INVALID { field }   401 no session   403 not an admin   404 unknown plan
 *   409 PLAN_REVISION_CHANGED
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'update', 'subscriptionPlans', PLAN_WRITE_FIELDS);
      // The revision is moved by the server, never by the operator.
      assertCan('system', 'update', 'subscriptionPlans');
    });
    const body = await readAdminBody(request, updatePlanRequestSchema);
    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Plan not found');
    const plan = await updatePlan(userId, id, body);
    return Response.json({ plan }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
