import { errorResponse } from '@/lib/admin-auth';
import { decidePaymentFor } from '@/lib/admin-subscription-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/subscription-payments/:id/void { reason } (Sprint 6 EP-14, S6-B4, D-118). Closes a requested or claimed payment, or takes back a
 * confirmed one (the subscription returns to what it was, only while nothing else changed it). A reason of 5 or more characters is required.
 * TODO(S6-B6): voiding a confirmed payment becomes owner-only once the admin levels exist.
 *
 *   200 { payment }   400 ACCOUNT_BODY_INVALID { field }   401 no session   403 not an admin   404 unknown payment
 *   409 PAYMENT_NOT_VOIDABLE | PAYMENT_ALREADY_DECIDED | SUBSCRIPTION_CHANGED   503 the seller backend
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    return await decidePaymentFor(request, context, 'void');
  } catch (err) {
    return errorResponse(err);
  }
}
