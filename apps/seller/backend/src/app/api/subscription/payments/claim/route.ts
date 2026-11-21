import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authLimiter, NO_STORE, readAccountBody } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { claimPaymentRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { PAYMENT_CLAIM_RULE, claimPayment } from '@/lib/subscription-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/subscription/payments/claim { paymentId, method, reference, proofUrl? } (Sprint 6 EP-14, S6-B4, D-118): "I paid". requested ->
 * claimed in ONE compare-and-set, with the method, the transfer reference and an optional https link to the proof. The platform's support
 * address is told (queued after the response). Order: authenticate -> seller only -> body (400 + field) -> assertCan -> DB -> the limiter ->
 * findOne({ _id, seller }) -> the write -> the audit.
 *
 *   200 { payment }   400 the body   401 no session   403 an admin session
 *   404 the payment is not found, or it is another seller's (the same answer: nothing says it exists)
 *   409 PAYMENT_NOT_REQUESTED   it was already sent for checking, or was decided
 *   429 RATE_LIMITED   10 per hour per seller
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const body = await readAccountBody(request, claimPaymentRequestSchema);
    assertCan(ctx.actor, 'update', 'subscriptionPayments', ['method', 'reference', 'proofUrl', 'status', 'claimedAt']);
    await requireDatabase();
    await authLimiter.consume(PAYMENT_CLAIM_RULE, ctx.userId);
    const payment = await claimPayment(ctx.userId, body);
    return NextResponse.json({ payment }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
