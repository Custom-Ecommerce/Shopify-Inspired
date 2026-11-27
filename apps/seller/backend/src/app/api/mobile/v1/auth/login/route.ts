import { NextResponse } from 'next/server';
import { POST as portalLogin } from '@/app/api/users/login/route';
import { NO_STORE, readAccountBody } from '@/lib/account-support';
import { requireSellerSecret, SELLER_AUDIENCE } from '@/lib/accounts';
import { mobileLoginRequestSchema } from '@/lib/contracts';
import { handleRouteError, jsonError } from '@/lib/http';
import { auditSellerMobile, requireSellerAppVersion, sellerMobileDeps } from '@/lib/mobile-auth';
import { sessionTokenVersion, startMobileSession, verifySession } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/auth/login   body: { email, password, deviceName, platform: 'android', appVersion, installationId? }   (EP-31.US01.T01, T05)
 *
 * The credentials are checked by the portal's own login, called in process: the same user checks, the same answer for an unknown email, a wrong password and
 * a suspended account, and the SAME limiter counters (10 failures per account and 30 per client address in 15 minutes), so a phone is not a second way to guess.
 * The web session it would have returned is thrown away; the phone gets a 15 minute access token and a rotating refresh token for one new device.
 *
 *   200 { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt, deviceId, user }
 *   400 ACCOUNT_BODY_INVALID { field }   401 wrong credentials (or not a seller account)   426 UPGRADE_REQUIRED { minVersion, storeUrl }
 *   429 with Retry-After   503 not configured / database unavailable
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const secret = requireSellerSecret();
    const body = await readAccountBody(request, mobileLoginRequestSchema);
    await requireSellerAppVersion(request.headers);

    const headers = new Headers(request.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');
    const checked = await portalLogin(new Request(request.url, { method: 'POST', headers, body: JSON.stringify({ email: body.email, password: body.password }) }));
    if (!checked.ok) return checked;

    const session = (await checked.json()) as { token: string; user: { id: string; name: string; email: string; role: string; store: string | null; emailVerified: boolean } };
    // The seller app is for sellers: an operator's account is answered like a wrong password.
    if (session.user.role !== 'seller') return jsonError(401, 'Invalid email or password');
    const claims = await verifySession(session.token, secret, SELLER_AUDIENCE);

    const { deviceId, ...tokens } = await startMobileSession(await sellerMobileDeps(), {
      userId: session.user.id,
      tokenVersion: sessionTokenVersion(claims),
      deviceName: body.deviceName,
      platform: body.platform,
      appVersion: body.appVersion,
      installationId: body.installationId ?? null,
    });
    await auditSellerMobile('mobile.sign_in', session.user.id, deviceId);
    return NextResponse.json({ ...tokens, deviceId, user: session.user }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
