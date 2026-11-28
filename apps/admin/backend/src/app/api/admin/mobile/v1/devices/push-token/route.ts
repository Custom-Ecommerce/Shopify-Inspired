import * as contractsNs from '@markaz/contracts';
import { readAdminBody } from '@/lib/admin-account';
import { AdminHttpError, adminDeviceOf, errorResponse } from '@/lib/admin-auth';
import { ANY_ADMIN, authorizeAdmin } from '@/lib/admin-session';
import { unwrapCjs } from '@/lib/cjs';
import { adminMobileDeps } from '@/lib/mobile-auth';

const contracts = unwrapCjs(contractsNs) as typeof contractsNs;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/mobile/v1/devices/push-token { token | null } (EP-31.US02.T01): the push token of THIS phone. Console sessions: 403 PHONE_ONLY. */
export async function POST(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request, ANY_ADMIN);
    const phone = adminDeviceOf(request);
    if (!phone) throw new AdminHttpError(403, 'Only the app on a phone can do this.', 'PHONE_ONLY');
    const body = await readAdminBody(request, contracts.mobilePushTokenRequestSchema);
    const deps = await adminMobileDeps();
    if (!(await deps.devices.setPushToken('admin', phone.deviceId, body.token))) throw new AdminHttpError(401, 'This session is no longer valid. Sign in again.', 'SESSION_REVOKED');
    return Response.json({ ok: true, registered: body.token !== null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
