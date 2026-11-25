import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { buildPlanUsage } from '@/lib/plan-usage';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/plan-usage (Sprint 6 EP-14.US02, D-118): the plan the seller is effectively on and what is in use. Order: authenticate ->
 * seller only -> assertCan -> DB -> id -> resolveOwnedStoreId -> findOne({ _id, owner }) -> the read. Read only: nothing is written, whatever the
 * dates say.
 *
 *   200 { plan, status, subscribedPlanKey, limits, used, periodEnd, graceUntil, daysLeft, storeLimitOverridden, fallbackLimits }
 *       status: trial | active | grace | expired | cancelled | none (no subscription). Expired, cancelled past its period and none show the Free
 *       limits; limits.stores is the admin's override when there is one.
 *       used.products, used.staffSeats (invited and active members) and used.apiKeys (not revoked) are those of THIS store.
 *   401 no session   403 an admin session, or a store that is not this seller's   404 unknown store
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'stores', ['name']);
    assertCan(ctx.actor, 'read', 'subscriptions', ['planKey', 'status']);
    const { id } = await context.params;
    const store = await loadOwnedStore(request, ctx, id, 'name owner', 'billing.manage');
    return NextResponse.json(await buildPlanUsage(ctx.userId, String((store as unknown as { _id: unknown })._id)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
