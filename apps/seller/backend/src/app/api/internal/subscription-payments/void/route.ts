import type { NextRequest } from 'next/server';
import { internalDecidePaymentRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';
import { voidPayment } from '@/lib/subscription-payment-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/subscription-payments/void { paymentId, reason }. Signed by the admin backend (D-093). Closes a requested or claimed payment, or
 * takes back a confirmed one (the subscription goes back to what it was, only while nothing else changed it). TODO(S6-B6): a confirmed payment
 * is voided by the owner level only once the admin levels exist.
 *
 *   200 { payment }   401 not signed   404 unknown payment   422 bad body
 *   409 PAYMENT_NOT_VOIDABLE   409 PAYMENT_ALREADY_DECIDED   409 SUBSCRIPTION_CHANGED
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalDecidePaymentRequestSchema, (input, adminId) => voidPayment(input, adminId));
}
