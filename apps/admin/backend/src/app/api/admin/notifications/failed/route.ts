import { errorResponse } from '@/lib/admin-auth';
import { listFailedEmails } from '@/lib/admin-retries';
import { authorizeAdmin, NO_STORE } from '@/lib/admin-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/notifications/failed (S6-B7). Capability sync.manage. The failed emails: kind, masked recipient, attempts, error code, dates. NEVER the payload or the body. */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request, 'sync.manage');
    return Response.json(await listFailedEmails(), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
