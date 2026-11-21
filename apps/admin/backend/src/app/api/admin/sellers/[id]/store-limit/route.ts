import mongoose from 'mongoose';
import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { readAdminBody, sellerStoreLimitRequestSchema } from '@/lib/admin-account';
import { changeStoreLimit, readStoreLimit } from '@/lib/admin-store-limit';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sellers/:id/store-limit   (Sprint 6 EP-12.US02.T03)
 *
 * The seller's store limit as the Store limit dialog shows it: the override, the effective limit and where it comes from
 * (override, plan, setting or env), how many stores the seller has, and what each step would give.
 *
 *   200 { seller: { id, name, email, storeLimitOverride, effectiveLimit, source, storesUsed, planLimit, platformMax, envMax } }
 *   401 no session   403 not an admin, or not a seller account (NOT_A_SELLER)   404 unknown seller
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await authorizeAdmin(request, 'sellers.read');
    requirePolicy(() => {
      assertCan('admin', 'read', 'users', ['name', 'email', 'storeLimitOverride']);
      assertCan('admin', 'read', 'stores');
    });
    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Seller not found');
    return Response.json({ seller: await readStoreLimit(id) }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/admin/sellers/:id/store-limit   body: { storeLimitOverride: integer >= 1 | null, reason }   (Sprint 6 EP-12.US02.T02, D-118)
 *
 * Sets, or with null clears, the seller's store-limit override. A reason of 3 to 300 characters is always required and goes to the audit
 * entry. The override wins over the plan, the platform setting and the environment. Only an admin may write it. A seller who already has
 * more stores than a lowered limit keeps them; they can only not add more.
 *
 *   200 { seller: { id, storeLimitOverride, changed } }   400 ACCOUNT_BODY_INVALID { field }   401 no session
 *   403 not an admin, or not a seller account (NOT_A_SELLER)   404 unknown seller   409 changed by someone else
 *   503 the seller backend is not reachable (nothing was changed)
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'sellers.store_limit');
    requirePolicy(() => assertCan('admin', 'update', 'sellers', ['storeLimitOverride']));
    const body = await readAdminBody(request, sellerStoreLimitRequestSchema);
    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Seller not found');

    const seller = await changeStoreLimit({ adminId: userId, sellerId: id, storeLimitOverride: body.storeLimitOverride, reason: body.reason });
    return Response.json({ seller }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
