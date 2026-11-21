import mongoose from 'mongoose';
import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { archivePlanRequestSchema } from '@/lib/admin-plan-contracts';
import { archivePlan } from '@/lib/admin-plan-writes';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/subscription-plans/:id/archive   body: { revision, reason }   (Sprint 6 EP-14.US01, D-118)
 *
 * Takes a plan off sale: it stays in the database (nothing is ever deleted) and keeps counting for the sellers already on it. A reason of 3
 * to 300 characters is required and goes to the audit entry. The write is conditional on the revision the admin saw. The Free plan cannot be
 * archived: it is the plan every seller falls back to.
 *
 *   200 { plan }   400 ACCOUNT_BODY_INVALID { field }   401 no session   403 not an admin   404 unknown plan
 *   409 PLAN_REVISION_CHANGED, PLAN_ARCHIVED (already archived) or PLAN_PROTECTED (Free)
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'update', 'subscriptionPlans', ['isActive', 'archivedAt']);
      assertCan('system', 'update', 'subscriptionPlans');
    });
    const body = await readAdminBody(request, archivePlanRequestSchema);
    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Plan not found');
    const plan = await archivePlan(userId, id, body);
    return Response.json({ plan }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
