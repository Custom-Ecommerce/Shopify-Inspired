import { POST as consoleLogin } from '@/app/api/admin/session/route';
import { readAdminBody } from '@/lib/admin-account';
import { AdminHttpError, errorResponse, requireAdminSecret, requireDatabase, ADMIN_AUDIENCE } from '@/lib/admin-auth';
import { adminMobileDeps, auditAdminMobile, requireAdminAppVersion } from '@/lib/mobile-auth';
import { checkSecondFactor, mobileAdminLoginRequestSchema } from '@/lib/mobile-login';
import { User, adminCapabilities, effectiveAdminLevel, sessionTokenVersion, startMobileSession, verifySession } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/mobile/v1/auth/login (EP-31.US01.T06, T07)
 *   body: { email, password, deviceName, platform: 'android', appVersion, installationId?, totp?, recoveryCode? }
 *
 * The password is checked by the console's own sign-in, called in process (same checks, same limiter counters, same answers). The web session it would have
 * returned is thrown away. Then the second factor, which every admin phone needs (see lib/mobile-login.ts); only then is a device created.
 *
 *   200 { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt, deviceId, user, adminLevel, capabilities, recoveryCodes? }
 *   400 { field }   401 wrong password, TOTP_INVALID or RECOVERY_CODE_INVALID   403 TOTP_REQUIRED or TOTP_ENROLMENT_REQUIRED { enrolment }
 *   409 TOTP_RESET_REQUIRED   426 UPGRADE_REQUIRED   429 with Retry-After
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const secret = requireAdminSecret();
    const body = await readAdminBody(request, mobileAdminLoginRequestSchema);
    await requireAdminAppVersion(request.headers);

    const headers = new Headers(request.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');
    const checked = await consoleLogin(new Request(request.url, { method: 'POST', headers, body: JSON.stringify({ email: body.email, password: body.password }) }));
    if (!checked.ok) return checked;
    const session = (await checked.json()) as { token: string; user: { id: string; name: string; email: string } };
    const claims = await verifySession(session.token, secret, ADMIN_AUDIENCE);

    await requireDatabase();
    const doc = (await User.findById(session.user.id).select('adminLevel').lean()) as unknown as { adminLevel?: unknown } | null;
    const adminLevel = effectiveAdminLevel(doc?.adminLevel);
    if (!doc || adminLevel === null) throw new AdminHttpError(403, 'Forbidden', 'CAPABILITY_REQUIRED');

    const factor = await checkSecondFactor(session.user.id, session.user.email, { totp: body.totp, recoveryCode: body.recoveryCode });
    if (!factor.ok) return factor.response;

    const { deviceId, ...tokens } = await startMobileSession(await adminMobileDeps(), {
      userId: session.user.id,
      tokenVersion: sessionTokenVersion(claims),
      deviceName: body.deviceName,
      platform: body.platform,
      appVersion: body.appVersion,
      installationId: body.installationId ?? null,
      adminLevel,
    });
    await auditAdminMobile('mobile.sign_in', session.user.id, session.user.id, { device: deviceId });
    return Response.json(
      {
        ...tokens,
        deviceId,
        user: { id: session.user.id, name: session.user.name, email: session.user.email },
        adminLevel,
        capabilities: adminCapabilities(adminLevel),
        ...(factor.recoveryCodes ? { recoveryCodes: factor.recoveryCodes } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
