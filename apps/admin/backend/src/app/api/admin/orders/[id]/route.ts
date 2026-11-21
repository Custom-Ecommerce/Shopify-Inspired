import { errorResponse } from '@/lib/admin-auth';
import { readOrderFor } from '@/lib/admin-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/orders/:id (Sprint 6 S6-B5). Items, totals, status history, payment state. Every read is audited first (order.detail_viewed). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    return await readOrderFor(request, context);
  } catch (err) {
    return errorResponse(err);
  }
}
