import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authLimiter, NO_STORE, readAccountBody } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { upgradeRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { PAYMENT_REQUEST_RULE, requestUpgrade } from '@/lib/subscription-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/subscription/payments { planKey } (Sprint 6 EP-14, S6-B4, D-118): the seller asks to upgrade or renew. The AMOUNT is the plan's
 * price, read here: the body has no amount and a body that sends one is refused (400 with the field). Order: authenticate -> seller only ->
 * body (400 + field) -> assertCan -> DB -> the limiter -> the write.
 *
 *   201 { payment }   a new request, status requested (the seller then pays outside the platform and says so: POST .../claim)
 *   200 { payment }   the same unclaimed request again (a double click): nothing is written
 *   400 the body   401 no session   403 an admin session   404 PLAN_NOT_FOUND
 *   409 PAYMENT_OPEN   a payment is waiting to be checked
 *   422 PLAN_IS_FREE   a free plan has nothing to pay    422 USE_DOWNGRADE   a cheaper plan than the one in force
 *   429 RATE_LIMITED   10 requests per hour per seller
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const body = await readAccountBody(request, upgradeRequestSchema);
    assertCan(ctx.actor, 'create', 'subscriptionPayments', ['planKey']);
    await requireDatabase();
    await authLimiter.consume(PAYMENT_REQUEST_RULE, ctx.userId);
    const { payment, created } = await requestUpgrade(ctx.userId, body.planKey);
    return NextResponse.json({ payment }, { status: created ? 201 : 200, headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
