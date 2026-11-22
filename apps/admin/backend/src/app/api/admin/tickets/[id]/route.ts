import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { readTicketFor } from '@/lib/admin-support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/tickets/:id (Sprint 7, S7-B4): one ticket with its messages (plain text). Needs the tickets.read capability (owner and customer_support; finance and operations get 403). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'tickets.read');
    return await readTicketFor(request, context, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
