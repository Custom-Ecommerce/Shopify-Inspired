import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authLimiter, NO_STORE, readAccountBody } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { downgradeRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { SUBSCRIPTION_CHANGE_RULE } from '@/lib/subscription-payments';
import { scheduleDowngrade } from '@/lib/subscription-changes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/subscription/downgrade { planKey | null } (Sprint 6 EP-14, S6-B4, D-118): moves to a cheaper plan FROM THE PERIOD END (the plan in
 * force does not change now: pendingPlanKey is stored and the expiry job applies it). null takes a pending downgrade back. Order: authenticate ->
 * seller only -> body (400 + field) -> assertCan -> DB -> the limiter -> the read of the seller's own subscription -> the write.
 *
 *   200 { subscription, open, payments }   the seller's subscription after the change
 *   400 the body   401 no session   403 an admin session   404 PLAN_NOT_FOUND
 *   409 NOTHING_TO_CHANGE   there is no paid plan in force    409 SUBSCRIPTION_CHANGED   it moved meanwhile
 *   422 NOT_A_DOWNGRADE   the plan is not cheaper
 *   422 DOWNGRADE_EXCEEDS_LIMITS { exceeds: [{ limit, allowed, used }] }   the use does not fit the cheaper plan: stores; products, staff seats and
 *       API keys of the store that uses the most of each. The seller's own store-limit override wins over the plan's store limit.
 *   429 RATE_LIMITED   20 per hour per seller
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const body = await readAccountBody(request, downgradeRequestSchema);
    assertCan(ctx.actor, 'read', 'subscriptions', ['planKey', 'status', 'pendingPlanKey']);
    await requireDatabase();
    await authLimiter.consume(SUBSCRIPTION_CHANGE_RULE, ctx.userId);
    return NextResponse.json(await scheduleDowngrade(ctx.userId, body.planKey), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
