import mongoose from 'mongoose';
import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { readAdminBody, sellerAccountStatusRequestSchema } from '@/lib/admin-account';
import { changeSellerStatus } from '@/lib/admin-seller-status';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sellers/:id/status   body: { status: 'suspended' | 'active', reason? }   (EP-08.US03.T02, D-093)
 *
 * Suspends (a reason of 3 to 300 characters is required) or unsuspends a seller account. The seller's every request is
 * then refused with 401 ACCOUNT_SUSPENDED within 30 seconds (at once on the instance that applied it), and login answers
 * the generic error. A suspended seller's storefront stays up unless the store itself is taken down (D-093).
 *
 *   200 { seller: { id, accountStatus, changed } }   400 ACCOUNT_BODY_INVALID { field }   401 no session
 *   403 not an admin, your own account (SELF_SUSPEND), or another admin (NOT_A_SELLER)   404 unknown seller
 *   409 changed by someone else, or blocked   503 the seller backend is not reachable (nothing was changed)
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'update', 'sellers', ['accountStatus']));
    const body = await readAdminBody(request, sellerAccountStatusRequestSchema);
    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Seller not found');

    const seller = await changeSellerStatus({
      adminId: userId,
      sellerId: id,
      status: body.status,
      reason: body.status === 'suspended' ? (body.reason ?? null) : null,
    });
    return Response.json({ seller }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
