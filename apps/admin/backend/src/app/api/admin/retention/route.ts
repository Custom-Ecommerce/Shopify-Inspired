import { errorResponse } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { retentionRunRequestSchema } from '@/lib/admin-ops-contracts';
import { authorizeAdmin, NO_STORE } from '@/lib/admin-session';
import { retentionSteps } from '@/lib/admin-retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/retention { apply? } (Sprint 6 S6-B7, CO-25). Owner level only (capability settings.write). A DRY RUN unless the body says
 * { "apply": true }: it counts what would be purged. The purge itself and its audit entry (retention.run, with the counts) are the seller backend's, which
 * the admin backend calls signed. Capped per target per run; the ledger, the audit log and subscription payments are never in it.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'settings.write');
    const body = await readAdminBody(request, retentionRunRequestSchema);
    return Response.json(await retentionSteps.run(userId, { apply: body.apply === true }), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
