import mongoose from 'mongoose';
import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { finishStuckPayout } from '@/lib/admin-payouts';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/payouts/:id/finish (Sprint 4 EP-05.US03, D-090): the "finish or release" step for a payout left in
 * pending_settle (a request died halfway). It becomes paid when the ledger entries it holds are exactly what it says,
 * otherwise its entries are released and it becomes failed. Idempotent; any other state is answered as it is.
 *   200 { payout }   403 not an admin   404 unknown payout   503 seller backend
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'update', 'payouts'));
    const { id } = await context.params;
    if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Payout not found');
    return Response.json({ payout: await finishStuckPayout(userId, { payoutId: id }) }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
