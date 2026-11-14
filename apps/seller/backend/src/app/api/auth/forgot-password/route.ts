import { NextResponse } from 'next/server';
import { authLimiter, clientAddress, NO_STORE, readAccountBody, sellerAccountDeps } from '@/lib/account-support';
import { FORGOT_PASSWORD_MESSAGE, forgotPasswordRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { runAfterResponse } from '@/lib/notifications';
import { FORGOT_EMAIL_RULE, FORGOT_IP_RULE, requestPasswordReset } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/forgot-password   body: { email }   (EP-08.US01.T01, D-093)
 *
 *   200 { ok: true, message }   ALWAYS the same answer: for a known, unknown or suspended account alike
 *   400 ACCOUNT_BODY_INVALID { field }   429 RATE_LIMITED (Retry-After): 5 per hour per IP, 3 per hour per email
 *
 * The lookup, the token and the email happen after the response (after()), so neither the answer nor its timing tells
 * the caller whether the account exists. The link is valid 30 minutes and works once.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readAccountBody(request, forgotPasswordRequestSchema);
    await authLimiter.consume(FORGOT_IP_RULE, clientAddress(request.headers));
    await authLimiter.consume(FORGOT_EMAIL_RULE, body.email);
    const email = body.email;
    runAfterResponse('password_reset', () => requestPasswordReset(sellerAccountDeps(), email));
    return NextResponse.json({ ok: true, message: FORGOT_PASSWORD_MESSAGE }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
