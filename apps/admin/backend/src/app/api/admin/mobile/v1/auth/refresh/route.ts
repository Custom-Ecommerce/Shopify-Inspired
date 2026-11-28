import { readAdminBody } from '@/lib/admin-account';
import { errorResponse, requireAdminSecret, requireDatabase } from '@/lib/admin-auth';
import { adminMobileDeps, auditAdminMobile, requireAdminAppVersion } from '@/lib/mobile-auth';
import { mobileRefreshRequestSchema } from '@/lib/mobile-login';
import { refreshMobileSession } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/mobile/v1/auth/refresh   body: { refreshToken, appVersion? }   (EP-31.US01.T06)
 *
 * The same rules as the seller app: one use per refresh token, a second use ends the family. The second factor is not asked again for a live family.
 *
 *   200 { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt }
 *   400 { field }   401 SESSION_REVOKED or ACCOUNT_SUSPENDED   426 UPGRADE_REQUIRED
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireAdminSecret();
    const body = await readAdminBody(request, mobileRefreshRequestSchema);
    await requireAdminAppVersion(request.headers);
    await requireDatabase();
    const result = await refreshMobileSession(await adminMobileDeps(), body.refreshToken, body.appVersion);
    if (!result.ok) {
      if (result.reused && result.userId && result.deviceId) await auditAdminMobile('mobile.refresh_reuse', result.userId, result.userId, { device: result.deviceId });
      return Response.json(
        { error: result.code === 'ACCOUNT_SUSPENDED' ? 'This account is suspended' : 'This session is no longer valid. Sign in again.', code: result.code },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json(result.tokens, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
