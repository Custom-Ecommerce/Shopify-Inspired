import { errorResponse } from '@/lib/admin-auth';
import { decidePaymentFor } from '@/lib/admin-subscription-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/subscription-payments/:id/confirm { amountRs, reason } (Sprint 6 EP-14, S6-B4, D-118). The admin confirms that the money is in:
 * a CLAIMED payment, at the amount shown (a different amount is a 409: the screen was stale), becomes a paid period and the seller's plan is
 * active until its end. A reason of 3 or more characters is required. A double confirm has exactly one effect (the second is a 409).
 *
 *   200 { payment }   400 ACCOUNT_BODY_INVALID { field }   401 no session   403 not an admin   404 unknown payment
 *   409 PAYMENT_NOT_CLAIMED | PAYMENT_AMOUNT_MISMATCH | PAYMENT_ALREADY_DECIDED | SUBSCRIPTION_CHANGED | PLAN_GONE   503 the seller backend
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    return await decidePaymentFor(request, context, 'confirm');
  } catch (err) {
    return errorResponse(err);
  }
}
