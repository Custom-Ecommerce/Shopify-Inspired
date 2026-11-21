import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { listPaymentsFor } from '@/lib/admin-subscription-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/subscription-payments?status=requested|claimed|confirmed|rejected|void&page=&limit= (Sprint 6 EP-14, S6-B4, D-118). The manual
 * subscription payments, newest first, read through the seller backend (D-093), with the number waiting for a decision (pendingCount).
 *
 *   200 { docs, page, limit, totalDocs, totalPages, pendingCount }   401 no session   403 not an admin   422 bad filters   503 the seller backend
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'payments.read');
    return await listPaymentsFor(request, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
