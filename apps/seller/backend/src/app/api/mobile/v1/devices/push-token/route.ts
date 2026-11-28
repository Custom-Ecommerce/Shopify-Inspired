import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { NO_STORE, readAccountBody } from '@/lib/account-support';
import { authenticate, mobileSessionOf } from '@/lib/auth';
import { mobilePushTokenRequestSchema } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { sellerMobileDeps } from '@/lib/mobile-auth';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/devices/push-token   body: { token: 'ExponentPushToken[...]' | null }   (EP-31.US02.T01)
 *
 * The push token of THIS phone (a web session has no phone). One token per phone, and a token belongs to one phone: registering it takes it off any other.
 * null stops pushes to this phone. Signing out, a revoke or a password change removes it with the session.
 *
 *   200 { ok: true, registered }   400 ACCOUNT_BODY_INVALID { field: token }   401   403 not a seller, or PHONE_ONLY
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.role !== 'seller') throw new HttpError(403, 'Only a seller account has devices');
    const phone = mobileSessionOf(ctx);
    if (!phone) throw new HttpError(403, 'Only the app on a phone can do this.', 'PHONE_ONLY');
    const body = await readAccountBody(request, mobilePushTokenRequestSchema);
    assertCan(ctx.actor, 'update', 'sellerAccount', ['pushPrefs']);
    const deps = await sellerMobileDeps();
    const saved = await deps.devices.setPushToken('seller', phone.deviceId, body.token);
    if (!saved) throw new HttpError(401, 'This session is no longer valid. Sign in again.', 'SESSION_REVOKED');
    return NextResponse.json({ ok: true, registered: body.token !== null }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
