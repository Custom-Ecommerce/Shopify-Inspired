import type { NextRequest } from 'next/server';
import { revokeStoreApiKey } from '@/lib/api-key-service';
import { auditActorOf } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { json, prepareTeamRoute } from '@/lib/team-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/api-keys/:keyId/revoke (S8-B4, D-118). OWNER ONLY. No body. Revokes the key in ONE compare-and-set on { revokedAt: null }: the very next v1
 * request with it is 401, and the plan slot is free again. Idempotent: revoking a revoked key answers it unchanged. A key of another store is a 404.
 *
 *   200 { key }   401   403   404 API_KEY_NOT_FOUND
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; keyId: string }> }): Promise<Response> {
  try {
    const { id, keyId } = await context.params;
    const { storeId, actor } = await prepareTeamRoute<undefined>(request, id, null, 'api_keys.manage');
    const key = await revokeStoreApiKey(storeId, { userObjectId: actor.userObjectId, role: actor.role, auditActor: auditActorOf({ userId: actor.userId, storeRole: 'owner' }) }, keyId);
    return json({ key });
  } catch (err) {
    return handleRouteError(err);
  }
}
