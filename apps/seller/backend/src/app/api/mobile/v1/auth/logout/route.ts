import { NextResponse } from 'next/server';
import { NO_STORE, readAccountBody } from '@/lib/account-support';
import { mobileLogoutRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { auditSellerMobile, sellerMobileDeps } from '@/lib/mobile-auth';
import { endMobileSession } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/auth/logout   body: { refreshToken }   (EP-31.US01.T02)
 *
 * Ends the family of the token: its refresh tokens and access tokens stop working. The answer is the same for any token, so it tells nothing; no access
 * token is needed, so a phone whose access token has expired can still sign out.
 *
 *   200 { ok: true }   400 ACCOUNT_BODY_INVALID { field }   503
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readAccountBody(request, mobileLogoutRequestSchema);
    const ended = await endMobileSession(await sellerMobileDeps(), body.refreshToken);
    if (ended) await auditSellerMobile('mobile.sign_out', ended.userId, ended.deviceId);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
