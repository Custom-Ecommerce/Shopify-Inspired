import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { listContactFor } from '@/lib/admin-support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/contact-messages?status&page&limit (Sprint 7, S7-B4): the platform own contact messages (never a store). Needs the contact.read capability (owner and customer_support; finance and operations get 403). */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'contact.read');
    return await listContactFor(request, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
