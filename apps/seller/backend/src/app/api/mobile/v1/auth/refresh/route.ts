import { NextResponse } from 'next/server';
import { NO_STORE, readAccountBody } from '@/lib/account-support';
import { mobileRefreshRequestSchema } from '@/lib/contracts';
import { handleRouteError, jsonError } from '@/lib/http';
import { auditSellerMobile, requireSellerAppVersion, sellerMobileDeps } from '@/lib/mobile-auth';
import { refreshMobileSession } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/auth/refresh   body: { refreshToken, appVersion? }   (EP-31.US01.T02)
 *
 * Swaps the refresh token for a new one and a new access token. A refresh token works ONCE: presenting a used one ends its whole family, so the phone (and
 * whoever copied the token) must sign in again. The app must therefore never run two refreshes at once.
 *
 *   200 { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt }
 *   400 ACCOUNT_BODY_INVALID { field }   401 SESSION_REVOKED (unknown, used, expired or revoked) or ACCOUNT_SUSPENDED: sign in again   426 UPGRADE_REQUIRED   503
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readAccountBody(request, mobileRefreshRequestSchema);
    // Before the token is touched: an app that must update keeps its session for after the update.
    await requireSellerAppVersion(request.headers);
    const result = await refreshMobileSession(await sellerMobileDeps(), body.refreshToken, body.appVersion);
    if (!result.ok) {
      if (result.reused && result.userId && result.deviceId) await auditSellerMobile('mobile.refresh_reuse', result.userId, result.deviceId);
      return jsonError(401, result.code === 'ACCOUNT_SUSPENDED' ? 'This account is suspended' : 'This session is no longer valid. Sign in again.', result.code);
    }
    return NextResponse.json(result.tokens, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
