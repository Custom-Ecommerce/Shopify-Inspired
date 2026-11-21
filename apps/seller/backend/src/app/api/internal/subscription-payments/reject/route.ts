import type { NextRequest } from 'next/server';
import { internalDecidePaymentRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';
import { rejectPayment } from '@/lib/subscription-payment-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/subscription-payments/reject { paymentId, reason }. Signed by the admin backend (D-093). A requested or claimed payment is
 * refused (reason of 5 or more characters); nothing else changes and the seller is told.
 *
 *   200 { payment }   401 not signed   404 unknown payment   422 bad body   409 PAYMENT_NOT_OPEN   409 PAYMENT_ALREADY_DECIDED
 */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, internalDecidePaymentRequestSchema, (input, adminId) => rejectPayment(input, adminId));
}
