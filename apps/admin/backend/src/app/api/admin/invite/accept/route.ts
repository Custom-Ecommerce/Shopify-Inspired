import { AdminHttpError, errorResponse, requireDatabase } from '@/lib/admin-auth';
import { adminAuthLimiter, clientAddress, consumeIp, readAdminBody } from '@/lib/admin-account';
import { acceptAdminInvite } from '@/lib/admin-users';
import { acceptInviteRequestSchema } from '@/lib/admin-user-routes';
import { RESET_IP_RULE } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/invite/accept {token, password} (S6-B6). No session: the token IS the credential (7 days, once). Limited per IP like the reset.
 *   200 { ok: true }   400 TOKEN_INVALID | ACCOUNT_BODY_INVALID { field }   429 RATE_LIMITED
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readAdminBody(request, acceptInviteRequestSchema);
    await consumeIp(adminAuthLimiter, RESET_IP_RULE, clientAddress(request.headers));
    await requireDatabase();
    return Response.json(await acceptAdminInvite(body.token, body.password), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof AdminHttpError) return errorResponse(err);
    return errorResponse(err);
  }
}
