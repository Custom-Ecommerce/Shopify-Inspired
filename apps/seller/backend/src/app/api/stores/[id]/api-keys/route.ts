import type { NextRequest } from 'next/server';
import { createStoreApiKey, listStoreApiKeys } from '@/lib/api-key-service';
import { auditActorOf } from '@/lib/auth';
import { apiKeyCreateRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { json, prepareTeamRoute } from '@/lib/team-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/api-keys (S8-B4, D-118). OWNER ONLY (capability api_keys.manage; the same standard steps as the team routes). The store's keys, newest first:
 * name, public prefix, scopes, last used, created, revoked; and the live keys against the plan. Never the secret, never its hash.
 *
 *   200 { keys, usage: { used, limit } }   401   403   404 unknown store id
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { storeId } = await prepareTeamRoute<undefined>(request, id, null, 'api_keys.manage');
    return json(await listStoreApiKeys(storeId));
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/stores/:id/api-keys  { name, scopes } (S8-B4, D-118). OWNER ONLY. Order: authenticate -> seller -> parse (400 + field) -> DB -> id -> owner (403) -> the
 * plan's live API keys (403 PLAN_LIMIT_REACHED; limits.apiKeys, a revoked key holds no slot) -> the write -> audit (without the secret). The full secret is in THIS
 * answer only.
 *
 *   201 { key, secret }   400 ACCOUNT_BODY_INVALID { field }   401   403
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { storeId, actor, body } = await prepareTeamRoute<{ name: string; scopes: string[] }>(request, id, apiKeyCreateRequestSchema, 'api_keys.manage');
    const created = await createStoreApiKey(storeId, { userObjectId: actor.userObjectId, role: actor.role, auditActor: auditActorOf({ userId: actor.userId, storeRole: 'owner' }) }, body);
    return json(created, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
