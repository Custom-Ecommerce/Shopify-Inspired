import mongoose from 'mongoose';
import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { voidExistingPayout } from '@/lib/admin-payouts';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { voidPayoutRequestSchema } from '@/lib/payout-contracts';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/payouts/:id/void { reason } (Sprint 4 EP-05.US03, D-090): takes a payout back. Its ledger entries are
 * released and count in the store's balance again; the seller is told by email. A repeat is a harmless 200. The reason is 3 to
 * 500 characters. A payout stuck in pending_settle is finished or released first.
 *   200 { payout }   400 ACCOUNT_BODY_INVALID { field }   403 not an admin   404 unknown payout
 *   409 the payout failed (nothing to void)   503 seller backend
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'update', 'payouts'));
    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Payout not found');
    // The id is the path's; the body carries the reason only (an id in the body is refused like any unknown key).
    const body = await readAdminBody(request, voidPayoutRequestSchema.omit({ payoutId: true }));
    return Response.json({ payout: await voidExistingPayout(userId, { payoutId: id, reason: body.reason }) }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
