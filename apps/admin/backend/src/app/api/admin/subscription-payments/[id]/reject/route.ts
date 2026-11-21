import { errorResponse } from '@/lib/admin-auth';
import { decidePaymentFor } from '@/lib/admin-subscription-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/subscription-payments/:id/reject { reason } (Sprint 6 EP-14, S6-B4, D-118). A requested or claimed payment is refused with a
 * reason of 5 or more characters; the seller is told. Nothing else changes.
 *
 *   200 { payment }   400 ACCOUNT_BODY_INVALID { field }   401 no session   403 not an admin   404 unknown payment
 *   409 PAYMENT_NOT_OPEN | PAYMENT_ALREADY_DECIDED   503 the seller backend
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    return await decidePaymentFor(request, context, 'reject');
  } catch (err) {
    return errorResponse(err);
  }
}
