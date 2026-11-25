import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { readOrderFor } from '@/lib/admin-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/orders/:id (Sprint 6 S6-B5). Items, totals, status history, payment state. Every read is audited first (order.detail_viewed). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'orders.read');
    return await readOrderFor(request, context, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
