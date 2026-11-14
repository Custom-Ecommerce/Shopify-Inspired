import { errorResponse } from '@/lib/admin-auth';
import {
  adminAccountDeps,
  adminAuthLimiter,
  clientAddress,
  FORGOT_PASSWORD_MESSAGE,
  forgotPasswordRequestSchema,
  readAdminBody,
  runAfterResponse,
} from '@/lib/admin-account';
import { FORGOT_EMAIL_RULE, FORGOT_IP_RULE, requestPasswordReset } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/password/forgot   body: { email }   (EP-08.US01.T01 for operators, D-093)
 *
 * The thin admin wrapper of the shared flow (@markaz/auth requestPasswordReset, role admin). Always the same 200 answer;
 * the lookup and the email run after the response. The link goes to APP_BASE_URL_ADMIN/reset-password (the admin
 * console page is a carry-over row, not built this sprint).
 *
 *   200 { ok: true, message }   400 ACCOUNT_BODY_INVALID { field }   429 RATE_LIMITED (Retry-After)
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readAdminBody(request, forgotPasswordRequestSchema);
    await adminAuthLimiter.consume(FORGOT_IP_RULE, clientAddress(request.headers));
    await adminAuthLimiter.consume(FORGOT_EMAIL_RULE, body.email);
    const email = body.email;
    runAfterResponse('password_reset', () => requestPasswordReset(adminAccountDeps(), email));
    return Response.json({ ok: true, message: FORGOT_PASSWORD_MESSAGE }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
