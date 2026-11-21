import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { NO_STORE } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { readOwnSubscription } from '@/lib/subscription-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/subscription (Sprint 6 EP-14, S6-B4, D-118): the signed-in seller's OWN subscription, their open payment (if any) and their last 20
 * payments. The plan belongs to the seller, not to a store, so there is no store id. Order: authenticate -> seller only -> assertCan -> DB ->
 * the read, scoped by the session's user id (never by an id from the request).
 *
 *   200 { subscription | null, open | null, payments }   401 no session   403 an admin session
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'subscriptions', ['planKey', 'status', 'currentPeriodEnd', 'cancelAtPeriodEnd', 'pendingPlanKey']);
    assertCan(ctx.actor, 'read', 'subscriptionPayments', ['planKey', 'amountRs', 'status', 'method', 'reference', 'periodEnd']);
    await requireDatabase();
    return NextResponse.json(await readOwnSubscription(ctx.userId), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
