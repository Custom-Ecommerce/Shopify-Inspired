import { NextResponse } from 'next/server';
import { authLimiter, clientAddress, NO_STORE, readAccountBody, sellerAccountDeps } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { ACCOUNT_CODES, resetPasswordRequestSchema } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { RESET_IP_RULE, resetPassword } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/reset-password   body: { token, password }   (EP-08.US01.T02, D-093)
 *
 *   200 { ok: true }   the password is changed, every existing session of the account ends (tokenVersion + 1), and a
 *                      "password changed" email is queued
 *   400 TOKEN_INVALID  the link is unknown, used or expired (one code for all three)
 *   400 ACCOUNT_BODY_INVALID { field }   the password breaks the shared rule (contracts passwordSchema)
 *   429 RATE_LIMITED (Retry-After): 10 per hour per IP   503 database unavailable
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readAccountBody(request, resetPasswordRequestSchema);
    await authLimiter.consume(RESET_IP_RULE, clientAddress(request.headers));
    await requireDatabase();
    const result = await resetPassword(sellerAccountDeps(), body.token, body.password);
    if (!result.ok) {
      throw new HttpError(400, 'This link is not valid any more. Ask for a new one.', ACCOUNT_CODES.TOKEN_INVALID);
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
