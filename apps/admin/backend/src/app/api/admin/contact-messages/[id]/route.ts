import { errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin } from '@/lib/admin-session';
import { readContactFor } from '@/lib/admin-support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/contact-messages/:id (Sprint 7, S7-B4). Needs the contact.read capability (owner and customer_support; finance and operations get 403). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'contact.read');
    return await readContactFor(request, context, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
