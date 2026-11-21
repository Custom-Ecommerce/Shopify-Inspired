import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authLimiter, NO_STORE, readAccountBody } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { cancelRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { SUBSCRIPTION_CHANGE_RULE } from '@/lib/subscription-payments';
import { setCancelAtPeriodEnd } from '@/lib/subscription-changes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/subscription/cancel { cancelAtPeriodEnd } (Sprint 6 EP-14, S6-B4, D-118): true stops the subscription at the period end (the plan
 * stays until then, then the Free limits apply with no grace); false takes that back. Setting the value it already has is a 200 and writes
 * nothing. Order: authenticate -> seller only -> body (400 + field) -> assertCan -> DB -> the limiter -> the read -> ONE compare-and-set.
 *
 *   200 { subscription, open, payments }   400 the body   401 no session   403 an admin session
 *   409 NOTHING_TO_CHANGE   no paid plan    409 SUBSCRIPTION_NOT_ACTIVE   not in a paid running period    409 SUBSCRIPTION_CHANGED
 *   429 RATE_LIMITED   20 per hour per seller
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const body = await readAccountBody(request, cancelRequestSchema);
    assertCan(ctx.actor, 'read', 'subscriptions', ['planKey', 'status', 'cancelAtPeriodEnd']);
    await requireDatabase();
    await authLimiter.consume(SUBSCRIPTION_CHANGE_RULE, ctx.userId);
    return NextResponse.json(await setCancelAtPeriodEnd(ctx.userId, body.cancelAtPeriodEnd), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
