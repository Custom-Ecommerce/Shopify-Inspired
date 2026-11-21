import { errorResponse } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { retryFailedEmails } from '@/lib/admin-retries';
import { authorizeAdmin, NO_STORE } from '@/lib/admin-session';
import { retryRequestSchema } from '@/lib/admin-ops-contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/notifications/retry { ids } (S6-B7). Capability sync.manage. Failed emails go back to queued, each in ONE compare-and-set on status failed. At most 100. Audited. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'sync.manage');
    const body = await readAdminBody(request, retryRequestSchema);
    return Response.json(await retryFailedEmails(userId, body.ids), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
