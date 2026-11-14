import { NextResponse } from 'next/server';
import { authLimiter, clientAddress, NO_STORE, readAccountBody, sellerAccountDeps } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { ACCOUNT_CODES, verifyEmailRequestSchema } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { confirmEmailToken, RESET_IP_RULE } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/verify-email   body: { token }   (EP-08.US02.T01 and US04.T01)
 *
 * The link of both the verification email and the email-change email (the stored token says which).
 *
 *   200 { ok: true, kind: 'email_verify' | 'email_change' }   verified (an already verified account is fine), or the new
 *                                                              address swapped in (other sessions then end)
 *   400 TOKEN_INVALID   unknown, used or expired       409 EMAIL_TAKEN   the new address belongs to another account now
 *   429 RATE_LIMITED (Retry-After): shares the reset bucket, 10 per hour per IP, so links cannot be guessed in bulk
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readAccountBody(request, verifyEmailRequestSchema);
    await authLimiter.consume(RESET_IP_RULE, clientAddress(request.headers));
    await requireDatabase();
    const result = await confirmEmailToken(sellerAccountDeps(), body.token);
    if (!result.ok) {
      if (result.code === 'EMAIL_TAKEN') throw new HttpError(409, 'This email address is already used by another account.', ACCOUNT_CODES.EMAIL_TAKEN);
      throw new HttpError(400, 'This link is not valid any more. Ask for a new one.', ACCOUNT_CODES.TOKEN_INVALID);
    }
    return NextResponse.json({ ok: true, kind: result.kind }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
