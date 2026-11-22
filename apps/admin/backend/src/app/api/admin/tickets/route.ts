import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { listTicketsFor } from '@/lib/admin-support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/tickets?status&page&limit (Sprint 7, S7-B4): every seller tickets, newest activity first. Needs the tickets.read capability (owner and customer_support; finance and operations get 403). */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'tickets.read');
    return await listTicketsFor(request, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
