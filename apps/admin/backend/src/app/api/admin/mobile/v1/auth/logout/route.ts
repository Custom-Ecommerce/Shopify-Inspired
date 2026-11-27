import { readAdminBody } from '@/lib/admin-account';
import { errorResponse, requireAdminSecret, requireDatabase } from '@/lib/admin-auth';
import { adminMobileDeps, auditAdminMobile } from '@/lib/mobile-auth';
import { mobileLogoutRequestSchema } from '@/lib/mobile-login';
import { endMobileSession } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/mobile/v1/auth/logout   body: { refreshToken }. Ends that family; any token gets the same 200. */
export async function POST(request: Request): Promise<Response> {
  try {
    requireAdminSecret();
    const body = await readAdminBody(request, mobileLogoutRequestSchema);
    await requireDatabase();
    const ended = await endMobileSession(await adminMobileDeps(), body.refreshToken);
    if (ended) await auditAdminMobile('mobile.sign_out', ended.userId, ended.userId, { device: ended.deviceId });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
