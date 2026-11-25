import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { statusTicketFor } from '@/lib/admin-support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/tickets/:id/status { revision, status } (Sprint 7, S7-B4): open, answered or closed under a compare-and-set. Needs the tickets.reply capability (owner and customer_support; finance and operations get 403). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'tickets.reply');
    return await statusTicketFor(request, context, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
