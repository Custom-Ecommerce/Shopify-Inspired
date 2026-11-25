import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { retryDeadEvents } from '@/lib/admin-retries';
import { authorizeAdmin, NO_STORE } from '@/lib/admin-session';
import { retryRequestSchema } from '@/lib/admin-ops-contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sync/retry { ids } (Sprint 6 S6-B7). Capability sync.manage. Dead events go back to pending with the attempts reset, each in ONE
 * compare-and-set on status dead (a row already moved is skipped). At most 100 ids. Audited (sync.retry).
 *   200 { requested, retried, skipped }   400 names the field   403 capability
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'sync.manage');
    const body = await readAdminBody(request, retryRequestSchema);
    if (body.ids.length === 0) throw new AdminHttpError(400, 'Choose at least one.', 'ACCOUNT_BODY_INVALID', 'ids');
    return Response.json(await retryDeadEvents(userId, body.ids), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
