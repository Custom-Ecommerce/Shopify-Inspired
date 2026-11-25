import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { replyTicketFor } from '@/lib/admin-support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/tickets/:id/reply { revision, text } (Sprint 7, S7-B4): the platform answers; the seller is emailed; 409 TICKET_REVISION_CONFLICT or TICKET_CLOSED. Needs the tickets.reply capability (owner and customer_support; finance and operations get 403). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'tickets.reply');
    return await replyTicketFor(request, context, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
