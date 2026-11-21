import type { NextRequest } from 'next/server';
import { internalConfirmPaymentRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';
import { confirmPayment } from '@/lib/subscription-payment-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/subscription-payments/confirm { paymentId, amountRs, reason }. Signed by the admin backend (MODERATION_API_SECRET, D-093); a
 * seller session means nothing here, so a seller can never confirm their own payment. Only a CLAIMED payment, at the amount the admin saw,
 * is confirmed, in ONE compare-and-set: a double confirm has exactly one effect. The subscription is created or extended and the seller is
 * told. The audit line names the admin, the amount, the method, the reference and the period.
 *
 *   200 { payment }   401 not signed   404 unknown payment   422 bad body
 *   409 PAYMENT_NOT_CLAIMED (rejected, void, requested, already confirmed)   409 PAYMENT_AMOUNT_MISMATCH   409 PAYMENT_ALREADY_DECIDED
 *   409 SUBSCRIPTION_CHANGED (nothing was changed; try again)   409 PLAN_GONE
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalConfirmPaymentRequestSchema, (input, adminId) => confirmPayment(input, adminId));
}
