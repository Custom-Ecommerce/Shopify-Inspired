import { AdminHttpError, errorResponse, requireDatabase } from '@/lib/admin-auth';
import { ACCOUNT_CODES, adminAccountDeps, adminAuthLimiter, clientAddress, consumeIp, readAdminBody, resetPasswordRequestSchema } from '@/lib/admin-account';
import { RESET_IP_RULE, resetPassword } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/password/reset   body: { token, password }   (EP-08.US01.T02 for operators)
 *
 * The thin admin wrapper of the shared flow (role admin). The token works once; the password follows the shared rule;
 * tokenVersion + 1 ends every session of the operator; a "password changed" email is queued.
 *
 *   200 { ok: true }   400 TOKEN_INVALID (unknown, used or expired) | ACCOUNT_BODY_INVALID { field }   429 RATE_LIMITED
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readAdminBody(request, resetPasswordRequestSchema);
    await consumeIp(adminAuthLimiter, RESET_IP_RULE, clientAddress(request.headers));
    await requireDatabase();
    const result = await resetPassword(adminAccountDeps(), body.token, body.password);
    if (!result.ok) throw new AdminHttpError(400, 'This link is not valid any more. Ask for a new one.', ACCOUNT_CODES.TOKEN_INVALID);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
